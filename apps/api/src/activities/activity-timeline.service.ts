import { Injectable, NotFoundException } from '@nestjs/common';
import { ActivitiesRepository, ActivityProviderResourcesRepository, GarminActivityResourcesRepository } from '@sportos/db';
import { ActivityDetailDbProvider, DbProvider } from '../db.provider.js';
import { garminTimeline, MAX_TIMELINE_SAMPLES, stravaTimeline, unavailableTimeline, type TimelineSource } from './activity-timeline.js';

/** Retained reads only: no provider client, helper, credential, scoring or write dependency. */
@Injectable()
export class ActivityTimelineService {
  constructor(private readonly primary: DbProvider, private readonly detail: ActivityDetailDbProvider) {}
  async read(owner: string, id: string, source: TimelineSource) {
    const refs = await this.primary.withAccount(owner, async db => {
      if (!await new ActivitiesRepository(db).get(id)) throw new NotFoundException('Activity was not found.');
      return source === 'strava'
        ? { strava: await new ActivityProviderResourcesRepository(db).getProviderReference(id), garmin: undefined }
        : { strava: null, garmin: await db.selectFrom('garmin_activity_identities').select(['identity_key','current_hash']).where('activity_id','=',id).executeTakeFirst() };
    });
    if (source === 'strava') {
      if (!refs.strava) return unavailableTimeline(source, 'not_linked');
      const ref = refs.strava;
      const row = await this.detail.withAccount(owner, db => new ActivityProviderResourcesRepository(db).streams(ref));
      if (!row) return unavailableTimeline(source, 'not_retained');
      if (row.providerVersion !== ref.providerVersion) return unavailableTimeline(source, 'stale');
      if (row.availability !== 'available') return unavailableTimeline(source, 'not_recorded');
      return stravaTimeline(row.payload);
    }
    if (!refs.garmin) return unavailableTimeline(source, 'not_linked');
    const ref = { identityKey: refs.garmin.identity_key, sourceHash: refs.garmin.current_hash };
    return this.detail.withAccount(owner, async db => {
      const repo = new GarminActivityResourcesRepository(db);
      const [coverage, expected] = await Promise.all([repo.coverage(ref), repo.expectedResources(ref)]);
      if (!coverage.length) return unavailableTimeline(source, 'not_retained');
      if (!Array.isArray(expected) || expected.length < 3 || expected.length > 100 || !expected.every(item => item && typeof item === 'object' && !Array.isArray(item)
        && coverage.some(c => c.resourceType === item.resourceType && c.chunkIndex === item.chunkIndex))) return unavailableTimeline(source, 'incomplete_resources');
      const chunks = coverage.filter(c => c.resourceType === 'records').sort((a,b) => a.chunkIndex-b.chunkIndex);
      if (!chunks.length || chunks.length > 100 || chunks.some((c,i) => c.chunkIndex !== i)) return unavailableTimeline(source, 'incomplete_resources');
      const messages: unknown[] = [];
      for (const chunk of chunks) {
        for (const message of await repo.timelineRecords(ref, chunk.chunkIndex, MAX_TIMELINE_SAMPLES + 1 - messages.length)) messages.push(message);
        if (messages.length > MAX_TIMELINE_SAMPLES) return unavailableTimeline(source, 'sample_limit_or_missing');
      }
      return garminTimeline(messages);
    });
  }
}
