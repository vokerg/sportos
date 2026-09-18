import { Inject, Injectable } from '@nestjs/common';
import { DynamicsRepository, LEGACY_ACCOUNT_ID } from '@sportos/db';
import { DbProvider } from '../db.provider.js';
import {
  buildDynamicsResponse,
  buildRollingDynamicsResponse,
  rollingLookbackFrom,
  type DynamicsQuery,
  type RollingDynamicsQuery,
} from './dynamics.contracts.js';

@Injectable()
export class DynamicsService {
  constructor(@Inject(DbProvider) private readonly dbProvider: DbProvider) {}

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
