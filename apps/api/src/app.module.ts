import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AnalysisController } from './analysis/analysis.controller.js';
import { AnalysisService } from './analysis/analysis.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { SessionGuard } from './auth/session.guard.js';
import { HealthController } from './health/health.controller.js';
import { ImportsController } from './imports/imports.controller.js';
import { ImportsService } from './imports/imports.service.js';
import { DailyController } from './daily/daily.controller.js';
import { DailyService } from './daily/daily.service.js';
import { ExportsController } from './exports/exports.controller.js';
import { ExportsService } from './exports/exports.service.js';
import { PerformanceController } from './performance/performance.controller.js';
import { ProvidersController } from './providers/providers.controller.js';
import { ProvidersService } from './providers/providers.service.js';
import { RulesController } from './rules/rules.controller.js';
import { RulesService } from './rules/rules.service.js';
import { DbProvider } from './db.provider.js';
import { LocalUploadStorage } from './storage/local-upload-storage.js';
import { UploadStorage } from './storage/upload-storage.js';

@Module({
  controllers: [
    AuthController,
    HealthController,
    ImportsController,
    DailyController,
    PerformanceController,
    RulesController,
    ExportsController,
    ProvidersController,
    AnalysisController,
  ],
  providers: [
    DbProvider,
    AuthService,
    ImportsService,
    DailyService,
    RulesService,
    ExportsService,
    ProvidersService,
    AnalysisService,
    SessionGuard,
    { provide: APP_GUARD, useExisting: SessionGuard },
    { provide: UploadStorage, useFactory: () => new LocalUploadStorage() },
  ],
  exports: [DbProvider],
})
export class AppModule {}
