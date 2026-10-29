/** Disposable loopback-only Flyway/role regression gate. Never uses .env or Neon. */
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createDb,sql} from '../packages/db/dist/index.js';
const value=process.env.SPORTOS_GARMIN_DISPOSABLE_ADMIN_URL;
if(!value)throw new Error('SPORTOS_GARMIN_DISPOSABLE_ADMIN_URL is required');
const adminUrl=new URL(value);
if(adminUrl.hostname!=='127.0.0.1'||adminUrl.pathname!=='/postgres')throw new Error('A fresh disposable loopback PostgreSQL cluster is required');
const admin=createDb(value),password='garmin-integration-only';
const primary='sportos_garmin_ci_primary',detail='sportos_activity_detail',fresh='sportos_garmin_ci_fresh',freshDetail='sportos_garmin_ci_detail_fresh';
const url=(database,user=adminUrl.username,secret=adminUrl.password)=>{const u=new URL(adminUrl);u.pathname='/'+database;u.username=user;u.password=secret;return u.toString()};
function migrate(database,folder,target){
 const args=['-url=jdbc:postgresql://'+adminUrl.host+'/'+database,'-user='+decodeURIComponent(adminUrl.username),'-password='+decodeURIComponent(adminUrl.password),'-locations=filesystem:'+resolve(folder),...(target?['-target='+target]:[]),'migrate'];
 const result=spawnSync('flyway',args,{stdio:'inherit'});if(result.status!==0)throw new Error('Disposable Flyway migration failed');
}
async function query(database,text){const db=createDb(url(database));try{return await sql.raw(text).execute(db)}finally{await db.destroy()}}
try{
 for(const name of [primary,detail,fresh,freshDetail]){if((await sql`select 1 from pg_database where datname=${name}`.execute(admin)).rows.length)throw new Error('Disposable database already exists; use a fresh cluster');await sql`create database ${sql.id(name)}`.execute(admin)}
 migrate(primary,'flyway/sql','142');migrate(detail,'flyway/activity-detail-sql','4');
 await query(primary,`INSERT INTO garmin_day_versions(owner_id,calendar_date,category,source_hash,availability,projection_json,retrieved_at) VALUES('00000000-0000-4000-8000-000000000001','2000-01-01','summary',repeat('a',64),'available','{"steps":100}',now())`);
 await query(detail,`INSERT INTO garmin_day_resources(owner_id,calendar_date,category,source_hash,payload_json) VALUES('00000000-0000-4000-8000-000000000001','2000-01-01','summary',repeat('a',64),'{"totalSteps":100}')`);
 migrate(primary,'flyway/sql');migrate(detail,'flyway/activity-detail-sql');
 migrate(fresh,'flyway/sql');migrate(freshDetail,'flyway/activity-detail-sql');
 for(const name of [detail,freshDetail]){
  await query(name,`REVOKE CONNECT ON DATABASE "${name}" FROM PUBLIC; GRANT CONNECT ON DATABASE "${name}" TO sportos_app;`);
  const check=await query(name,`SELECT has_database_privilege('sportos_worker_data',current_database(),'CONNECT') AS allowed`);if(!check.rows[0]?.allowed)throw new Error('Worker detail CONNECT regression');
 }
 if((await query(primary,`select count(*)::int as count from garmin_day_versions where calendar_date='2000-01-01'`)).rows[0].count!==1)throw new Error('Primary upgrade lost retained evidence');
 if((await query(detail,`select count(*)::int as count from garmin_day_resources where calendar_date='2000-01-01'`)).rows[0].count!==1)throw new Error('Detail upgrade lost retained evidence');
 for(const name of ['sportos_app','sportos_worker','sportos_worker_data'])await sql.raw(`ALTER ROLE ${name} LOGIN PASSWORD '${password}'`).execute(admin);
 await sql.raw(`CREATE ROLE sportos_garmin_ci_detail_worker LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS IN ROLE sportos_worker_data`).execute(admin);
 const env={...process.env,SPORTOS_GARMIN_TEST_APP_URL:url(primary,'sportos_app',password),SPORTOS_GARMIN_TEST_DATA_URL:url(primary,'sportos_worker_data',password),SPORTOS_GARMIN_TEST_DISPATCH_URL:url(primary,'sportos_worker',password),SPORTOS_GARMIN_TEST_DETAIL_URL:url(detail,'sportos_garmin_ci_detail_worker',password)};
 const result=spawnSync('pnpm',['--filter','@sportos/worker','exec','vitest','run','src/garmin-job-runner.integration.test.ts','--no-file-parallelism'],{env,stdio:'inherit'});if(result.status!==0)throw new Error('Garmin role/worker integration failed');
 console.log('Fresh/populated primary/detail migrations, connection grants, encrypted sessions and non-owner Garmin worker checks passed.');
}finally{await admin.destroy()}
