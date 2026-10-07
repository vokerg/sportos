import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { GarminActivitiesRepository, GarminReconciliationConflict, LEGACY_ACCOUNT_ID, type GarminActivitySnapshot } from '@sportos/db';
import { validateActivityMatchSummary, type ActivityMatchSummary } from '@sportos/db';
import { CurrentAccount } from '../auth/current-account.decorator.js';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { DbProvider } from '../db.provider.js';
import { assertUuid, parseBoundedInteger } from '../query-validation.js';

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !(key in value))) {
    throw new BadRequestException({ code: 'INVALID_GARMIN_REQUEST', message: 'Unsupported Garmin request fields.' });
  }
  return value as Record<string, unknown>;
}
function timestamp(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value)) throw new BadRequestException('Garmin timestamps require an explicit UTC offset.');
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) throw new BadRequestException('Invalid Garmin timestamp.');
  const date = new Date(value);
  const calendar = value.slice(0, 10);
  if (!Number.isFinite(date.getTime()) || new Date(`${calendar}T00:00:00Z`).toISOString().slice(0, 10) !== calendar) throw new BadRequestException('Invalid Garmin timestamp.');
  return date;
}
export function parseGarminSnapshot(raw: unknown): GarminActivitySnapshot {
  const input = object(raw, ['providerActivityId', 'contentHash', 'origin', 'sourceUpdatedAt', 'summary']);
  const s = object(input.summary, ['activityType', 'subtype', 'startTime', 'elapsedTimeS', 'movingTimeS', 'distanceM']);
  const summary: ActivityMatchSummary = {
    activityType: s.activityType as ActivityMatchSummary['activityType'], subtype: s.subtype as ActivityMatchSummary['subtype'],
    startTime: timestamp(s.startTime), elapsedTimeS: s.elapsedTimeS as number | null, movingTimeS: s.movingTimeS as number | null, distanceM: s.distanceM as number | null,
  };
  try { validateActivityMatchSummary(summary); } catch { throw new BadRequestException('Invalid Garmin matching summary.'); }
  if ((input.providerActivityId !== null && (typeof input.providerActivityId !== 'string' || !/^[0-9]{1,20}$/.test(input.providerActivityId) || BigInt(input.providerActivityId) === 0n))
    || typeof input.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(input.contentHash) || !['archive', 'connect'].includes(String(input.origin))) throw new BadRequestException('Invalid Garmin source metadata.');
  return { provider: 'garmin', providerActivityId: input.providerActivityId as string | null, contentHash: input.contentHash,
    origin: input.origin as 'archive' | 'connect', sourceUpdatedAt: timestamp(input.sourceUpdatedAt), summary };
}

@Controller('garmin/activities')
export class GarminActivitiesController {
  constructor(@Inject(DbProvider) private readonly dbProvider: DbProvider) {}

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
    return result;
  }

  private async execute<T>(account: AuthenticatedAccount | undefined, callback: (repo: GarminActivitiesRepository) => Promise<T>): Promise<T> {
    try { return await this.dbProvider.withAccount(account?.id ?? LEGACY_ACCOUNT_ID, (db) => callback(new GarminActivitiesRepository(db))); }
    catch (error) { if (error instanceof GarminReconciliationConflict) throw new ConflictException({ code: 'GARMIN_RECONCILIATION_CONFLICT', message: error.message }); throw error; }
  }
  private notFound() { return new NotFoundException({ code: 'GARMIN_ACTIVITY_NOT_FOUND', message: 'Garmin activity was not found.' }); }
}
