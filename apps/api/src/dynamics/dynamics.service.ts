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
      (db) => new DynamicsRepository(db).listDailyRows(query.from, query.to),
    );
    return buildDynamicsResponse(rows, query);
  }

  async rolling(query: RollingDynamicsQuery, accountId = LEGACY_ACCOUNT_ID) {
    const rows = await this.dbProvider.withAccount(
      accountId,
      (db) => new DynamicsRepository(db).listDailyRows(rollingLookbackFrom(query.from, query.windows), query.to),
    );
    return buildRollingDynamicsResponse(rows, query);
  }
}
