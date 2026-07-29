import { Inject, Injectable } from '@nestjs/common';
import { ImportsRepository } from '@sportos/db';
import { ImportService, type ImportLocalFilesInput } from '@sportos/importers';
import { DbProvider } from '../db.provider.js';

@Injectable()
export class ImportsService {
  constructor(@Inject(DbProvider) private readonly dbProvider: DbProvider) {}

  importLocalFiles(input: ImportLocalFilesInput) {
    return new ImportService(this.dbProvider.db).importLocalFiles(input);
  }

  history(limit: number, offset: number) {
    return new ImportsRepository(this.dbProvider.db).listBatches(limit, offset);
  }

  detail(batchId: string, diagnosticLimit: number, diagnosticOffset: number) {
    return new ImportsRepository(this.dbProvider.db).getBatchDetail(batchId, diagnosticLimit, diagnosticOffset);
  }
}
