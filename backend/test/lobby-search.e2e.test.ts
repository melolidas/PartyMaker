import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthTokenService } from '../src/auth/auth-token.service';
import { configureApp, configureSwagger } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import type { LobbyPageResponseDto } from '../src/lobbies/dto/lobby-response.dto';

let app: INestApplication;
let prisma: PrismaService;
let access: string;
const users = [randomUUID(), randomUUID()];
const ids: string[] = Array.from({ length: 9 }, () => randomUUID()).sort();
const tag = randomUUID().slice(0, 8);
const at = '2300-02-01T12:00:00.000Z';
const cursor = Buffer.from(JSON.stringify({ startsAt: '2300-02-01T11:59:59.999Z', id: randomUUID() })).toString('base64url');
before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication(); configureApp(app); configureSwagger(app); await app.init();
  prisma = app.get(PrismaService);
  for (const [i, id] of users.entries()) await prisma.user.create({ data: {
    id, email: `search_${id}@example.test`, handle: `s_${id.replaceAll('-', '').slice(0, 24)}`,
    displayName: 'Isolated search', passwordHash: 'not-a-login-hash', extroversionScoreX2: i ? 20 : 2,
  } });
  const service = app.get(AuthTokenService); const token = service.createRefreshToken();
  const session = await prisma.authSession.create({ data: { userId: users[0]!, tokenHash: token.hash, expiresAt: token.expiresAt } });
  access = await service.signAccessToken(users[0]!, session.id);
  for (const [i, id] of ids.entries()) await prisma.lobby.create({ data: {
    id, organizerId: users[1]!, title: `${tag} ${i === 0 ? 'Earlier' : 'Мяч Match'} ${i}`,
    description: 'Search fixtures only', category: 'SPORT', startsAt: i === 6 ? '2000-01-01T12:00:00Z' : at,
    timeZone: 'UTC', capacity: 6, isOnline: false, venueName: `${tag} Зал Court 50%_\\ end`,
    status: i === 7 ? 'DRAFT' : i === 8 ? 'CANCELLED' : 'PUBLISHED',
    members: { create: [{ userId: users[1]!, role: 'ORGANIZER', status: 'JOINED' },
      { userId: users[0]!, status: i === 1 ? 'LEFT' : i === 2 ? 'REMOVED' : 'JOINED' }] },
  } });
});
after(async () => {
  if (prisma) {
    await prisma.lobby.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  await app?.close();
});
const list = (query: Record<string, unknown> = {}) => request(app.getHttpServer()).get('/api/v1/lobbies').query(query).auth(access, { type: 'bearer' });
const resultIds = (body: LobbyPageResponseDto) => body.items.map(item => item.id);

test('search is authenticated and documents its literal q contract', async () => {
  await request(app.getHttpServer()).get('/api/v1/lobbies').query({ q: tag }).expect(401);
  const docs = await request(app.getHttpServer()).get('/docs-json').expect(200);
  const parameter = docs.body.paths['/api/v1/lobbies'].get.parameters.find((p: { name: string }) => p.name === 'q');
  assert.equal(parameter.schema.maxLength, 100);
});
test('search title or venue is case-insensitive for Cyrillic and Latin, trimming q and excluding hidden/past', async () => {
  for (const q of [`  ${tag} мЯч  `, `${tag} МЯЧ`]) {
    assert.deepEqual(resultIds((await list({ q }).expect(200)).body), ids.slice(1, 6));
  }
  for (const q of ['mAtCh', `${tag} зАЛ`, 'cOuRt']) {
    const response = await list({ q, after: cursor, limit: 50 }).expect(200);
    assert.deepEqual(resultIds(response.body).filter(id => ids.includes(id)), q === 'mAtCh' ? ids.slice(1, 6) : ids.slice(0, 6));
    assert.doesNotMatch(JSON.stringify(response.body), /passwordHash|tokenHash|storageKey|refreshToken|@example\.test/);
  }
});
test('blank q equals the ordinary list and unmatched q returns empty', async () => {
  const normal = await list({ after: cursor, limit: 2 }).expect(200);
  assert.deepEqual((await list({ after: cursor, limit: 2, q: ' \t ' }).expect(200)).body, normal.body);
  assert.deepEqual((await list({ q: `${tag} no matching venue` }).expect(200)).body, { items: [], nextCursor: null });
});
test('q rejects arrays, nested objects and overlength; pattern metacharacters are literal', async () => {
  for (const query of [{ q: ['one', 'two'] }, { q: { nested: 'x' } }, { 'q[]': 'x' }, { q: 'x'.repeat(101) }]) {
    const response = await list(query).expect(400); assert.equal(response.body.error.code, 'VALIDATION_FAILED');
  }
  for (const q of [`${tag} Зал Court 50%`, `${tag} Зал Court 50%_`, `${tag} Зал Court 50%_\\`]) {
    assert.deepEqual(resultIds((await list({ q }).expect(200)).body), ids.slice(0, 6));
  }
  for (const q of [`${tag}%`, `${tag}_`, `${tag}\\`, `${tag} Зал Court 50%_%`]) {
    assert.deepEqual((await list({ q }).expect(200)).body, { items: [], nextCursor: null });
  }
});
test('q + mine uses Bearer JOINED only and retains statistics for the whole group', async () => {
  const response = await list({ q: `${tag} Мяч`, scope: 'mine' }).expect(200);
  assert.deepEqual(resultIds(response.body), ids.slice(3, 6));
  for (const item of (response.body as LobbyPageResponseDto).items) {
    assert.equal(item.joinedCount, 2); assert.equal(item.groupExtroversionLevel, 5.5); assert.equal(item.isJoined, true);
  }
});
test('filter precedes pagination; q, scope and equal-time tuple cursor compose without gaps or duplicates', async () => {
  assert.deepEqual(resultIds((await list({ after: cursor, limit: 1 }).expect(200)).body), [ids[0]]);
  for (const scope of ['all', 'mine']) {
    let after: string | null = cursor;
    const seen: string[] = [];
    for (let i = 0; i < 6 && after; i++) {
      const result: LobbyPageResponseDto = (await list({ q: `${tag} Мяч`, scope, after, limit: 2 }).expect(200)).body;
      seen.push(...resultIds(result)); after = result.nextCursor;
    }
    assert.equal(after, null);
    assert.deepEqual(seen, scope === 'mine' ? ids.slice(3, 6) : ids.slice(1, 6));
  }
});
