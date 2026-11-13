/** Explicit maintained-account initialization; never scores or rewinds progress. */
import {createDb,withAccountContext,LEGACY_ACCOUNT_ID,DailyRecalculationRepository,isIsoDate,sql,loadEnvFromNearestFile} from '../packages/db/dist/index.js';
loadEnvFromNearestFile();
const [date,zone,...extra]=process.argv.slice(2).filter(value=>value!=='--');
if(!isIsoDate(date??'')||!zone||extra.length)throw new Error('Usage: pnpm daily:calculation-seed -- YYYY-MM-DD IANA_TIME_ZONE');
const value=process.env.SPORTOS_WORKER_DATA_DATABASE_URL?.trim();
if(!value)throw new Error('The separate non-owner worker-data connection is required.');
const db=createDb(value);
try{
 const role=(await sql`select rolsuper,rolbypassrls,pg_has_role(current_user,'sportos_worker_data','MEMBER') as worker_data from pg_roles where rolname=current_user`.execute(db)).rows[0];
 if(!role||role.rolsuper||role.rolbypassrls||!role.worker_data)throw new Error('A non-owner worker-data role is required.');
 const calendar=(await sql`select name,(now() AT TIME ZONE name)::date::text as today from pg_timezone_names where name=${zone}`.execute(db)).rows[0];
 if(!calendar||date>calendar.today||Date.parse(calendar.today)-Date.parse(date)>3660*86400000)throw new Error('Select a valid calendar and a start within the last 3,661 days.');
 await withAccountContext(db,LEGACY_ACCOUNT_ID,scoped=>new DailyRecalculationRepository(scoped).initialize(date,zone));
 console.log('Calculation cursor initialized. No scores were changed.');
}finally{await db.destroy()}
