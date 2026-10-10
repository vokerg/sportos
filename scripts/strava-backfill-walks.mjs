import {loadEnvFile} from 'node:process';
import {existsSync} from 'node:fs';
import {createDb, withAccountContext, LEGACY_ACCOUNT_ID, ProvidersRepository} from '../packages/db/dist/index.js';
import {parseStravaActivity, canonicalActivityType} from '../packages/importers/dist/index.js';
import {stravaSnapshotInput} from '../apps/worker/dist/provider-sync-runner.js';
if (existsSync('.env')) loadEnvFile('.env');
const args = process.argv.slice(2).filter(arg => arg !== '--');
if (args.some(arg => arg !== '--apply') || args.length > 1) throw new Error('Usage: pnpm strava:backfill-walks -- [--apply]');
if (process.env.SPORTOS_AUTH_MODE !== 'dev-single-user' || process.env.NODE_ENV === 'production') throw new Error('Backfill requires local dev-single-user mode.');
const db = createDb(process.env.DATABASE_URL);
try {
  const rows = await withAccountContext(db, LEGACY_ACCOUNT_ID, tx => new ProvidersRepository(tx).retainedWalkSources());
  if (rows.length > 10000) throw new Error('Retained walk limit exceeded; no writes performed.');
  // Validate every selected observation before any mutation. Never print raw data/errors.
  const inputs = [];
  let invalid = 0;
  for (const row of rows) {
    try {
      const activity = parseStravaActivity(row.raw_json);
      if (canonicalActivityType(activity) !== 'walk' || activity.providerActivityId !== row.source_record_key) throw new Error();
      inputs.push(stravaSnapshotInput(activity, {batchId: row.import_batch_id, connectionId: row.connection_id,
        raw: row.raw_json, rawHash: row.row_hash, retainedSourceRecordId: row.id}));
    } catch { invalid++; }
  }
  let inserted = 0, reused = 0, ambiguous = 0;
  if (args.includes('--apply')) {
    await withAccountContext(db, LEGACY_ACCOUNT_ID, async tx => {
      for (const input of inputs) {
        const result = await new ProvidersRepository(tx).ingestActivitySnapshot(input);
        if (result.insertedActivity) inserted++;
        else if (result.activityId) reused++;
        else ambiguous++;
        if ((inserted + reused + ambiguous) % 50 === 0) console.log(JSON.stringify({processed:inserted+reused+ambiguous,total:inputs.length}));
      }
    });
  }
  console.log(JSON.stringify({apply: args.includes('--apply'), candidates: rows.length, valid: inputs.length,
    invalid, inserted, reused, ambiguous, fetched: false, scoreWrites: false}));
} catch {
  console.error('Retained walk backfill failed; committed records are safe to replay.');
  process.exitCode = 1;
} finally {await db.destroy();}
