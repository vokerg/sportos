import { Inject, Injectable } from '@nestjs/common';
import { CanonicalExportRepository, LEGACY_ACCOUNT_ID } from '@sportos/db';
import { DbProvider } from '../db.provider.js';

@Injectable()
export class ExportsService {
  constructor(@Inject(DbProvider) private readonly dbProvider: DbProvider) {}

  canonical(from: string, to: string, accountId = LEGACY_ACCOUNT_ID) {
    return this.dbProvider.withAccount(accountId, (db) => new CanonicalExportRepository(db).buildBundle(from, to));
  }
}
