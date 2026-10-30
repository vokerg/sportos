import { RetainedActivityMetricsProjector,RetainedRunningEffortProjector } from '@sportos/db';
import type {AccountDatabase} from './context.js';
export class ActivityMetricsService {
 constructor(private primary:AccountDatabase,private detail:AccountDatabase){}
 project(owner:string,id:string){return this.primary.withAccount(owner,db=>new RetainedActivityMetricsProjector(db,cb=>this.detail.withAccount(owner,cb)).project(id))}
}
export class RunningEffortsService {
 constructor(private primary:AccountDatabase,private detail:AccountDatabase){}
 project(owner:string,id:string,provider?:'strava'|'garmin'){return this.primary.withAccount(owner,db=>new RetainedRunningEffortProjector(db,cb=>this.detail.withAccount(owner,cb)).project(id,false,provider))}
}
