import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ImportService } from '@sportos/importers';
import { DbProvider } from '../db.provider.js';

@Controller('imports')
export class ImportsController {
  constructor(@Inject(DbProvider) private readonly dbProvider: DbProvider) {}

  @Post('local-files')
  async importLocalFiles(@Body() body: { mySportPath?: string; runDbPath?: string }) {
    const service = new ImportService(this.dbProvider.db);
    return service.importLocalFiles(body);
  }
}
