import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, withAccountContext, sql } from '@sportos/db';
import { retainedLaps, retainedAthleteSwimLengths } from '@sportos/db';
import { assertRuntimeRole } from './service.js';
const url = process.env.SPORTOS_ACTIVITY_DETAIL_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'retained lap projection in separate non-owner detail database',
  () => {
    it('allowlists current Strava and Garmin laps, checks units, bounds and account isolation', async () => {
      const db = createDb(url!);
      const owner = randomUUID(),
        activityId = randomUUID(),
        hash = 'a'.repeat(64),
        rollback = Error('rollback');
      const reference = {
        activityId,
        provider: 'strava' as const,
        providerActivityId: 'synthetic-211',
        providerVersion: hash,
        connectionId: randomUUID(),
      };
      try {
        await assertRuntimeRole(db);
        await expect(
          withAccountContext(db, owner, (scoped) =>
            scoped.transaction().execute(async (tx) => {
              await tx
                .insertInto('activity_provider_resources')
                .values({
                  activity_id: activityId,
                  provider: 'strava',
                  provider_activity_id: reference.providerActivityId,
                  resource_type: 'laps',
                  provider_version: hash,
                  availability: 'available',
                  http_status: 200,
                  payload_json: JSON.stringify([
                    {
                      distance: 400,
                      elapsed_time: 100,
                      moving_time: 90,
                      average_heartrate: 140,
                      notes: 'PRIVATE_NOTE',
                      latitude: 55,
                    },
                    { distance: 'IGNORE_INSTRUCTIONS', elapsed_time: 100 },
                  ]),
                })
                .execute();
              const current = await retainedLaps(tx, activityId, reference, undefined);
              expect(current).toMatchObject({
                provider: 'strava',
                items: [
                  {
                    index: 0,
                    distanceM: 400,
                    elapsedS: 100,
                    movingS: 90,
                    timerS: null,
                    avgHrBpm: 140,
                  },
                  { index: 1, distanceM: null },
                ],
                truncated: false,
              });
              expect(JSON.stringify(current)).not.toContain('PRIVATE_NOTE');
              expect(JSON.stringify(current)).not.toContain('IGNORE_INSTRUCTIONS');
              expect(JSON.stringify(current)).not.toContain('latitude');
              expect(
                (
                  await retainedLaps(
                    tx,
                    activityId,
                    { ...reference, providerVersion: 'b'.repeat(64) },
                    undefined,
                  )
                ).items,
              ).toEqual([]);
              await sql`select set_config('sportos.account_id',${randomUUID()},true)`.execute(tx);
              expect((await retainedLaps(tx, activityId, reference, undefined)).items).toEqual([]);
              await sql`select set_config('sportos.account_id',${owner},true)`.execute(tx);
              await tx
                .insertInto('garmin_activity_resources')
                .values({
                  identity_key: 'native:2111111',
                  source_hash: hash,
                  resource_hash: hash,
                  resource_type: 'records',
                  chunk_index: 0,
                  payload_json: JSON.stringify(
                    Array.from({ length: 101 }, () => ({
                      message: 'lap',
                      fields: [
                        { name: 'total_distance', value: 25, units: 'm' },
                        { name: 'total_timer_time', value: 30, units: 's' },
                        { name: 'notes', value: 'PRIVATE_NOTE' },
                      ],
                    })),
                  ),
                })
                .execute();
              const garmin = await retainedLaps(tx, activityId, null, {
                identity_key: 'native:2111111',
                current_hash: hash,
              });
              expect(garmin.provider).toBe('garmin');
              expect(garmin.items).toHaveLength(100);
              const last = await retainedLaps(
                tx,
                activityId,
                null,
                { identity_key: 'native:2111111', current_hash: hash },
                { limit: 100, offset: 100 },
              );
              expect(last).toMatchObject({
                provider: 'garmin',
                total: 101,
                offset: 100,
                hasMore: false,
              });
              expect(last.items[0].index).toBe(100);
              expect(last.items).toHaveLength(1);
              expect(
                await retainedLaps(tx, activityId, reference, undefined, { limit: 1, offset: 1 }),
              ).toMatchObject({
                provider: 'strava',
                total: 2,
                offset: 1,
                hasMore: false,
                items: [{ index: 1 }],
              });
              expect(
                await retainedLaps(
                  tx,
                  activityId,
                  reference,
                  { identity_key: 'native:2111111', current_hash: hash },
                  { limit: 1, offset: 100, provider: 'strava' },
                ),
              ).toMatchObject({ provider: 'strava', items: [], total: 2 });
              await tx
                .insertInto('garmin_activity_resources')
                .values({
                  identity_key: 'native:2111111',
                  source_hash: hash,
                  resource_hash: 'b'.repeat(64),
                  resource_type: 'records',
                  chunk_index: 1,
                  payload_json: JSON.stringify([
                    {
                      message: 'session',
                      fields: [
                        { name: 'pool_length', value: 25, units: 'm' },
                        { name: 'num_lengths', value: 2, units: 'lengths' },
                        { name: 'num_active_lengths', value: 2, units: 'lengths' },
                      ],
                    },
                    {
                      message: 'length',
                      fields: [
                        { name: 'length_type', value: 'active' },
                        { name: 'total_timer_time', value: 30, units: 's' },
                        { name: 'total_strokes', value: 15, units: 'strokes' },
                        { name: 'swim_stroke', value: 'freestyle' },
                      ],
                    },
                    {
                      message: 'length',
                      fields: [
                        { name: 'length_type', value: 'active' },
                        { name: 'total_timer_time', value: 35, units: 's' },
                        { name: 'total_strokes', value: 16, units: 'strokes' },
                      ],
                    },
                  ]),
                })
                .execute();
              const lengths = await retainedAthleteSwimLengths(
                tx,
                { identity_key: 'native:2111111', current_hash: hash },
                { limit: 1, offset: 0 },
              );
              expect(lengths).toMatchObject({
                status: 'available',
                poolLengthM: 25,
                complete: true,
                total: 2,
                hasMore: true,
                canonicalCorrectionApplied: false,
              });
              expect(lengths.lengths[0]).toMatchObject({
                row: 1,
                durationS: 30,
                paceSPer100M: 120,
                strokes: 15,
                swolf: 45,
              });
              expect(
                (
                  await retainedAthleteSwimLengths(
                    tx,
                    { identity_key: 'native:2111111', current_hash: hash },
                    { limit: 1, offset: 1 },
                  )
                ).lengths[0],
              ).toMatchObject({ row: 2, durationS: 35 });
              expect(
                await retainedAthleteSwimLengths(
                  tx,
                  { identity_key: 'native:2111111', current_hash: 'c'.repeat(64) },
                  { limit: 1, offset: 0 },
                ),
              ).toMatchObject({ status: 'unavailable', total: 0 });

              expect(garmin.truncated).toBe(true);
              expect(garmin.items[0]).toMatchObject({ distanceM: 25, movingS: null, timerS: 30 });
              expect(JSON.stringify(garmin)).not.toContain('PRIVATE_NOTE');
              expect(
                (
                  await retainedLaps(tx, activityId, null, {
                    identity_key: 'native:2111111',
                    current_hash: 'b'.repeat(64),
                  })
                ).items,
              ).toEqual([]);
              throw rollback;
            }),
          ),
        ).rejects.toBe(rollback);
      } finally {
        await db.destroy();
      }
    });
  },
);
