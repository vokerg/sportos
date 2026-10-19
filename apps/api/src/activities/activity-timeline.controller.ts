import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { LEGACY_ACCOUNT_ID } from '@sportos/db';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { CurrentAccount } from '../auth/current-account.decorator.js';
import { assertUuid } from '../query-validation.js';
import { ActivityTimelineService } from './activity-timeline.service.js';
@Controller('activities')
export class ActivityTimelineController {
  constructor(private readonly timeline: ActivityTimelineService) {}
  @Get(':activityId/timeline')
  read(@Param('activityId') id: string, @Query() query: Record<string, unknown>, @CurrentAccount() account?: AuthenticatedAccount) {
    assertUuid(id, 'INVALID_ACTIVITY_ID');
    if (Object.keys(query).some(k => k !== 'source') || !['strava','garmin'].includes(query.source as string)) throw new BadRequestException('Choose Strava or Garmin.');
    return this.timeline.read(account?.id ?? LEGACY_ACCOUNT_ID, id, query.source as 'strava' | 'garmin');
  }
}
