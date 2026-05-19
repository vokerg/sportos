import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { ImportsController } from './imports/imports.controller.js';
import { DailyController } from './daily/daily.controller.js';
import { PerformanceController } from './performance/performance.controller.js';
import { DbProvider } from './db.provider.js';

@Module({
  controllers: [HealthController, ImportsController, DailyController, PerformanceController],
  providers: [DbProvider],
  exports: [DbProvider],
})
export class AppModule {}
