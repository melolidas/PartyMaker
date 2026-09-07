import { strict as assert } from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AUTH_RATE_LIMITS } from '../src/auth/auth-rate-limit.constants';
import { configureApp, configureSwagger } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';

type UserBody = {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  bio: string | null;
  city: string | null;
  countryCode: string | null;
  extroversionLevel: number;
  createdAt: string;
  updatedAt: string;
};

type AuthBody = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  accessTokenExpiresIn: number;
  user: UserBody;
};

type ErrorBody = {
  statusCode: number;
  error: {
    code: string;
    message: string;
    details?: string[];
  };
  path: string;
  timestamp: string;
};

type AccessPayload = {
  sub: string;
  sid: string;
  iat: number;
  exp: number;
};

function assertNoStoredSecrets(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoStoredSecrets);
    return;
  }
  if (typeof value !== 'object' || value === null) return;

  for (const [key, nestedValue] of Object.entries(value)) {
    assert.notEqual(key, 'passwordHash');
    assert.notEqual(key, 'tokenHash');
    assertNoStoredSecrets(nestedValue);
  }
}

function decodeAccessPayload(token: string): AccessPayload {
  const encodedPayload = token.split('.')[1];
  assert.ok(encodedPayload, 'JWT payload is missing');
  return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as AccessPayload;
}

describe('Auth + Profile vertical slice', { concurrency: false }, () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;
  let configService: ConfigService | undefined;
  let jwtService: JwtService | undefined;
  const suffix = randomBytes(8).toString('hex');
  const email = `auth_${suffix}@example.test`;
  const secondEmail = `other_${suffix}@example.test`;
  const handle = `auth_${suffix}`;
  const password = 'Local-test-password-42!';
  let userId = '';
  let registrationAccessToken = '';
  let registrationRefreshToken = '';
  let loginAccessToken = '';
  let loginRefreshToken = '';
  let rotatedRefreshToken = '';
  let concurrentAccessToken = '';
  let concurrentRefreshToken = '';

  before(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    configureSwagger(app);
    await app.init();
    prisma = app.get(PrismaService);
    configService = app.get(ConfigService);
    jwtService = app.get(JwtService);
  });

  after(async () => {
    if (!prisma || !app) return;
    const users = await prisma.user.findMany({
      where: { email: { in: [email, secondEmail] } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    if (userIds.length) {
      await prisma.authSession.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }
    await app.close();
  });

  test('successful registration creates a safe user and auth session', async () => {
    assert.ok(app);
    assert.ok(prisma);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `  ${email.toUpperCase()}  `,
        password,
        handle: `  ${handle.toUpperCase()}  `,
        displayName: '  Test User  ',
      })
      .expect(201);
    const body = response.body as AuthBody;

    userId = body.user.id;
    registrationAccessToken = body.accessToken;
    registrationRefreshToken = body.refreshToken;
    assert.equal(body.user.email, email);
    assert.equal(body.user.handle, handle);
    assert.equal(body.user.displayName, 'Test User');
    assert.equal(body.user.extroversionLevel, 5.5);
    assert.equal(body.tokenType, 'Bearer');
    assert.equal(body.accessTokenExpiresIn, 900);
    assert.ok(body.accessToken.length > 20);
    assert.ok(body.refreshToken.length >= 43);
    assertNoStoredSecrets(body);
    assert.deepEqual(Object.keys(body.user).sort(), [
      'avatar',
      'bio',
      'city',
      'countryCode',
      'createdAt',
      'displayName',
      'email',
      'extroversionLevel',
      'handle',
      'id',
      'updatedAt',
    ]);

    const storedUser = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });
    assert.notEqual(storedUser.passwordHash, password);
    assert.match(storedUser.passwordHash, /^\$argon2id\$/);

    const storedSession = await prisma.authSession.findFirstOrThrow({
      where: { userId },
      select: { id: true, tokenHash: true },
    });
    const expectedHash = createHash('sha256')
      .update(registrationRefreshToken)
      .digest('hex');
    assert.equal(storedSession.tokenHash, expectedHash);
    assert.notEqual(storedSession.tokenHash, registrationRefreshToken);

    const payload = decodeAccessPayload(registrationAccessToken);
    assert.equal(payload.sub, userId);
    assert.equal(payload.sid, storedSession.id);
    assert.equal(payload.exp - payload.iat, 900);
  });

  test('duplicate email returns 409 EMAIL_ALREADY_EXISTS', async () => {
    assert.ok(app);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        password,
        handle: `${handle}_other`,
        displayName: 'Another User',
      })
      .expect(409);
    const body = response.body as ErrorBody;

    assert.equal(body.error.code, 'EMAIL_ALREADY_EXISTS');
  });

  test('duplicate handle returns 409 HANDLE_ALREADY_EXISTS', async () => {
    assert.ok(app);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: secondEmail,
        password,
        handle,
        displayName: 'Another User',
      })
      .expect(409);
    const body = response.body as ErrorBody;

    assert.equal(body.error.code, 'HANDLE_ALREADY_EXISTS');
  });

  test('successful login creates a new session', async () => {
    assert.ok(app);
    assert.ok(prisma);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ` ${email.toUpperCase()} `, password })
      .expect(200);
    const body = response.body as AuthBody;

    loginAccessToken = body.accessToken;
    loginRefreshToken = body.refreshToken;
    assert.equal(body.user.id, userId);
    assert.notEqual(loginRefreshToken, registrationRefreshToken);
    assertNoStoredSecrets(body);
    assert.equal(await prisma.authSession.count({ where: { userId } }), 2);
  });

  test('wrong password and unknown email return the same 401 response', async () => {
    assert.ok(app);
    const wrongPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);
    const unknownEmail = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: `missing_${suffix}@example.test`, password: 'wrong-password' })
      .expect(401);
    const wrongBody = wrongPassword.body as ErrorBody;
    const unknownBody = unknownEmail.body as ErrorBody;

    assert.equal(wrongBody.error.code, 'INVALID_CREDENTIALS');
    assert.equal(unknownBody.error.code, wrongBody.error.code);
    assert.equal(unknownBody.error.message, wrongBody.error.message);
  });

  test('/users/me without or with a malformed token returns 401', async () => {
    assert.ok(app);
    const missing = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .expect(401);
    const malformed = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);

    assert.equal((missing.body as ErrorBody).error.code, 'INVALID_ACCESS_TOKEN');
    assert.equal((malformed.body as ErrorBody).error.code, 'INVALID_ACCESS_TOKEN');
  });

  test('/users/me with an expired access token returns 401', async () => {
    assert.ok(app);
    assert.ok(configService);
    assert.ok(jwtService);
    const sessionId = decodeAccessPayload(loginAccessToken).sid;
    const expiredAccessToken = await jwtService.signAsync(
      { sub: userId, sid: sessionId },
      {
        secret: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        algorithm: 'HS256',
        expiresIn: -60,
      },
    );
    const response = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${expiredAccessToken}`)
      .expect(401);

    assert.equal((response.body as ErrorBody).error.code, 'INVALID_ACCESS_TOKEN');
  });

  test('/users/me returns the owner-safe profile with a valid token', async () => {
    assert.ok(app);
    const response = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${loginAccessToken}`)
      .expect(200);
    const body = response.body as UserBody;

    assert.equal(body.id, userId);
    assert.equal(body.email, email);
    assertNoStoredSecrets(body);
  });

  test('profile update normalizes fields, supports null, and rejects protected fields', async () => {
    assert.ok(app);
    const updated = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${loginAccessToken}`)
      .send({
        displayName: '  Updated User  ',
        bio: 'Testing PartyMaker auth',
        city: '  Bishkek  ',
        countryCode: 'kg',
      })
      .expect(200);
    const body = updated.body as UserBody;

    assert.equal(body.displayName, 'Updated User');
    assert.equal(body.bio, 'Testing PartyMaker auth');
    assert.equal(body.city, 'Bishkek');
    assert.equal(body.countryCode, 'KG');
    assertNoStoredSecrets(body);

    const cleared = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${loginAccessToken}`)
      .send({ bio: null, city: null, countryCode: null })
      .expect(200);
    assert.equal((cleared.body as UserBody).bio, null);
    assert.equal((cleared.body as UserBody).city, null);
    assert.equal((cleared.body as UserBody).countryCode, null);

    const forbidden = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${loginAccessToken}`)
      .send({ email: secondEmail })
      .expect(400);
    assert.equal((forbidden.body as ErrorBody).error.code, 'VALIDATION_FAILED');
  });

  test('countryCode accepts ISO alpha-2 values and rejects unknown codes', async () => {
    assert.ok(app);
    for (const countryCode of ['KG', 'US', 'DE']) {
      const response: request.Response = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${loginAccessToken}`)
        .send({ countryCode: countryCode.toLowerCase() })
        .expect(200);
      assert.equal((response.body as UserBody).countryCode, countryCode);
    }

    for (const countryCode of ['ZZ', 'AA', 'K', 'KGG', '12']) {
      const response: request.Response = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${loginAccessToken}`)
        .send({ countryCode })
        .expect(400);
      assert.equal((response.body as ErrorBody).error.code, 'VALIDATION_FAILED');
    }
  });

  test('extroversion accepts 1, 1.5, and 10', async () => {
    assert.ok(app);
    assert.ok(prisma);
    for (const level of [1, 1.5, 10]) {
      const response: request.Response = await request(app.getHttpServer())
        .put('/api/v1/users/me/extroversion')
        .set('Authorization', `Bearer ${loginAccessToken}`)
        .send({ level })
        .expect(200);
      assert.equal((response.body as UserBody).extroversionLevel, level);
      assertNoStoredSecrets(response.body);
    }

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { extroversionScoreX2: true },
    });
    assert.equal(stored.extroversionScoreX2, 20);
  });

  test('extroversion rejects 0.5, 6.25, and 10.5', async () => {
    assert.ok(app);
    for (const level of [0.5, 6.25, 10.5]) {
      const response: request.Response = await request(app.getHttpServer())
        .put('/api/v1/users/me/extroversion')
        .set('Authorization', `Bearer ${loginAccessToken}`)
        .send({ level })
        .expect(400);
      assert.equal((response.body as ErrorBody).error.code, 'VALIDATION_FAILED');
    }
  });

  test('refresh rotates the token and returns a new token pair', async () => {
    assert.ok(app);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginRefreshToken })
      .expect(200);
    const body = response.body as AuthBody;

    rotatedRefreshToken = body.refreshToken;
    assert.notEqual(body.refreshToken, loginRefreshToken);
    assert.ok(body.accessToken.length > 20);
    assert.equal(body.user.id, userId);
    assertNoStoredSecrets(body);
  });

  test('old refresh token is rejected after rotation', async () => {
    assert.ok(app);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginRefreshToken })
      .expect(401);

    assert.equal((response.body as ErrorBody).error.code, 'INVALID_REFRESH_TOKEN');
  });

  test('expired refresh token returns 401', async () => {
    assert.ok(app);
    assert.ok(prisma);
    const expiredRefreshToken = randomBytes(48).toString('base64url');
    await prisma.authSession.create({
      data: {
        userId,
        tokenHash: createHash('sha256').update(expiredRefreshToken).digest('hex'),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: expiredRefreshToken })
      .expect(401);

    assert.equal((response.body as ErrorBody).error.code, 'INVALID_REFRESH_TOKEN');
  });

  test('concurrent refresh permits exactly one atomic rotation', async () => {
    assert.ok(app);
    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rotatedRefreshToken }),
      request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rotatedRefreshToken }),
    ]);
    const statuses = [first.status, second.status].sort((left, right) => left - right);

    assert.deepEqual(statuses, [200, 401]);
    const success = first.status === 200 ? first : second;
    const rejected = first.status === 401 ? first : second;
    const successBody = success.body as AuthBody;
    concurrentAccessToken = successBody.accessToken;
    concurrentRefreshToken = successBody.refreshToken;
    assert.notEqual(concurrentRefreshToken, rotatedRefreshToken);
    assert.equal((rejected.body as ErrorBody).error.code, 'INVALID_REFRESH_TOKEN');
    assertNoStoredSecrets(successBody);
  });

  test('logout revokes exactly the current session', async () => {
    assert.ok(app);
    assert.ok(prisma);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${concurrentAccessToken}`)
      .expect(204);

    const payload = decodeAccessPayload(concurrentAccessToken);
    const session = await prisma.authSession.findUniqueOrThrow({
      where: { id: payload.sid },
      select: { userId: true, revokedAt: true },
    });
    assert.equal(session.userId, userId);
    assert.ok(session.revokedAt instanceof Date);
  });

  test('refresh token is rejected after logout', async () => {
    assert.ok(app);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: concurrentRefreshToken })
      .expect(401);

    assert.equal((response.body as ErrorBody).error.code, 'INVALID_REFRESH_TOKEN');
  });

  test('logout of one session leaves another session refresh token valid', async () => {
    assert.ok(app);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: registrationRefreshToken })
      .expect(200);
    const body = response.body as AuthBody;

    registrationRefreshToken = body.refreshToken;
    assert.equal(body.user.id, userId);
    assertNoStoredSecrets(body);
  });

  test('all public user responses omit passwordHash and tokenHash', async () => {
    assert.ok(app);
    const response = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${registrationAccessToken}`)
      .expect(200);

    assertNoStoredSecrets(response.body);
    assert.equal(Object.hasOwn(response.body as object, 'refreshToken'), false);
  });

  test('register and login enforce isolated per-IP rate limits', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const rateLimitApp = moduleRef.createNestApplication();
    configureApp(rateLimitApp);

    try {
      await rateLimitApp.init();

      const assertRateLimited = async (path: string, limit: number): Promise<void> => {
        for (let attempt = 0; attempt < limit; attempt += 1) {
          await request(rateLimitApp.getHttpServer())
            .post(path)
            .send({})
            .expect(400);
        }

        const response = await request(rateLimitApp.getHttpServer())
          .post(path)
          .send({})
          .expect(429);
        const body = response.body as ErrorBody;

        assert.equal(body.statusCode, 429);
        assert.equal(body.error.code, 'TOO_MANY_REQUESTS');
        assert.equal(body.path, path);
      };

      await assertRateLimited(
        '/api/v1/auth/register',
        AUTH_RATE_LIMITS.register,
      );
      await assertRateLimited('/api/v1/auth/login', AUTH_RATE_LIMITS.login);
    } finally {
      await rateLimitApp.close();
    }
  });
});
