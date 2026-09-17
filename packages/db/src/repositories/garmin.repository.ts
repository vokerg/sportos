import { sql, type Kysely } from 'kysely';
import type { Database, GarminObservation, Json } from '../schema.js';

export interface GarminObservationInput {
  reportType: GarminObservation['report_type'];
  identityKey: string;
  recordedDate: string;
  recordedTime: string | null;
  values: Json;
  valueHash: string;
  sourceRecordId: string;
}

export interface GarminObservationUpsertResult {
  observation: GarminObservation;
  outcome: 'inserted' | 'unchanged' | 'updated';
}

export class GarminRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async upsertObservation(input: GarminObservationInput): Promise<GarminObservationUpsertResult> {
    const inserted = await this.db
      .insertInto('garmin_observations')
      .values({
        report_type: input.reportType,
        identity_key: input.identityKey,
        recorded_date: input.recordedDate,
        recorded_time: input.recordedTime,
        values_json: jsonb(input.values),
        value_hash: input.valueHash,
        current_source_record_id: input.sourceRecordId,
      })
      .onConflict((conflict) => conflict
        .columns(['owner_id', 'report_type', 'identity_key'])
        .doNothing())
      .returningAll()
      .executeTakeFirst();
    if (inserted) return { observation: inserted, outcome: 'inserted' };

    const current = await this.db
      .selectFrom('garmin_observations')
      .selectAll()
      .where('report_type', '=', input.reportType)
      .where('identity_key', '=', input.identityKey)
      .forUpdate()
      .executeTakeFirstOrThrow();

    const outcome = current.value_hash === input.valueHash ? 'unchanged' : 'updated';
    const observation = await this.db
      .updateTable('garmin_observations')
      .set({
        recorded_date: input.recordedDate,
        recorded_time: input.recordedTime,
        values_json: jsonb(input.values),
        value_hash: input.valueHash,
        current_source_record_id: input.sourceRecordId,
        last_seen_at: new Date(),
        updated_at: outcome === 'updated' ? new Date() : current.updated_at,
      })
      .where('id', '=', current.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    return { observation, outcome };
  }
}

function jsonb(value: Json) {
  return sql<Json>`${JSON.stringify(value)}::jsonb`;
}
