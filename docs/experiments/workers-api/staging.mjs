import '../../../apps/api/node_modules/reflect-metadata/Reflect.js';
import { timingSafeEqual } from 'node:crypto';
import { sql } from '../../../packages/db/dist/index.js';
import { httpServerHandler } from 'cloudflare:node';
import { NestFactory } from '../../../apps/api/node_modules/@nestjs/core/index.js';
import { ExpressAdapter } from '../../../apps/api/node_modules/@nestjs/platform-express/index.js';
import { AppModule } from '../../../apps/api/dist/app.module.js';
import { sportosCorsOptions } from '../../../apps/api/dist/cors-options.js';
import { validateHostedEnvironment } from '../../../apps/api/dist/hosted-config.js';
import { ActivityDetailDbProvider, DbProvider } from '../../../apps/api/dist/db.provider.js';
import { withRequestDatabases } from '../../../apps/api/dist/request-databases.js';

const env = process.env;
const sharedDatabaseTrial = env.SPORTOS_SHARED_DATABASE_TRIAL === 'true';
const trialToken = env.SPORTOS_TRIAL_PROBE_TOKEN ?? '';
const expiresAt = Date.parse(env.SPORTOS_TRIAL_EXPIRES_AT ?? '');
const maximumTrialDuration = 15 * 60_000;
if (sharedDatabaseTrial && (!/^[a-f0-9]{64}$/.test(trialToken) || !Number.isFinite(expiresAt))) {
  throw new Error('The shared-database trial requires a short-lived private probe token.');
}
if (env.SPORTOS_WORKERS_STAGING !== 'true' || env.NODE_ENV !== 'production'
  || env.SPORTOS_AUTH_MODE !== 'single-user-google' || env.SPORTOS_GOOGLE_ENROLLMENT === 'true') {
  throw new Error('The Workers trial requires Google-only staged authentication.');
}
validateHostedEnvironment(env);
const webOrigin = new URL(env.SPORTOS_WEB_ORIGIN);
const apiOrigin = new URL(env.SPORTOS_API_ORIGIN);
if (apiOrigin.origin !== webOrigin.origin || apiOrigin.pathname !== '/api' || webOrigin.pathname !== '/'
  || webOrigin.hostname === 'sportos-delta.vercel.app') {
  throw new Error('Use a dedicated staging web origin with a same-origin /api proxy.');
}

function validateDatabase(value, expectedDatabase) {
  const url = new URL(value ?? '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || url.username !== 'sportos_app'
    || (!sharedDatabaseTrial && url.pathname !== `/${expectedDatabase}`)
    || (sharedDatabaseTrial && !url.hostname.endsWith('.neon.tech'))
    || /-pooler\./.test(url.hostname)) {
    throw new Error('Use direct, non-owner, isolated SportOS trial database connections.');
  }
  if (!['localhost', '127.0.0.1'].includes(url.hostname) && url.searchParams.get('sslmode') !== 'verify-full') {
    throw new Error('Remote staging database connections must verify TLS.');
  }
}
validateDatabase(env.SPORTOS_STAGING_DATABASE_URL, 'sportos_trial_primary');
validateDatabase(env.SPORTOS_STAGING_ACTIVITY_DETAIL_DATABASE_URL, 'sportos_trial_detail');

const app = await NestFactory.create(AppModule, new ExpressAdapter(), {
  logger: false,
  abortOnError: false,
});
app.getHttpAdapter().getInstance().disable('x-powered-by');
app.enableCors(sportosCorsOptions(webOrigin.origin));
await app.init();
const server = httpServerHandler(app.getHttpServer());

async function probeDatabase(database) {
  return database.db.transaction().execute(async (transaction) => {
    await sql`set transaction read only`.execute(transaction);
    const role = await sql`select not rolsuper and not rolbypassrls as restricted
      from pg_roles where rolname = current_user`.execute(transaction);
    if (role.rows[0]?.restricted !== true) throw new Error('The database role can bypass RLS.');
  });
}

async function probeDatabases() {
  await probeDatabase(app.get(DbProvider));
  await probeDatabase(app.get(ActivityDetailDbProvider));
  return Response.json({ primary: true, activityDetail: true }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

function isSharedProbeRequest(request, path) {
  const durationRemaining = expiresAt - Date.now();
  if (durationRemaining <= 0 || durationRemaining > maximumTrialDuration || request.method !== 'GET') return false;
  const presented = request.headers.get('X-SportOS-Trial-Token') ?? '';
  if (!/^[a-f0-9]{64}$/.test(presented) || !timingSafeEqual(Buffer.from(presented), Buffer.from(trialToken))) return false;
  return path === '/health/database' || path === '/auth/session'
    || path === '/activities' || path === '/dynamics/monthly';
}

const readRoutes = new Set([
  '/health', '/auth/config', '/auth/session', '/auth/login', '/auth/callback',
  '/providers/connections', '/exports/canonical',
]);
const readPrefixes = ['activities', 'daily', 'dynamics', 'heatmap', 'performance', 'rules', 'stats'];

function isTrialRoute(method, path) {
  if (method === 'POST') return path === '/auth/logout';
  if (method !== 'GET' && method !== 'HEAD') return false;
  return readRoutes.has(path) || readPrefixes.includes(path.split('/')[1]);
}

export default {
  async fetch(request, bindings, ctx) {
    const path = new URL(request.url).pathname;
    const available = sharedDatabaseTrial
      ? ['GET', 'HEAD'].includes(request.method) && ['/health', '/auth/config'].includes(path)
        || isSharedProbeRequest(request, path)
      : isTrialRoute(request.method, path);
    if (!available) {
      return Response.json({ code: 'STAGING_ROUTE_UNAVAILABLE' }, {
        status: 404,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }

    try {
      // Trial routes finish their database queries before emitting a response.
      // Streaming MCP/chat and mutable provider/storage routes are gated above.
      if (sharedDatabaseTrial && path === '/health/database') return await withRequestDatabases(probeDatabases);
      const headersForApi = new Headers(request.headers);
      headersForApi.delete('X-SportOS-Trial-Token');
      const apiRequest = new Request(request, { headers: headersForApi });
      const response = await withRequestDatabases(() => server.fetch(apiRequest, bindings, ctx));
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'private, no-store');
      headers.set('CDN-Cache-Control', 'no-store');
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return Response.json({ code: 'STAGING_REQUEST_FAILED' }, {
        status: 503,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
  },
};
