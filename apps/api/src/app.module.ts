import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { ImportsController } from './imports/imports.controller.js';
import { ImportsService } from './imports/imports.service.js';
import { DailyController } from './daily/daily.controller.js';
import { DailyService } from './daily/daily.service.js';
import { ExportsController } from './exports/exports.controller.js';
import { ExportsService } from './exports/exports.service.js';
import { PerformanceController } from './performance/performance.controller.js';
import { RulesController } from './rules/rules.controller.js';
import { RulesService } from './rules/rules.service.js';
import { DbProvider } from './db.provider.js';
import { LocalUploadStorage } from './storage/local-upload-storage.js';
import { UploadStorage } from './storage/upload-storage.js';

@Module({
  controllers: [
    HealthController,
    ImportsController,
    DailyController,
    PerformanceController,
    RulesController,
    ExportsController,
  ],
  providers: [
    DbProvider,
    ImportsService,
    DailyService,
    RulesService,
    ExportsService,
    { provide: UploadStorage, useFactory: () => new LocalUploadStorage() },
  ],
  exports: [DbProvider],
})
export class AppModule {}
