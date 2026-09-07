import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp, configureSwagger } from './bootstrap';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  configureSwagger(app);

  const config = app.get(ConfigService);
  const port = config.getOrThrow<number>('PORT');

  await app.listen(port);
  Logger.log(`PartyMaker API listening on http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`Swagger available at http://localhost:${port}/docs`, 'Bootstrap');
}

void bootstrap();
