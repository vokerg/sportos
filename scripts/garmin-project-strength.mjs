import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { createDb, withAccountContext, LEGACY_ACCOUNT_ID, GarminDayRepository,
  GarminActivityResourcesRepository, GarminStrengthRepository, isIsoDate } from '../packages/db/dist/index.js';
import { normalizeGarminStrength } from '../packages/domain/dist/index.js';
if (existsSync('.env')) loadEnvFile('.env');
const args = process.argv.slice(2).filter(arg => arg !== '--');
const date = args[0];
if (args.length !== 1 || !isIsoDate(date)) throw new Error('Usage: pnpm garmin:project-strength -- YYYY-MM-DD');
if (process.env.SPORTOS_AUTH_MODE !== 'dev-single-user' || process.env.NODE_ENV === 'production') throw new Error('Retained projection CLI requires local dev-single-user mode.');
const primary = createDb(process.env.DATABASE_URL);
const detail = createDb(process.env.SPORTOS_ACTIVITY_DETAIL_DATABASE_URL);
let projected = 0;
try {
  const versions = await withAccountContext(primary, LEGACY_ACCOUNT_ID, async db => {
    const day = (await new GarminDayRepository(db).read(date)).find(row => row.category === 'activities');
    const projection = day?.projection_json;
    const identities = projection && typeof projection === 'object' && !Array.isArray(projection) && Array.isArray(projection.identities) ? projection.identities : [];
    if (identities.length > 20 || identities.some(id => typeof id !== 'string')) throw new Error('Invalid retained discovery.');
    if (!identities.length) return [];
    return db.selectFrom('garmin_activity_identities as i').innerJoin('garmin_activity_versions as v', join => join
      .onRef('v.owner_id','=','i.owner_id').onRef('v.identity_id','=','i.id').onRef('v.content_hash','=','i.current_hash'))
      .select(['i.id','i.identity_key','i.current_hash','v.origin']).where('i.identity_key','in',identities)
      .where('i.activity_type','=','workout').orderBy('i.id').orderBy('v.origin').limit(40).execute();
  });
  for (const version of versions) {
    const summary = await withAccountContext(detail, LEGACY_ACCOUNT_ID, async db => {
      const repo = new GarminActivityResourcesRepository(db);
      const ref = {identityKey:version.identity_key, sourceHash:version.current_hash};
      const expected = await repo.expectedResources(ref);
      const coverage = await repo.coverage(ref);
      if (!Array.isArray(expected) || !expected.length || expected.some(item => !item || typeof item !== 'object' || Array.isArray(item)
        || !coverage.some(resource => resource.resourceType === item.resourceType && resource.chunkIndex === item.chunkIndex))) throw new Error('Retained bundle is incomplete.');
      const payloads = [];
      for (const resource of coverage.filter(row => row.resourceType === 'sets')) {
        const data = await repo.read(ref,'sets',resource.chunkIndex);
        if (!data) throw new Error('Retained sets are missing.');
        payloads.push(data.payload);
      }
      return normalizeGarminStrength(payloads);
    });
    await withAccountContext(primary,LEGACY_ACCOUNT_ID,db => new GarminStrengthRepository(db).retain(version.id,version.current_hash,version.origin,summary));
    projected++;
  }
  console.log(JSON.stringify({projected, fetched:false, scoreWrites:false}));
} finally { await primary.destroy(); await detail.destroy(); }
