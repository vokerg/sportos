import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { LEGACY_ACCOUNT_ID } from '@sportos/db';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { CurrentAccount } from '../auth/current-account.decorator.js';
import { assertUuid, parseBoundedInteger } from '../query-validation.js';
import { ActivityEnrichmentService } from './activity-enrichment.service.js';

@Controller('activities')
export class ActivityEnrichmentController {
  constructor(private readonly enrichment: ActivityEnrichmentService) {}
  @Get(':activityId/enrichment')
  status(@Param('activityId') id: string, @CurrentAccount() account?: AuthenticatedAccount) { assertUuid(id, 'INVALID_ACTIVITY_ID'); return this.enrichment.status(account?.id ?? LEGACY_ACCOUNT_ID, id); }
  @Get(':activityId/garmin-detail')
  read(@Param('activityId') id: string, @CurrentAccount() account?: AuthenticatedAccount) { assertUuid(id, 'INVALID_ACTIVITY_ID'); return this.enrichment.read(account?.id ?? LEGACY_ACCOUNT_ID, id); }
  @Get(':activityId/garmin-detail/resource')
  resource(@Param('activityId') id: string, @Query() query: Record<string, unknown>, @CurrentAccount() account?: AuthenticatedAccount) {
    assertUuid(id, 'INVALID_ACTIVITY_ID');
    if (Object.keys(query).some(key => !['resourceType','chunkIndex'].includes(key)) || typeof query.resourceType !== 'string' || (query.chunkIndex !== undefined && typeof query.chunkIndex !== 'string')) throw new BadRequestException('Invalid Garmin resource request.');
    return this.enrichment.resource(account?.id ?? LEGACY_ACCOUNT_ID, id, query.resourceType, parseBoundedInteger(query.chunkIndex as string | undefined, { name: 'chunkIndex', defaultValue: 0, min: 0, max: 10000 }));
  }
  @Post(':activityId/garmin-detail')
  fetch(@Param('activityId') id: string, @Body() raw: unknown, @CurrentAccount() account?: AuthenticatedAccount) {
    assertUuid(id, 'INVALID_ACTIVITY_ID'); const body = raw ?? {};
    if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'refresh') || ('refresh' in body && typeof body.refresh !== 'boolean')) throw new BadRequestException('Invalid Garmin fetch request.');
    return this.enrichment.fetch(account ?? { id: LEGACY_ACCOUNT_ID } as AuthenticatedAccount, id, 'refresh' in body && body.refresh === true);
  }
}
