import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { parse } from 'dotenv';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp, configureSwagger } from '../src/bootstrap';
import {
  environmentValidationSchema,
  JWT_ACCESS_SECRET_PLACEHOLDER,
} from '../src/config/environment.validation';

let app: INestApplication | undefined;

before(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  configureApp(app);
  configureSwagger(app);
  await app.init();
});

after(async () => {
  await app?.close();
});

test('GET /api/v1/health confirms PostgreSQL is connected', async () => {
  assert.ok(app);
  const response = await request(app.getHttpServer())
    .get('/api/v1/health')
    .expect(200);

  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.database.status, 'connected');
  assert.equal(response.body.database.name, 'partymaker');
  assert.match(response.body.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('GET /docs serves Swagger UI', async () => {
  assert.ok(app);
  const response = await request(app.getHttpServer())
    .get('/docs')
    .redirects(1)
    .expect(200);

  assert.match(response.headers['content-type'] ?? '', /text\/html/);
  assert.match(response.text, /Swagger UI/);
});

test('unknown routes use the common API error format', async () => {
  assert.ok(app);
  const response = await request(app.getHttpServer())
    .get('/api/v1/not-found')
    .expect(404);

  assert.equal(response.body.statusCode, 404);
  assert.equal(response.body.error.code, 'NOT_FOUND');
  assert.equal(typeof response.body.error.message, 'string');
  assert.equal(response.body.path, '/api/v1/not-found');
  assert.match(response.body.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('environment validation rejects the committed JWT secret placeholder', () => {
  const exampleEnvironment = parse(readFileSync('.env.example', 'utf8'));
  assert.equal(
    exampleEnvironment.JWT_ACCESS_SECRET,
    JWT_ACCESS_SECRET_PLACEHOLDER,
  );

  const validation = environmentValidationSchema.validate(exampleEnvironment, {
    abortEarly: false,
    allowUnknown: true,
  });

  assert.ok(validation.error);
  assert.ok(
    validation.error.details.some(
      (detail) => detail.path[0] === 'JWT_ACCESS_SECRET'
        && detail.type === 'any.invalid',
    ),
  );
});
