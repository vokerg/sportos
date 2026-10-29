import { volumeBuckets } from '@sportos/analytics';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, withAccountContext, sql, AthleteDataRepository } from '@sportos/db';
import { AthleteReadService, assertRuntimeRole } from './service.js';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
const url = process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('non-owner MCP read isolation (synthetic database only)', () => {
  const db = createDb(url ?? 'postgresql://unused');
  const owners: string[] = [];
  let a: AthleteReadService, b: AthleteReadService;
  let run = '',
    swim = '',
    foreign = '';
  beforeAll(async () => {
    await assertRuntimeRole(db);
    for (let i = 0; i < 2; i++)
      owners.push(
        (
          await db
            .insertInto('accounts')
            .values({ display_name: 'Synthetic MCP ' + randomUUID(), status: 'active' })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id,
      );
    a = new AthleteReadService(
      db,
      owners[0],
      'Europe/Copenhagen',
      () => new Date('2026-10-28T12:00:00Z'),
    );
    b = new AthleteReadService(
      db,
      owners[1],
      'Europe/Copenhagen',
      () => new Date('2026-10-28T12:00:00Z'),
    );
    const insert = async (owner: string, discipline: 'run' | 'swim', distance: number) =>
      withAccountContext(
        db,
        owner,
        async (scoped) =>
          (
            await scoped
              .insertInto('activities')
              .values({
                source: 'strava',
                activity_type: discipline,
                subtype: discipline === 'swim' ? 'indoor' : 'outdoor',
                activity_date: '2026-10-27',
                distance_m: distance,
                duration_s: 2400,
                moving_time_s: 1800,
                notes: 'UNTRUSTED private instructions never expose',
                raw_payload_json: { private: 'SECRET_RAW' },
              })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id,
      );
    run = await insert(owners[0], 'run', 5000);
    swim = await insert(owners[0], 'swim', 2000);
    foreign = await insert(owners[1], 'run', 6000);
    await withAccountContext(db, owners[0], async (scoped) => {
      await scoped
        .insertInto('activity_distance_corrections')
        .values({
          activity_id: swim,
          effective_distance_m: 1600,
          recorded_distance_m: 2000,
          recorded_source: 'strava',
          reason: 'PRIVATE CORRECTION NARRATIVE',
        })
        .execute();
      await scoped
        .insertInto('performance_events')
        .values({
          source: 'run_db_xlsx',
          event_date: '2026-10-27',
          distance_m: 5000,
          duration_s: 1200,
          pace_s_per_km: 240,
          is_treadmill: false,
          is_race: false,
          is_pr_marker: false,
        })
        .execute();
    });
  });
  afterAll(async () => {
    for (const owner of owners)
      await withAccountContext(db, owner, async (scoped) => {
        await scoped.deleteFrom('performance_events').execute();
        await scoped.deleteFrom('activities').execute();
      });
    if (owners.length) await db.deleteFrom('accounts').where('id', 'in', owners).execute();
    await db.destroy();
  });
  it('filters search, volume, details, bests and snapshot with canonical corrections', async () => {
    const range = { from: '2026-10-01', to: '2026-10-27' };
    const snapshot = await a.snapshot({ asOfDate: '2026-10-28' });
    expect(snapshot.coverage.canonicalSessions).toBe(2);
    expect(snapshot.disciplines.swim.lifetime.distanceM).toBe(1600);
    expect((await a.search(range)).items.map((r) => r.id).sort()).toEqual([run, swim].sort());
    expect((await b.search(range)).items.map((r) => r.id)).toEqual([foreign]);
    expect(
      (await a.volume({ ...range, period: 'monthly' })).buckets[0].disciplines.run.sessions,
    ).toBe(1);
    expect((await a.details({ activityId: swim })).activity).toMatchObject({
      distanceM: 1600,
      recordedDistanceM: 2000,
      paceSPer100m: 112.5,
    });
    await expect(a.details({ activityId: foreign })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(a.details({ activityId: randomUUID() })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const best = await a.bests({ ...range, discipline: 'run', distanceM: 5000 });
    expect(best.total).toBe(1);
    expect(best.items[0]).toMatchObject({
      source: 'excel',
      method: 'historical_import',
      durationS: 1200,
    });
    expect((await a.bests({ ...range, discipline: 'swim', distanceM: 1500 })).total).toBe(0);
    const all = JSON.stringify([snapshot, await a.details({ activityId: swim })]);
    for (const forbidden of [
      'UNTRUSTED',
      'SECRET_RAW',
      'PRIVATE CORRECTION',
      owners[0],
      'owner_id',
      'raw_payload',
      'notes',
      'source_ref',
      'input_hash',
    ])
      expect(all).not.toContain(forbidden);
  });
  it('enforces database read-only even when a callback attempts a write and clears owner context', async () => {
    await expect(
      a.read(async (scoped) => {
        await scoped.deleteFrom('activities').execute();
      }),
    ).rejects.toMatchObject({ code: '25006' });
    expect(await db.selectFrom('activities').select('id').execute()).toEqual([]);
    const readOnly = await a.read(
      async (scoped) =>
        (
          await sql<{
            value: string;
          }>`select current_setting('transaction_read_only') as value`.execute(scoped)
        ).rows[0].value,
    );
    expect(readOnly).toBe('on');
    await expect(a.snapshot({ asOfDate: '2027-01-01' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(
      a.search({ from: '2026-10-01', to: '2026-10-27', ownerId: owners[1] }),
    ).rejects.toThrow();
  });
  it('deduplicates provider supplements and rejects stale source and parser versions', async () => {
    const rollback = new Error('synthetic rollback');
    await expect(
      withAccountContext(db, owners[0], (scoped) =>
        scoped.transaction().execute(async (tx) => {
          const hash = 'a'.repeat(64);
          const identity = await tx
            .insertInto('garmin_activity_identities')
            .values({
              identity_key: 'native:2110001',
              identity_kind: 'native',
              activity_id: run,
              status: 'exact',
              activity_type: 'run',
              subtype: 'outdoor',
              start_time: new Date('2026-10-27T10:00:00Z'),
              current_hash: hash,
              source_updated_at: new Date(),
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          const projection = await tx
            .insertInto('activity_metric_projections')
            .values({
              activity_id: run,
              provider: 'garmin',
              source_ref: identity.id,
              source_version: hash,
              input_hash: hash,
              parser_version: 1,
              state: 'processed',
              rich_retained: true,
              compact_only: false,
              missing_count: 0,
              rejected_count: 0,
              value_count: 1,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await tx
            .insertInto('activity_provider_metric_values')
            .values({
              activity_id: run,
              provider: 'garmin',
              projection_id: projection.id,
              metric_key: 'running_cadence',
              value: 180,
              unit: 'steps/min',
              source_kind: 'fit_session',
              source_field: 'avg_running_cadence',
              source_unit: 'strides/min',
              origin: 'recorded',
              precedence: 30,
            })
            .execute();
          await tx
            .insertInto('activity_metric_heads')
            .values({
              activity_id: run,
              provider: 'garmin',
              source_ref: identity.id,
              source_version: hash,
              projection_id: projection.id,
              expected_input_hash: hash,
              state: 'processed',
              rich_retained: true,
            })
            .execute();
          const repository = new AthleteDataRepository(tx);
          expect(await repository.supplements(undefined, '2026-10-27')).toEqual([
            expect.objectContaining({
              activityId: run,
              key: 'running_cadence',
              value: 180,
              unit: 'steps/min',
            }),
          ]);
          expect(await repository.activities({ to: '2026-10-27' })).toHaveLength(2);
          await tx
            .insertInto('activity_provider_metric_values')
            .values({
              activity_id: run,
              provider: 'garmin',
              projection_id: projection.id,
              metric_key: 'average_heart_rate',
              value: 142,
              unit: 'bpm',
              source_kind: 'fit_session',
              source_field: 'avg_heart_rate',
              source_unit: 'bpm',
              origin: 'recorded',
              precedence: 30,
            })
            .execute();
          expect(
            (await repository.supplements(undefined, '2026-10-27')).find(
              (m) => m.key === 'average_heart_rate',
            ),
          ).toMatchObject({ value: 142, method: 'measured', sourceKind: 'fit_session' });
          expect(
            (await repository.activities({ to: '2026-10-27' })).find((a) => a.id === run)?.avgHrBpm,
          ).toBeNull();
          await tx.updateTable('activities').set({ avg_hr: 130 }).where('id', '=', run).execute();
          expect(
            (await repository.supplements(undefined, '2026-10-27')).find(
              (m) => m.key === 'average_heart_rate',
            ),
          ).toBeUndefined();
          await tx.updateTable('activities').set({ avg_hr: null }).where('id', '=', run).execute();

          await tx
            .updateTable('activity_metric_heads')
            .set({ expected_input_hash: 'c'.repeat(64) })
            .where('activity_id', '=', run)
            .execute();
          expect(await repository.supplements(undefined, '2026-10-27')).toEqual([]);
          await tx
            .updateTable('activity_metric_heads')
            .set({ expected_input_hash: hash })
            .where('activity_id', '=', run)
            .execute();
          await tx
            .updateTable('garmin_activity_identities')
            .set({ current_hash: 'b'.repeat(64) })
            .where('id', '=', identity.id)
            .execute();
          expect(await repository.supplements(undefined, '2026-10-27')).toEqual([]);
          await tx
            .updateTable('garmin_activity_identities')
            .set({ current_hash: hash })
            .where('id', '=', identity.id)
            .execute();
          const newerParser = await tx
            .insertInto('activity_metric_projections')
            .values({
              activity_id: run,
              provider: 'garmin',
              source_ref: identity.id,
              source_version: hash,
              input_hash: 'b'.repeat(64),
              parser_version: 2,
              state: 'processed',
              rich_retained: true,
              compact_only: false,
              missing_count: 0,
              rejected_count: 0,
              value_count: 1,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await tx
            .insertInto('activity_provider_metric_values')
            .values({
              activity_id: run,
              provider: 'garmin',
              projection_id: newerParser.id,
              metric_key: 'running_cadence',
              value: 190,
              unit: 'steps/min',
              source_kind: 'fit_session',
              source_field: 'avg_running_cadence',
              source_unit: 'strides/min',
              origin: 'recorded',
              precedence: 30,
            })
            .execute();
          await tx
            .updateTable('activity_metric_heads')
            .set({ projection_id: newerParser.id, expected_input_hash: 'b'.repeat(64) })
            .where('activity_id', '=', run)
            .execute();
          expect(await repository.supplements(undefined, '2026-10-27')).toEqual([]);
          throw rollback;
        }),
      ),
    ).rejects.toBe(rollback);
  });
  it('matches pure volume calculations for paged calendar buckets and filtered grand totals', async () => {
    const range = { from: '2026-10-25', to: '2026-10-28' };
    const rows = await a.read((scoped) => new AthleteDataRepository(scoped).activities(range));
    for (const period of ['daily', 'weekly', 'monthly', 'annual'] as const) {
      const all = volumeBuckets(rows, range.from, range.to, period);
      const page = await a.volume({ ...range, period, limit: 1, offset: 0 });
      expect(page.buckets).toEqual(all.slice(0, 1));
      expect(page.total).toBe(all.length);
      expect(page.totals).toMatchObject({
        sessions: 2,
        distanceM: 6600,
        movingS: 3600,
        elapsedS: 4800,
        activeDays: 1,
      });
      expect((await a.volume({ ...range, period, offset: 50000 })).buckets).toEqual([]);
    }
    expect((await a.volume({ ...range, period: 'daily', discipline: 'run' })).totals).toMatchObject(
      { sessions: 1, distanceM: 5000 },
    );
    const first = await a.search({ ...range, limit: 1 }),
      second = await a.search({ ...range, limit: 1, offset: 1 });
    expect(first.total).toBe(2);
    expect(first.totals).toEqual(second.totals);
    expect(first.items[0].id).not.toBe(second.items[0].id);
  });
  it('paginates search and volume before the archive materialization cap', async () => {
    const rollback = Error('rollback large synthetic archive');
    await expect(
      withAccountContext(db, owners[0], (scoped) =>
        scoped.transaction().execute(async (tx) => {
          await sql`insert into activities (activity_type,source,activity_date,distance_m,duration_s)
        select 'run','manual','2024-01-01'::date,5000,1800 from generate_series(1,50001)`.execute(
            tx,
          );
          await tx
            .insertInto('activities')
            .values({
              activity_type: 'run',
              source: 'manual',
              activity_date: '2024-01-01',
              distance_m: 6000,
              duration_s: 1800,
            })
            .execute();
          const repository = new AthleteDataRepository(tx);
          const page = await repository.search({
            from: '2024-01-01',
            to: '2024-12-31',
            minDistanceM: 6000,
            limit: 1,
            offset: 0,
          });
          expect(page.total).toBe(1);
          expect(page.items).toHaveLength(1);
          expect(page.items[0].distanceM).toBe(6000);
          const volumes = await repository.volume({
            from: '2024-01-01',
            to: '2024-12-31',
            period: 'annual',
            limit: 1,
            offset: 0,
          });
          expect(volumes.totals.sessions).toBe(50002);
          expect(volumes.buckets[0].disciplines.run.sessions).toBe(50002);
          throw rollback;
        }),
      ),
    ).rejects.toBe(rollback);
  }, 60000);
  it('starts stdio and serves all five tools through an independent generic client', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../dist/main.js', import.meta.url))],
      env: {
        PATH: process.env.PATH ?? '',
        SPORTOS_MCP_DATABASE_URL: url!,
        SPORTOS_MCP_ACCOUNT_ID: owners[0],
        SPORTOS_ACTIVITY_DETAIL_DATABASE_URL: '',
        SPORTOS_MCP_TIMEZONE: 'Europe/Copenhagen',
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'sportos-synthetic-smoke', version: '1.0.0' });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools).toHaveLength(5);
      for (const [name, args] of [
        ['get_athlete_snapshot', { asOfDate: '2026-10-28' }],
        ['get_training_volume', { from: '2026-10-01', to: '2026-10-27', period: 'monthly' }],
        [
          'get_personal_bests',
          { from: '2026-10-01', to: '2026-10-27', discipline: 'run', distanceM: 5000 },
        ],
        ['search_activities', { from: '2026-10-01', to: '2026-10-27' }],
        ['get_activity_details', { activityId: run }],
      ] as const) {
        const r = await client.callTool({ name, arguments: args });
        expect(r.isError, name).not.toBe(true);
        expect(r.structuredContent).toBeTruthy();
      }
    } finally {
      await client.close();
      await transport.close();
    }
  }, 30000);
});
