import { Inject, Injectable } from '@nestjs/common';
import { DynamicsRepository, LEGACY_ACCOUNT_ID } from '@sportos/db';
import { DbProvider } from '../db.provider.js';
import {
  buildDynamicsResponse,
  buildDynamicsHistory,
  buildRollingDynamicsResponse,
  rollingLookbackFrom,
  type DynamicsQuery,
  type RollingDynamicsQuery,
} from './dynamics.contracts.js';

@Injectable()
export class DynamicsService {
  constructor(@Inject(DbProvider) private readonly dbProvider: DbProvider) {}

  async history(to: string, accountId = LEGACY_ACCOUNT_ID) {
    return this.dbProvider.withAccount(accountId, async (db) => {
      // One repeatable snapshot: totals, ledger mix and records cannot straddle a recalculation.
      return db.transaction().setIsolationLevel('repeatable read').execute(async (trx) => {
        const repository = new DynamicsRepository(trx);
        const daily = await repository.listDailyRows('1900-01-01', to);
        const contributions = daily.length ? await repository.listScoreContributions(daily[0]!.metricDate, to, { importedFallback: 'unattributed' }) : [];
        return buildDynamicsHistory(daily, to, contributions);
      });
    });
  }

  async read(query: DynamicsQuery, accountId = LEGACY_ACCOUNT_ID) {
    const rows = await this.dbProvider.withAccount(
      accountId,
      async (db) => {
        const repository = new DynamicsRepository(db);
        const [dailyRows, contributionRows] = await Promise.all([
          repository.listDailyRows(query.from, query.to),
          repository.listScoreContributions(query.from, query.to),
        ]);
        return { dailyRows, contributionRows };
      },
    );
    return buildDynamicsResponse(rows.dailyRows, query, rows.contributionRows);
  }

  async rolling(query: RollingDynamicsQuery, accountId = LEGACY_ACCOUNT_ID) {
    const rows = await this.dbProvider.withAccount(
      accountId,
      async (db) => {
        const repository = new DynamicsRepository(db);
        const lookbackFrom = rollingLookbackFrom(query.from, [...query.windows, 30]);
        const [dailyRows, contributionRows] = await Promise.all([
          repository.listDailyRows(lookbackFrom, query.to),
          repository.listScoreContributions(lookbackFrom, query.to),
        ]);
        return { dailyRows, contributionRows };
      },
    );
    return buildRollingDynamicsResponse(rows.dailyRows, query, rows.contributionRows);
  }
}
