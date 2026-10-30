import {Injectable,BadRequestException,ConflictException,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {GarminJobsRepository,GarminQueueError,type GarminTarget} from '@sportos/db';
import {garminLocalDate} from '@sportos/garmin-runtime';
import {DbProvider} from '../db.provider.js';
@Injectable()
export class GarminJobsService{
 constructor(private db:DbProvider){}
 async capability(owner:string){return this.db.withAccount(owner,async db=>{
  const repo=new GarminJobsRepository(db);return {...await repo.capability(),activeJob:await repo.active()};
 })}
 async enqueue(owner:string,target:GarminTarget){if(target.operation==='day'&&target.date>garminLocalDate(new Date(),(await this.capability(owner)).timeZone))throw new BadRequestException('Select today or an earlier Garmin calendar date.');return this.execute(owner,repo=>repo.enqueue(target))}
 async get(owner:string,id:string){const job=await this.execute(owner,repo=>repo.get(id));if(!job)throw new NotFoundException('Garmin job was not found.');return job}
 async cancel(owner:string,id:string){const job=await this.execute(owner,repo=>repo.cancel(id));if(!job)throw new NotFoundException('Garmin job was not found.');return job}
 async retry(owner:string,id:string){const job=await this.execute(owner,repo=>repo.retry(id));if(!job)throw new NotFoundException('Garmin job was not found.');return job}
 private async execute<T>(owner:string,fn:(repo:GarminJobsRepository)=>Promise<T>){
  try{return await this.db.withAccount(owner,db=>fn(new GarminJobsRepository(db)))}catch(e){
   if(e instanceof GarminQueueError){
    if(e.code==='NOT_FOUND')throw new NotFoundException('Garmin target was not found.');
    if(e.code==='BUSY')throw new ConflictException({code:'GARMIN_JOB_ACTIVE',message:'Another Garmin request is active. Check its status before requesting another.'});
    throw new ServiceUnavailableException({code:e.code==='NOT_CONNECTED'?'GARMIN_REAUTHORIZATION_REQUIRED':'GARMIN_WORKER_OFFLINE',message:e.code==='NOT_CONNECTED'?'Connect or reconnect Garmin to try again.':'The Garmin worker is offline. Retry after it reconnects.'});
   }throw e;
  }
 }
}
