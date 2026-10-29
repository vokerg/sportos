import { ActivityMetricsService } from './activity-metrics.service.js';
import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { GarminActivitiesRepository, GarminReconciliationConflict, LEGACY_ACCOUNT_ID, type GarminActivitySnapshot } from '@sportos/db';
import { validateActivityMatchSummary, type ActivityMatchSummary } from '@sportos/db';
import { CurrentAccount } from '../auth/current-account.decorator.js';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { DbProvider } from '../db.provider.js';
import { assertUuid, parseBoundedInteger } from '../query-validation.js';

import {parseGarminSnapshot} from '@sportos/garmin-runtime';
export {parseGarminSnapshot} from '@sportos/garmin-runtime';

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key=>!keys.includes(key)) || keys.some(key=>!(key in value))) throw new BadRequestException({code:'INVALID_GARMIN_REQUEST',message:'Unsupported Garmin request fields.'});
  return value as Record<string,unknown>;
}
@Controller('garmin/activities')
export class GarminActivitiesController {
  constructor(@Inject(DbProvider) private readonly dbProvider: DbProvider, private readonly metrics?: ActivityMetricsService) {}

  @Post()
  async ingest(@Body() raw: unknown, @CurrentAccount() account?: AuthenticatedAccount) {
    const input = parseGarminSnapshot(raw);
    return this.execute(account, (repo) => repo.ingest(input));
  }

  @Get()
  async list(@Query() raw: Record<string, unknown>, @CurrentAccount() account?: AuthenticatedAccount) {
    if (Object.keys(raw).some((key) => !['limit', 'offset'].includes(key)) || Object.values(raw).some((value) => typeof value !== 'string')) throw new BadRequestException('Invalid Garmin pagination.');
    const limit = parseBoundedInteger(raw.limit as string | undefined, { name: 'limit', defaultValue: 50, min: 1, max: 100 });
    const offset = parseBoundedInteger(raw.offset as string | undefined, { name: 'offset', defaultValue: 0, min: 0, max: 100000 });
    return this.execute(account, (repo) => repo.list(limit, offset));
  }

  @Get(':id')
  async detail(@Param('id') id: string, @CurrentAccount() account?: AuthenticatedAccount) {
    assertUuid(id, 'INVALID_GARMIN_ID');
    const result = await this.execute(account, (repo) => repo.get(id));
    if (!result) throw this.notFound();
    return result;
  }

  @Get(':id/audit')
  async audit(@Param('id') id: string, @CurrentAccount() account?: AuthenticatedAccount) {
    assertUuid(id, 'INVALID_GARMIN_ID');
    return this.execute(account, async (repo) => { if (!await repo.get(id)) throw this.notFound(); return repo.audit(id); });
  }

  @Post(':id/review')
  async review(@Param('id') id: string, @Body() raw: unknown, @CurrentAccount() account?: AuthenticatedAccount) {
    assertUuid(id, 'INVALID_GARMIN_ID');
    const input = object(raw, ['decision', 'activityId']);
    if (!['link', 'reject', 'reopen'].includes(String(input.decision))) throw new BadRequestException('Invalid Garmin review decision.');
    if (input.decision === 'link') {
      if (typeof input.activityId !== 'string') throw new BadRequestException('Activity ID is required.');
      assertUuid(input.activityId, 'INVALID_ACTIVITY_ID');
    } else if (input.activityId !== null) throw new BadRequestException('Activity ID must be null.');
    const result = await this.execute(account, (repo) => repo.review(id, input.decision as 'link' | 'reject' | 'reopen', input.activityId as string | null));
    if (!result) throw this.notFound();
    if (result.activityId && this.metrics) await this.metrics.project(account?.id ?? LEGACY_ACCOUNT_ID,result.activityId);
    return result;
  }

  private async execute<T>(account: AuthenticatedAccount | undefined, callback: (repo: GarminActivitiesRepository) => Promise<T>): Promise<T> {
    try { return await this.dbProvider.withAccount(account?.id ?? LEGACY_ACCOUNT_ID, (db) => callback(new GarminActivitiesRepository(db))); }
    catch (error) { if (error instanceof GarminReconciliationConflict) throw new ConflictException({ code: 'GARMIN_RECONCILIATION_CONFLICT', message: error.message }); throw error; }
  }
  private notFound() { return new NotFoundException({ code: 'GARMIN_ACTIVITY_NOT_FOUND', message: 'Garmin activity was not found.' }); }
}
