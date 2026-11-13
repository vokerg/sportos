import type {Generated} from 'kysely';
import type {DateString,GeneratedTimestamp,OwnerId,Timestamp} from './schema.js';
export interface DailyRecalculationCursorsTable {
 owner_id:OwnerId;start_date:DateString;time_zone:string;completed_through:Generated<string|null>;updated_at:GeneratedTimestamp;
}
export type DailyRecalculationStatus='queued'|'running'|'succeeded'|'failed'|'cancelled';
export interface DailyRecalculationJobsTable {
 id:Generated<string>;owner_id:OwnerId;from_date:DateString;to_date:DateString;next_date:DateString;time_zone:string;
 status:Generated<DailyRecalculationStatus>;attempt_count:Generated<number>;
 lease_owner:Generated<string|null>;lease_expires_at:Generated<Date|null>;cancellation_requested_at:Generated<Date|null>;
 error_code:Generated<string|null>;created_at:GeneratedTimestamp;updated_at:GeneratedTimestamp;completed_at:Generated<Date|null>;
}
export interface DailyRecalculationJob {
 id:string;from:string;to:string;nextDate:string;processedDays:number;totalDays:number;
 status:DailyRecalculationStatus;errorCode:string|null;attemptCount:number;
}
export interface DailyRecalculationState {
 cursor:{startDate:string;completedThrough:string|null;timeZone:string};nextDate:string;
 activeJob:DailyRecalculationJob|null;latestJob:DailyRecalculationJob|null;
}
