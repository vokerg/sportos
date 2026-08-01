import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const webOrigin = String(process.env.SPORTOS_WEB_ORIGIN ?? 'http://localhost:4200').replace(/\/$/, '');
  app.enableCors({
    origin: webOrigin,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-SportOS-CSRF'],
  });
  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port);
  console.log(`SportOS API listening on http://localhost:${port}`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
