import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';

import { Controller, Get } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthTokenService } from '../src/auth/auth-token.service';
import { AccessTokenGuard } from '../src/auth/guards/access-token.guard';
import { configureApp } from '../src/bootstrap';
import { parseCorsAllowedOrigins } from '../src/config/cors.config';
import { environmentValidationSchema } from '../src/config/environment.validation';
import { UsersController } from '../src/users/users.controller';
import { UsersService } from '../src/users/users.service';

const origin = 'http://localhost:8081';
const secondOrigin = 'https://web.example.test';

@Controller('probe')
class ProbeController {
  @Get()
  get(): { status: string } {
    return { status: 'ok' };
  }
}

// Real shared bootstrap + UsersController + JWT guard; no Prisma or .env required.
async function createApp(origins: string): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProbeController, UsersController],
    providers: [
      {
        provide: ConfigService,
        useValue: new ConfigService({
          CORS_ALLOWED_ORIGINS: origins,
          JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
          JWT_ACCESS_TTL_SECONDS: 900,
          JWT_REFRESH_TTL_DAYS: 30,
        }),
      },
      JwtService,
      AuthTokenService,
      AccessTokenGuard,
      {
        provide: UsersService,
        useValue: { getMe: () => assert.fail('Unauthorized request reached UsersService') },
      },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

let app: INestApplication;
let closedApp: INestApplication;
before(async () => {
  app = await createApp(`${origin}, ${secondOrigin}`);
  closedApp = await createApp('');
});
after(async () => {
  await app?.close();
  await closedApp?.close();
});

test('allowed preflights support all used methods and Bearer/JSON headers without cookies', async () => {
  for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = await request(app.getHttpServer())
      .options(method === 'DELETE' ? '/api/v1/users/me/avatar/00000000-0000-4000-8000-000000000000' : '/api/v1/users/me')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', method)
      .set('Access-Control-Request-Headers', 'authorization,content-type')
      .expect(204);
    assert.equal(response.headers['access-control-allow-origin'], origin);
    assert.deepEqual((response.headers['access-control-allow-methods'] ?? '').split(','), [
      'GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS',
    ]);
    assert.deepEqual((response.headers['access-control-allow-headers'] ?? '').toLowerCase().split(','), [
      'authorization', 'content-type',
    ]);
    assert.equal(response.headers['access-control-allow-credentials'], undefined);
    assert.match(response.headers.vary ?? '', /Origin/);
  }
});

test('ordinary responses include only the exact allowed origin', async () => {
  for (const allowed of [origin, secondOrigin]) {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe').set('Origin', allowed).expect(200);
    assert.equal(response.headers['access-control-allow-origin'], allowed);
    assert.equal(response.headers['access-control-allow-credentials'], undefined);
    assert.deepEqual(response.body, { status: 'ok' });
  }
});

test('unlisted origins, ports, schemes, lookalikes and null receive no CORS permission', async () => {
  for (const denied of [
    'https://unrelated.test', 'http://localhost:8082', 'https://localhost:8081',
    'http://localhost.attacker.test:8081', 'https://web.example.test.attacker.test',
    'http://127.0.0.1:8081', 'null',
  ]) {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe').set('Origin', denied);
    const preflight = await request(app.getHttpServer())
      .options('/api/v1/users/me').set('Origin', denied)
      .set('Access-Control-Request-Method', 'DELETE');
    for (const result of [response, preflight]) {
      assert.equal(result.headers['access-control-allow-origin'], undefined);
      assert.equal(result.headers['access-control-allow-credentials'], undefined);
    }
  }
});

test('empty allowlist does not grant cross-origin access', async () => {
  for (const method of ['get', 'options'] as const) {
    const response = await request(closedApp.getHttpServer())[method]('/api/v1/probe')
      .set('Origin', origin).set('Access-Control-Request-Method', 'GET');
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
});

test('requests without Origin still work for native clients and server tools', async () => {
  for (const instance of [app, closedApp]) {
    const response = await request(instance.getHttpServer()).get('/api/v1/probe').expect(200);
    assert.equal(response.body.status, 'ok');
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
});

test('CORS does not bypass the real protected endpoint guard; errors also have CORS headers', async () => {
  for (const authorization of [undefined, 'Bearer invalid']) {
    const call = request(app.getHttpServer()).get('/api/v1/users/me').set('Origin', origin);
    if (authorization) call.set('Authorization', authorization);
    const response = await call.expect(401);
    assert.equal(response.headers['access-control-allow-origin'], origin);
    assert.equal(response.body.error.code, 'INVALID_ACCESS_TOKEN');
    assert.equal(response.body.statusCode, 401);
    assert.equal(response.body.path, '/api/v1/users/me');
    assert.equal(typeof response.body.timestamp, 'string');
  }
  await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
});

const validEnvironment = {
  JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
  DATABASE_URL: 'postgresql://localhost/unused_cors_test',
};

test('startup validation accepts empty or explicit serialized HTTP(S) origins', () => {
  for (const origins of [undefined, '', '  ', origin, `${origin}, ${secondOrigin}`, 'http://[::1]:8081']) {
    const validation = environmentValidationSchema.validate({
      ...validEnvironment, CORS_ALLOWED_ORIGINS: origins,
    });
    assert.equal(validation.error, undefined);
    if (origins === undefined) assert.equal(validation.value.CORS_ALLOWED_ORIGINS, '');
  }
  assert.deepEqual([...parseCorsAllowedOrigins(`${origin}, ${origin}`)], [origin]);
});

test('startup validation rejects unsafe/malformed origins and non-origin URLs', () => {
  for (const origins of [
    '*', 'null', 'https://*.example.test', 'http://user:password@example.test',
    'http://@example.test', 'https://example.test/', 'https://example.test/path',
    'https://example.test?query=1', 'https://example.test#fragment',
    'https://example.test?', 'https://example.test#', 'file://example.test',
    'ftp://example.test', 'localhost:8081', 'not a URL', `${origin},`,
    `${origin}, null`, `${origin}, *`, 'http://localhost:99999',
  ]) {
    const validation = environmentValidationSchema.validate({
      ...validEnvironment, CORS_ALLOWED_ORIGINS: origins,
    });
    assert.ok(validation.error, `Accepted invalid CORS configuration: ${origins}`);
    assert.equal(validation.error.details[0]?.path[0], 'CORS_ALLOWED_ORIGINS');
  }
});
