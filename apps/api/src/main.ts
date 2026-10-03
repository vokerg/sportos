import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { sportosCorsOptions } from './cors-options.js';
import { validateHostedEnvironment } from './hosted-config.js';

async function bootstrap() {
  validateHostedEnvironment(process.env);
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.use((_request: unknown, response: { setHeader(name: string, value: string): void }, next: () => void) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('CDN-Cache-Control', 'no-store');
    response.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    next();
  });
  const webOrigin = String(process.env.SPORTOS_WEB_ORIGIN ?? 'http://localhost:4210').replace(/\/$/, '');
  app.enableCors(sportosCorsOptions(webOrigin));
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3010);
  await app.listen(port, '0.0.0.0');
  console.log(`SportOS API listening on http://localhost:${port}`);
}

bootstrap().catch(() => {
  console.error('SportOS API startup failed. Check server configuration and database availability.');
  process.exit(1);
});
