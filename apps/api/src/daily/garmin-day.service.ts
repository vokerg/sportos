import {Injectable} from '@nestjs/common';
import {GarminDayService as GarminDayRuntime} from '@sportos/garmin-runtime';
import type {GarminDayCategory} from '@sportos/db';
import type {AuthenticatedAccount} from '../auth/auth.models.js';
import {ActivityDetailDbProvider,DbProvider} from '../db.provider.js';
import {UploadStorage} from '../storage/upload-storage.js';
import {ActivityEnrichmentService} from '../activities/activity-enrichment.service.js';
import {GarminJobsService} from '../garmin/garmin-jobs.service.js';
@Injectable()
export class GarminDayService{

 constructor(private primary:DbProvider,private detail:ActivityDetailDbProvider,private storage:UploadStorage,private enrichment:ActivityEnrichmentService,private jobs:GarminJobsService){}
 private runtime(timeZone?:string){return new GarminDayRuntime(this.primary,this.detail,this.storage,this.enrichment.runtime,timeZone)}
 async read(owner:string,date:string){const capability=await this.jobs.capability(owner);const data=await this.runtime(capability.timeZone).read(owner,date);return {...data,fetchEnabled:capability.enabled,fetchAvailability:capability.reason,activeJob:capability.activeJob?.operation==='day'&&capability.activeJob.date===date?capability.activeJob:null}}
 resource(owner:string,date:string,category:GarminDayCategory){return this.runtime().resource(owner,date,category)}
 fetch(account:AuthenticatedAccount,date:string,refresh:boolean,_signal?:AbortSignal){return this.jobs.enqueue(account.id,{operation:'day',date,refresh})}
}
