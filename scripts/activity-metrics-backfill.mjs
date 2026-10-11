import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { createDb, withAccountContext, backfillRetainedActivityMetrics, validateMetricBackfillOptions, sql } from '../packages/db/dist/index.js';
if (existsSync('.env')) loadEnvFile('.env');
const args=process.argv.slice(2).filter(a=>a!=='--');
const values=new Map();
for (let i=0;i<args.length;i++) {
  const name=args[i];
  if (!['--owner','--cursor','--limit','--apply'].includes(name) || values.has(name)) throw new Error('Usage: pnpm activities:project -- --owner UUID [--cursor UUID] [--limit 1..100] [--apply]');
  if (name==='--apply') values.set(name,true);
  else { const value=args[++i]; if (!value || value.startsWith('--')) throw new Error('Missing backfill option.'); values.set(name,value); }
}
const owner=values.get('--owner');
if (typeof owner!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(owner)) throw new Error('Explicit operator --owner UUID is required.');
const options={cursor:values.get('--cursor'),limit:Number(values.get('--limit')??25),dryRun:!values.has('--apply'),retries:1};
validateMetricBackfillOptions(options);
if (!process.env.DATABASE_URL || !process.env.SPORTOS_ACTIVITY_DETAIL_DATABASE_URL) throw new Error('Separate primary and detail runtime URLs are required.');
const primary=createDb(process.env.DATABASE_URL); const detail=createDb(process.env.SPORTOS_ACTIVITY_DETAIL_DATABASE_URL);
try {
  for (const db of [primary,detail]) {
    const role=await sql`select current_user as role, rolsuper, rolbypassrls from pg_roles where rolname=current_user`.execute(db);
    if (role.rows[0]?.role!=='sportos_app' || role.rows[0]?.rolsuper!==false || role.rows[0]?.rolbypassrls!==false) throw new Error('Retained backfill requires the non-owner sportos_app runtime role in both databases.');
  }
  const report=await withAccountContext(primary,owner,db=>backfillRetainedActivityMetrics(db,callback=>withAccountContext(detail,owner,callback),options));
  console.log(JSON.stringify(report));
  if (report.providers.strava.errors || report.providers.garmin.errors) process.exitCode=1;
} catch {
  console.error('Retained metric backfill failed. Check migrations/runtime access and retry the same cursor.'); process.exitCode=1;
} finally { await primary.destroy(); await detail.destroy(); }
