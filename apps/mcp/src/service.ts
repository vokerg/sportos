import {
  retainedLaps,
  unavailableLaps,
  retainedAthleteSwimLengths,
  unavailableAthleteSwimLengths,
} from '@sportos/db';
import {
  activityEvidence,
  activityPaceSPerKm,
  buildAthleteSnapshot,
  localDate,
  shiftDate,
  volumeBuckets,
  type RunBest,
} from '@sportos/analytics';
import {
  AthleteDataRepository,
  DistanceLeaderboardRepository,
  ActivityProviderResourcesRepository,
  assertAccountId,
  sql,
  withAccountContext,
  type Database,
  type Kysely,
} from '@sportos/db';
import * as z from 'zod/v4';
import {
  athleteSnapshotSchema,
  bestInput,
  bestOutput,
  detailsInput,
  detailOutput,
  searchInput,
  searchOutput,
  snapshotInput,
  volumeInput,
  volumeOutput,
} from './contracts.js';

const TARGETS = [5000, 10000, 15000, 20000, 21097.5, 25000, 42195];
export class ToolError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'UNAVAILABLE' | 'INVALID_INPUT' | 'BUSY' | 'OUTPUT_LIMIT',
    message: string,
  ) {
    super(message);
  }
}
export async function assertRuntimeRole(db: Kysely<Database>) {
  const row = (
    await sql<{ role: string; unsafe: boolean }>`select current_user as role,
    (r.rolsuper or r.rolbypassrls or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and pg_has_role(current_user,c.relowner,'USAGE'))) as unsafe
    from pg_roles r where r.rolname=current_user`.execute(db)
  ).rows[0];
  if (!row || row.unsafe || row.role !== 'sportos_app')
    throw new ToolError('UNAVAILABLE', 'A non-owner application runtime connection is required.');
}
export class AthleteReadService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly accountId: string,
    readonly timezone: string,
    private readonly now: () => Date = () => new Date(),
    private readonly detailDb?: Kysely<Database>,
  ) {
    assertAccountId(accountId);
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  }
  today() {
    return localDate(this.now(), this.timezone);
  }
  metadata(from: string, to: string) {
    return {
      schemaVersion: 'sportos.athlete-read.v1' as const,
      readAt: this.now().toISOString(),
      timezone: this.timezone,
      from,
      to,
      incompleteDayIncluded: to >= this.today(),
      freshness: 'retained_only_sync_freshness_unknown' as const,
    };
  }
  async read<T>(callback: (db: Kysely<Database>) => Promise<T>, db = this.db): Promise<T> {
    return withAccountContext(db, this.accountId, (scoped) =>
      scoped
        .transaction()
        .setIsolationLevel('repeatable read')
        .execute(async (tx) => {
          await sql`set transaction read only`.execute(tx);
          await sql`set local statement_timeout = '20000ms'`.execute(tx);
          await sql`set local idle_in_transaction_session_timeout = '30000ms'`.execute(tx);
          return callback(tx);
        }),
    );
  }
  private validateTo(to: string) {
    if (to > this.today()) throw new ToolError('INVALID_INPUT', 'Future dates are not supported.');
  }
  async snapshot(raw: unknown) {
    const input = snapshotInput.parse(raw),
      generatedAt = this.now().toISOString(),
      today = localDate(new Date(generatedAt), this.timezone),
      asOfDate = input.asOfDate ?? today;
    if (asOfDate > today) throw new ToolError('INVALID_INPUT', 'Future dates are not supported.');
    const completeTo = asOfDate === today ? shiftDate(asOfDate, -1) : asOfDate;
    return this.read(async (db) => {
      const repository = new AthleteDataRepository(db);
      const activities = await repository.activities({ to: asOfDate });
      const supplements = await repository.supplements(undefined, completeTo);
      const providerFreshness = await repository.providerFreshness();
      const runningBests: RunBest[] = [],
        recentRunningBests: RunBest[] = [];
      for (const distanceM of TARGETS) {
        for (const [destination, from] of [
          [runningBests, undefined],
          [recentRunningBests, shiftDate(completeTo, -89)],
        ] as const) {
          const result = await new DistanceLeaderboardRepository(db).read({
            distanceM,
            from,
            to: completeTo,
            limit: 10,
          });
          destination.push({
            targetDistanceM: distanceM,
            total: result.total,
            coverage: result.coverage,
            rows: result.rows.map((r) => ({
              activityId: r.activityId,
              eventId: r.eventId,
              date: r.date,
              durationS: r.durationS,
              source: r.source,
              pausePolicy: r.pausePolicy,
              rank: r.rank,
              alternativeCount: r.alternativeCount,
              method: r.source === 'excel' ? 'historical_import' : 'calculated',
            })),
          });
        }
      }
      return athleteSnapshotSchema.parse(
        buildAthleteSnapshot({
          activities,
          supplements,
          runningBests,
          recentRunningBests,
          asOfDate,
          timezone: this.timezone,
          generatedAt,
          windows: input.windows,
          providerFreshness,
        }),
      );
    });
  }
  async volume(raw: unknown) {
    const input = volumeInput.parse(raw);
    this.validateTo(input.to);
    return this.read(async (db) => {
      const result = await new AthleteDataRepository(db).volume(input);
      return volumeOutput.parse({
        ...result,
        metadata: this.metadata(input.from, input.to),
        coverage: { archiveCompleteness: 'unknown', emptyBucketMeaning: 'no_retained_sessions' },
      });
    });
  }
  async search(raw: unknown) {
    const i = searchInput.parse(raw);
    this.validateTo(i.to);
    return this.read(async (db) => {
      const result = await new AthleteDataRepository(db).search(i);
      return searchOutput.parse({
        ...result,
        items: result.items.map(activityEvidence),
        metadata: this.metadata(i.from, i.to),
        coverage: { archiveCompleteness: 'unknown', providerReads: 'none' },
      });
    });
  }
  async bests(raw: unknown) {
    const i = bestInput.parse(raw);
    this.validateTo(i.to);
    if (i.discipline === 'run' && (i.distanceM === undefined || !TARGETS.includes(i.distanceM)))
      throw new ToolError(
        'INVALID_INPUT',
        'Running requires a supported exact targetDistance in metres.',
      );
    return this.read(async (db) => {
      if (i.discipline === 'run') {
        const result = await new DistanceLeaderboardRepository(db).read({
          distanceM: i.distanceM!,
          from: i.from,
          to: i.to,
          limit: i.limit,
          offset: i.offset,
        });
        return bestOutput.parse({
          metadata: this.metadata(i.from, i.to),
          discipline: i.discipline,
          method: 'historical_import_or_continuous_effort',
          targetDistanceM: i.distanceM,
          toleranceM: null,
          total: result.total,
          limit: i.limit,
          offset: i.offset,
          items: result.rows.map((r) => ({
            activityId: r.activityId,
            eventId: r.eventId,
            date: r.date,
            durationS: r.durationS,
            source: r.source,
            pausePolicy: r.pausePolicy,
            rank: r.rank,
            alternativeCount: r.alternativeCount,
            method: r.source === 'excel' ? 'historical_import' : 'calculated',
            targetDistanceM: i.distanceM,
          })),
          coverage: result.coverage,
        });
      }
      const toleranceM = i.distanceM === undefined ? null : Math.max(1, i.distanceM * 0.01);
      const result = await new AthleteDataRepository(db).search({
        ...i,
        qualifiedWholeActivity: true,
        minDistanceM: i.distanceM === undefined ? undefined : i.distanceM - toleranceM!,
        maxDistanceM: i.distanceM === undefined ? undefined : i.distanceM + toleranceM!,
        sort: i.distanceM === undefined ? 'pace' : 'elapsed',
      });
      return bestOutput.parse({
        metadata: this.metadata(i.from, i.to),
        discipline: i.discipline,
        method: 'whole_activity',
        targetDistanceM: i.distanceM ?? null,
        toleranceM,
        total: result.total,
        limit: i.limit,
        offset: i.offset,
        items: result.items.map(activityEvidence),
        coverage: {
          conditions: 'subtype_only_course_weather_unknown',
          ranking:
            i.distanceM === undefined
              ? 'session_average_pace_not_interval_record'
              : 'elapsed_seconds_within_1_percent_distance',
          archiveCompleteness: 'unknown',
        },
      });
    });
  }
  async details(raw: unknown) {
    const input = detailsInput.parse(raw),
      { activityId } = input;
    return this.read(async (db) => {
      const result = await new AthleteDataRepository(db).details(activityId, this.today());
      if (!result) throw new ToolError('NOT_FOUND', 'Activity was not found.');
      let laps = unavailableLaps('detail_database_not_configured', {
        limit: input.lapLimit,
        offset: input.lapOffset,
      });
      let swimLengths: Awaited<ReturnType<typeof retainedAthleteSwimLengths>> | null =
        input.includeSwimLengths && result.activity.discipline === 'swim'
          ? unavailableAthleteSwimLengths('detail_database_not_configured', {
              limit: input.swimLengthLimit,
              offset: input.swimLengthOffset,
            })
          : null;
      if (this.detailDb) {
        const ref = await new ActivityProviderResourcesRepository(db).getProviderReference(
          activityId,
        );
        const garmin = await new AthleteDataRepository(db).garminReference(activityId);
        try {
          await assertRuntimeRole(this.detailDb);
          const retained = await this.read(
            async (detail) => ({
              laps: await retainedLaps(detail, activityId, ref, garmin, {
                limit: input.lapLimit,
                offset: input.lapOffset,
                provider: input.lapProvider,
              }),
              swimLengths:
                input.includeSwimLengths && result.activity.discipline === 'swim'
                  ? await retainedAthleteSwimLengths(detail, garmin, {
                      limit: input.swimLengthLimit,
                      offset: input.swimLengthOffset,
                    })
                  : null,
            }),
            this.detailDb,
          );
          laps = retained.laps;
          swimLengths = retained.swimLengths;
        } catch {
          laps = unavailableLaps('retained_laps_unavailable', {
            limit: input.lapLimit,
            offset: input.lapOffset,
          });
          if (swimLengths)
            swimLengths = unavailableAthleteSwimLengths('retained_lengths_unavailable', {
              limit: input.swimLengthLimit,
              offset: input.swimLengthOffset,
            });
        }
      }
      return detailOutput.parse({
        ...result,
        metadata: this.metadata(result.activity.date, result.activity.date),
        activity: activityEvidence(result.activity),
        laps,
        swimLengths,
      });
    });
  }
}
