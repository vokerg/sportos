import { Controller, Get, Inject, Query } from '@nestjs/common';
import { RUNNING_EFFORT_TARGETS } from '@sportos/domain';
import { AthleteDataRepository, DistanceLeaderboardRepository, DynamicsRepository, type WholeActivityRecordTarget } from '@sportos/db';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { CurrentAccount } from '../auth/current-account.decorator.js';
import { DbProvider } from '../db.provider.js';
import { buildDynamicsRecords } from '../dynamics/dynamics.contracts.js';
import { parseDynamicsHistoryQuery } from '../dynamics/dynamics.controller.js';

const WHOLE_ACTIVITY_TARGETS: readonly WholeActivityRecordTarget[] = [
  ...[20_000, 40_000, 100_000].map(targetDistanceM => ({ sport: 'bike' as const, targetDistanceM })),
  ...[400, 800, 1_000, 1_500, 2_000].map(targetDistanceM => ({ sport: 'swim' as const, targetDistanceM })),
];

@Controller('stats')
export class PersonalRecordsController {
  constructor(@Inject(DbProvider) private readonly dbProvider: DbProvider) {}

  @Get('personal-records')
  records(@Query() raw: Record<string, unknown>, @CurrentAccount() account: AuthenticatedAccount) {
    const to = parseDynamicsHistoryQuery(raw);
    return this.dbProvider.withAccount(account.id, async db => {
      const leaders = new DistanceLeaderboardRepository(db);
      const [daily, wholeActivities, running] = await Promise.all([
        new DynamicsRepository(db).listDailyRows('1900-01-01', to),
        new AthleteDataRepository(db).wholeActivityBests(to, WHOLE_ACTIVITY_TARGETS),
        Promise.all(RUNNING_EFFORT_TARGETS.map(async distanceM => {
          const { rows } = await leaders.read({ distanceM, to, limit: 1 });
          const best = rows[0];
          return best ? {
            targetDistanceM: distanceM, activityId: best.activityId,
            date: best.date, durationS: best.durationS, source: best.source,
          } : null;
        })),
      ]);
      return {
        through: to,
        daily: buildDynamicsRecords(daily, to),
        running: running.filter(best => best !== null),
        cycling: wholeActivities.filter(best => best.sport === 'bike'),
        swimming: wholeActivities.filter(best => best.sport === 'swim'),
      };
    });
  }
}
