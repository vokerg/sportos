import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { createDb, withAccountContext, LEGACY_ACCOUNT_ID, GarminActivitiesRepository, sql } from '../packages/db/dist/index.js';
if (existsSync('.env')) loadEnvFile('.env');
const args = process.argv.slice(2).filter(arg => arg !== '--');
const flags = new Map();
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (!['--apply', '--all', '--cursor', '--limit'].includes(key) || flags.has(key)) throw new Error('Usage: pnpm garmin:reconcile -- [--apply] [--all] [--cursor UUID] [--limit 1..100]');
  if (key === '--apply' || key === '--all') flags.set(key, true);
  else { const value = args[++i]; if (!value || value.startsWith('--')) throw new Error('Missing reconciliation option.'); flags.set(key, value); }
}
if (process.env.SPORTOS_AUTH_MODE !== 'dev-single-user' || process.env.NODE_ENV === 'production') throw new Error('Retained replay requires local dev-single-user mode.');
if (!process.env.DATABASE_URL) throw new Error('Primary runtime URL is required.');
const limit = Number(flags.get('--limit') ?? 100);
let cursor = flags.get('--cursor');
if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor !== undefined && !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(cursor))) throw new Error('Invalid reconciliation pagination.');
const db = createDb(process.env.DATABASE_URL);
try {
  const role = await sql`select current_user as role, rolsuper, rolbypassrls from pg_roles where rolname=current_user`.execute(db);
  if (role.rows[0]?.role !== 'sportos_app' || role.rows[0]?.rolsuper || role.rows[0]?.rolbypassrls) throw new Error('Unexpected runtime role.');
  let examined = 0;
  do {
    const report = await withAccountContext(db, LEGACY_ACCOUNT_ID, ctx => new GarminActivitiesRepository(ctx).reconcileRetained({limit, cursor, dryRun: !flags.has('--apply')}));
    examined += report.examined;
    console.log(JSON.stringify({...report, fetched: false, canonicalWrites: false, scoreWrites: false}));
    cursor = report.nextCursor ?? undefined;
    if (flags.has('--all') && cursor && examined >= 10000) throw new Error('Retained replay bound exceeded; resume using the reported cursor.');
  } while (flags.has('--all') && cursor);
} catch {
  console.error('Retained Garmin replay failed; prior committed links are safe. Check migrations/runtime access and resume from the last reported cursor.');
  process.exitCode = 1;
} finally { await db.destroy(); }
