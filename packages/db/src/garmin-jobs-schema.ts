import type {Generated} from 'kysely';
import type {OwnerId,Timestamp,GeneratedTimestamp,DateString,Json} from './schema.js';
export interface GarminConnectionsTable {id:Generated<string>;owner_id:OwnerId;status:Generated<'ready'|'reauthorization_required'|'disconnected'>;revision:Generated<number>;created_at:GeneratedTimestamp;updated_at:GeneratedTimestamp}
export interface GarminCredentialsTable {owner_id:OwnerId;connection_id:string;envelope_json:Json;updated_at:GeneratedTimestamp}
export type GarminJobStatus='queued'|'running'|'succeeded'|'failed'|'cancelled';
export interface GarminJobsTable {id:Generated<string>;owner_id:OwnerId;connection_id:string;operation:'day'|'activity';calendar_date:DateString|null;activity_id:string|null;refresh:boolean;status:Generated<GarminJobStatus>;phase:Generated<string>;attempt_count:Generated<number>;next_attempt_at:GeneratedTimestamp;lease_owner:string|null;lease_expires_at:Timestamp|null;cancellation_requested_at:Timestamp|null;error_code:string|null;created_at:GeneratedTimestamp;updated_at:GeneratedTimestamp;completed_at:Timestamp|null}
export interface GarminWorkerStatusTable {worker_id:string;ready:boolean;checked_at:GeneratedTimestamp}
export interface GarminJob {id:string;operation:'day'|'activity';date:string|null;activityId:string|null;refresh:boolean;status:GarminJobStatus;phase:string;attemptCount:number;errorCode:string|null;createdAt:string;updatedAt:string}
