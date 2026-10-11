import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { RetainedActivityMetricsProjector } from '@sportos/db';
import { ActivityDetailDbProvider, DbProvider } from '../db.provider.js';
/** POST workflows call this after retention/cache reuse. Reads remain read-only. */
@Injectable()
export class ActivityMetricsService {
  constructor(private readonly primary:DbProvider,private readonly detail:ActivityDetailDbProvider) {}
  async project(accountId:string,activityId:string) {
    try { return await this.primary.withAccount(accountId,db=>new RetainedActivityMetricsProjector(db,callback=>this.detail.withAccount(accountId,callback)).project(activityId)); }
    catch { throw new ServiceUnavailableException({code:'METRIC_PROJECTION_UNAVAILABLE',message:'Retained activity metrics could not be normalized. Retained data is safe; retry normalization.'}); }
  }
}
