import {Injectable} from '@nestjs/common';
import {ActivityEnrichmentService as GarminRuntime} from '@sportos/garmin-runtime';
import type {AuthenticatedAccount} from '../auth/auth.models.js';
import {AuthService} from '../auth/auth.service.js';
import {ActivityDetailDbProvider,DbProvider} from '../db.provider.js';
import {UploadStorage} from '../storage/upload-storage.js';
import {ActivityProviderDetailService} from './activity-provider-detail.service.js';
import {ActivityMetricsService} from './activity-metrics.service.js';
import {RunningEffortsService} from './running-efforts.service.js';
import {ActivityRouteProjectionService} from './activity-route-projection.service.js';
import {GarminJobsService} from '../garmin/garmin-jobs.service.js';
@Injectable()
export class ActivityEnrichmentService{
 readonly runtime:GarminRuntime;
 constructor(primary:DbProvider,detail:ActivityDetailDbProvider,storage:UploadStorage,_auth:AuthService,strava:ActivityProviderDetailService,metrics:ActivityMetricsService,efforts:RunningEffortsService,routes:ActivityRouteProjectionService,private jobs:GarminJobsService){this.runtime=new GarminRuntime(primary,detail,storage,{isDevelopmentMode:()=>false},strava,metrics,efforts,routes)}
 async status(owner:string,id:string){const [data,capability]=await Promise.all([this.runtime.status(owner,id),this.jobs.capability(owner)]);return {...data,garmin:{...data.garmin,fetchEnabled:capability.enabled,fetchAvailability:capability.reason,activeJob:capability.activeJob?.operation==='activity'&&capability.activeJob.activityId===id?capability.activeJob:null}}}
 read(owner:string,id:string){return this.runtime.read(owner,id)}
 resource(owner:string,id:string,type:string,chunk:number){return this.runtime.resource(owner,id,type,chunk)}
 async fetch(account:AuthenticatedAccount,id:string,refresh:boolean){await this.runtime.reference(account.id,id);return this.jobs.enqueue(account.id,{operation:'activity',activityId:id,refresh})}
}
