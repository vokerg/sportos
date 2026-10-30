import type { Database,Kysely } from '@sportos/db';
export interface AccountDatabase {withAccount<T>(owner:string,callback:(db:Kysely<Database>)=>Promise<T>):Promise<T>}
export interface RuntimeAccount {id:string;displayName?:string;email?:string|null}
export interface RuntimeAuthorization {isDevelopmentMode():boolean}
export interface StravaStatus {status(owner:string,id:string):Promise<unknown>}
