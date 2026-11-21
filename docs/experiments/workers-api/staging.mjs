import '../../../apps/api/node_modules/reflect-metadata/Reflect.js';
import { httpServerHandler } from 'cloudflare:node';
import { NestFactory } from '../../../apps/api/node_modules/@nestjs/core/index.js';
import { ExpressAdapter } from '../../../apps/api/node_modules/@nestjs/platform-express/index.js';
import { AppModule } from '../../../apps/api/dist/app.module.js';
import { sportosCorsOptions } from '../../../apps/api/dist/cors-options.js';
import { validateHostedEnvironment } from '../../../apps/api/dist/hosted-config.js';
import { withRequestDatabases } from '../../../apps/api/dist/request-databases.js';

const env = process.env;
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
    || url.username !== 'sportos_app' || url.pathname !== `/${expectedDatabase}`
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
    if (!isTrialRoute(request.method, path)) {
      return Response.json({ code: 'STAGING_ROUTE_UNAVAILABLE' }, {
        status: 404,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }

    try {
      // Trial routes finish their database queries before emitting a response.
      // Streaming MCP/chat and mutable provider/storage routes are gated above.
      const response = await withRequestDatabases(() => server.fetch(request, bindings, ctx));
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
