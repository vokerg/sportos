import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ActivityMetricsRepository, RetainedRunningEffortProjector, RunningEffortsRepository, effortInspectionTime, sql } from '@sportos/db';
import { ActivityDetailDbProvider, DbProvider } from '../db.provider.js';
@Injectable()
export class RunningEffortsService {
  constructor(private readonly primary: DbProvider, private readonly detail: ActivityDetailDbProvider) {}
  async project(accountId: string, activityId: string, provider?: 'strava' | 'garmin') {
    try { return await this.primary.withAccount(accountId, db => new RetainedRunningEffortProjector(db, callback => this.detail.withAccount(accountId, callback)).project(activityId, false, provider)); }
    catch { throw new ServiceUnavailableException({ code: 'EFFORT_PROJECTION_UNAVAILABLE', message: 'Retained running efforts could not be processed. Retained evidence is safe; retry retained processing.' }); }
  }
  /** Before replacing mutable Strava streams, hide old results even if the
   * process stops between the two database commits. Garmin versions are immutable. */
  async invalidate(accountId: string, activityId: string, streams: unknown) {
    try { await this.primary.withAccount(accountId, async db => {
      const activity = await db.selectFrom('activities').select('activity_type').where('id', '=', activityId).executeTakeFirst();
      if (activity?.activity_type !== 'run') return;
      const ref = (await new ActivityMetricsRepository(db).references([activityId])).find(r => r.provider === 'strava');
      if (ref) {
        const hash=(await sql<{hash:string}>`select md5(${JSON.stringify(streams ?? null)}::jsonb::text) as hash`.execute(db)).rows[0]!.hash;
        await new RunningEffortsRepository(db).mark(ref, 'stale', await effortInspectionTime(db), null, hash);
      }
    }); } catch {
      throw new ServiceUnavailableException({ code:'EFFORT_PROJECTION_UNAVAILABLE', message:'Running effort freshness could not be updated. Retained evidence is safe; retry the explicit fetch.' });
    }
  }
}
