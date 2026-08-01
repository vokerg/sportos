import { Inject, Injectable } from '@nestjs/common';
import { CanonicalExportRepository } from '@sportos/db';
import { DbProvider } from '../db.provider.js';

@Injectable()
export class ExportsService {
  constructor(@Inject(DbProvider) private readonly dbProvider: DbProvider) {}

  canonical(from: string, to: string) {
    return new CanonicalExportRepository(this.dbProvider.db).buildBundle(from, to);
  }
}
