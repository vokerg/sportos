import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { createDb, withAccountContext, HistoricalRunsRepository, sql } from '../packages/db/dist/index.js';
if (existsSync('.env')) loadEnvFile('.env');
const args=process.argv.slice(2).filter(a=>a!=='--'),options=new Map();
for(let i=0;i<args.length;i++) {
 const key=args[i];if(!['--owner','--from','--to','--cursor','--limit','--apply'].includes(key)||options.has(key))throw Error('Invalid historical options.');
 options.set(key,key==='--apply'?true:args[++i]);
}
const owner=options.get('--owner');if(typeof owner!=='string'||!/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(owner))throw Error('Explicit account UUID required.');
const db=createDb();try {
 const role=(await sql`select current_user as role,rolsuper,rolbypassrls from pg_roles where rolname=current_user`.execute(db)).rows[0];
 if(role?.role!=='sportos_app'||role.rolsuper||role.rolbypassrls)throw Error('Requires non-owner app connection.');
 const result=await withAccountContext(db,owner,d=>new HistoricalRunsRepository(d).run({from:options.get('--from'),to:options.get('--to'),cursor:options.get('--cursor'),limit:Number(options.get('--limit')??100),apply:options.has('--apply')}));
 // Private dates/provenance: terminal or private local report only.
 console.log(JSON.stringify(result));
} catch { console.error('Historical reconstruction failed. Check bounded options, runtime access and migrations. Retry the same cursor.');process.exitCode=1; }
finally {await db.destroy();}
