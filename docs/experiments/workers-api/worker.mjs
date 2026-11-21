import '../../../apps/api/node_modules/reflect-metadata/Reflect.js';
import { httpServerHandler } from 'cloudflare:node';
import { NestFactory } from '../../../apps/api/node_modules/@nestjs/core/index.js';
import { ExpressAdapter } from '../../../apps/api/node_modules/@nestjs/platform-express/index.js';
import { AppModule } from '../../../apps/api/dist/app.module.js';
import { sportosCorsOptions } from '../../../apps/api/dist/cors-options.js';

const app = await NestFactory.create(AppModule, new ExpressAdapter(), {
  logger: false,
  abortOnError: false,
});
app.enableCors(sportosCorsOptions('https://localhost:4211'));
await app.init();

const server = httpServerHandler(app.getHttpServer());
export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (request.method !== 'GET' || !['/health', '/auth/config', '/auth/session'].includes(path)) {
      return new Response(null, { status: 404 });
    }
    // This deployment tests startup and anonymous routing with inert database URLs.
    // Never forward user credentials into this probe.
    const response = await server.fetch(new Request(request.url, {
      headers: { Origin: request.headers.get('Origin') ?? '' },
    }), env, ctx);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'private, no-store');
    return new Response(response.body, { status: response.status, headers });
  },
};
