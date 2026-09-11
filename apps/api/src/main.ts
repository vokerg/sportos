import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { sportosCorsOptions } from './cors-options.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const webOrigin = String(process.env.SPORTOS_WEB_ORIGIN ?? 'http://localhost:4210').replace(/\/$/, '');
  app.enableCors(sportosCorsOptions(webOrigin));
  const port = Number(process.env.API_PORT ?? 3010);
  await app.listen(port);
  console.log(`SportOS API listening on http://localhost:${port}`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
