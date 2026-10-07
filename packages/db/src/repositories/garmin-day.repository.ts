import { sql, type Kysely } from 'kysely';
import type { Database, Json } from '../schema.js';
import { GARMIN_DAY_CATEGORIES, type GarminDayAvailability, type GarminDayCategory, type GarminDayState } from '../garmin-day-schema.js';
import { isIsoDate } from '../score-breakdown-contract.js';
function validate(date: string, category?: GarminDayCategory, hash?: string) {
  if (!isIsoDate(date) || (category && !GARMIN_DAY_CATEGORIES.includes(category)) || (hash && !/^[a-f0-9]{64}$/.test(hash))) throw new Error('Invalid Garmin day reference.');
}
const json = (value: Json) => sql<Json>`${JSON.stringify(value)}::jsonb`;
export interface GarminDayWrite {
  category: GarminDayCategory; state: GarminDayState; attemptedAt: Date;
  version?: { hash: string; availability: GarminDayAvailability; projection: Json };
  attempt?: Json;
}
/** Primary compact versions and availability only. No canonical writes. */
export class GarminDayRepository {
  constructor(private readonly db: Kysely<Database>) {}
  async read(date: string) {
    validate(date);
    return this.db.selectFrom('garmin_day_heads as h').leftJoin('garmin_day_versions as v', join => join
      .onRef('v.owner_id', '=', 'h.owner_id').onRef('v.id', '=', 'h.version_id'))
      .select(['h.category', 'h.version_id', 'h.state', 'h.attempt_json', 'h.attempted_at', 'v.source_hash', 'v.projection_json', 'v.retrieved_at', 'v.availability'])
      .where('h.calendar_date', '=', date).orderBy('h.category').limit(8).execute();
  }
  async publish(date: string, input: GarminDayWrite) {
    validate(date, input.category, input.version?.hash);
    if (Buffer.byteLength(JSON.stringify(input.version?.projection ?? {})) > 60000 || Buffer.byteLength(JSON.stringify(input.attempt ?? {})) > 8000) throw new Error('Garmin projection exceeds bounds.');
    return this.db.transaction().execute(async tx => {
      await sql`select pg_advisory_xact_lock(hashtextextended(sportos_current_account_id()::text || ':garmin-day:' || ${date}, 0))`.execute(tx);
      const current = await tx.selectFrom('garmin_day_heads').select(['version_id','attempted_at'])
        .where('calendar_date','=',date).where('category','=',input.category).executeTakeFirst();
      // An older concurrent request cannot replace a newer published attempt.
      if (current && current.attempted_at > input.attemptedAt) return;
      let versionId = current?.version_id ?? null;
      if (input.version) {
        const version = input.version;
        const inserted = await tx.insertInto('garmin_day_versions').values({ calendar_date: date, category: input.category,
          source_hash: version.hash, availability: version.availability, projection_json: json(version.projection), retrieved_at: input.attemptedAt,
        }).onConflict(oc => oc.columns(['owner_id','calendar_date','category','source_hash']).doNothing()).returning('id').executeTakeFirst();
        if (inserted) versionId = inserted.id;
        else {
          const existing = await tx.selectFrom('garmin_day_versions').select('id')
            .where('calendar_date','=',date).where('category','=',input.category).where('source_hash','=',version.hash)
            .where('availability','=',version.availability).where('projection_json','=',json(version.projection)).executeTakeFirst();
          if (!existing) throw new Error('Garmin day source version conflicts with retained projection.');
          versionId = existing.id;
        }
      }
      await tx.insertInto('garmin_day_heads').values({ calendar_date: date, category: input.category, version_id: versionId,
        state: input.state, attempt_json: json(input.attempt ?? {}), attempted_at: input.attemptedAt,
      }).onConflict(oc => oc.columns(['owner_id','calendar_date','category']).doUpdateSet({ version_id: versionId,
        state: input.state, attempt_json: json(input.attempt ?? {}), attempted_at: input.attemptedAt })).execute();
    });
  }
}
/** Construct only with the separate detail database inside account context. */
export class GarminDayResourcesRepository {
  constructor(private readonly db: Kysely<Database>) {}
  async retain(date: string, category: GarminDayCategory, hash: string, payload: Json) {
    validate(date, category, hash);
    if (Buffer.byteLength(JSON.stringify(payload)) > 4_000_000) throw new Error('Garmin day payload exceeds bounds.');
    await this.db.insertInto('garmin_day_resources').values({ calendar_date: date, category, source_hash: hash, payload_json: json(payload) })
      .onConflict(oc => oc.columns(['owner_id','calendar_date','category','source_hash']).doNothing()).execute();
    const same = await this.db.selectFrom('garmin_day_resources').select('source_hash').where('calendar_date','=',date)
      .where('category','=',category).where('source_hash','=',hash).where('payload_json','=',json(payload)).executeTakeFirst();
    if (!same) throw new Error('Garmin day resource version conflicts with retained content.');
  }
  async read(date: string, category: GarminDayCategory, hash: string) {
    validate(date, category, hash);
    return this.db.selectFrom('garmin_day_resources').select('payload_json').where('calendar_date','=',date)
      .where('category','=',category).where('source_hash','=',hash).executeTakeFirst();
  }
}
