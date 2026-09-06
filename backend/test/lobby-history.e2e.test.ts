import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { before, after, afterEach, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { LobbyMemberStatus, LobbyStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthTokenService } from '../src/auth/auth-token.service';
import { configureApp, configureSwagger } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';

let app: INestApplication, prisma: PrismaService;
const users = [randomUUID(), randomUUID()], tokens: string[] = [], ids: string[] = [];
const url = '/api/v1/users/me/lobby-history';
const get = (who = 0) => request(app.getHttpServer()).get(url).auth(tokens[who]!, { type: 'bearer' });
const cursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication(); configureApp(app); configureSwagger(app); await app.init();
  prisma = app.get(PrismaService);
  for (const id of users) {
    await prisma.user.create({ data: { id, email: `history_${id}@example.test`, handle: `h_${id.replaceAll('-', '').slice(0, 24)}`,
      displayName: 'Isolated history user', passwordHash: 'not-a-login-hash' } });
    const auth = app.get(AuthTokenService), material = auth.createRefreshToken();
    const session = await prisma.authSession.create({ data: { userId: id, tokenHash: material.hash, expiresAt: material.expiresAt } });
    tokens.push(await auth.signAccessToken(id, session.id));
  }
});
afterEach(async () => { await prisma?.lobby.deleteMany({ where: { id: { in: ids } } }); ids.length = 0; });
after(async () => { await prisma?.user.deleteMany({ where: { id: { in: users } } }); await app?.close(); });
async function lobby(options: { status?: LobbyStatus; startsAt?: string; member?: LobbyMemberStatus | null; who?: number; organizer?: number; online?: boolean } = {}) {
  const { status = 'PUBLISHED', startsAt = '2020-01-01T00:00:00.000Z', member = 'JOINED', who = 0, organizer = 0, online = false } = options;
  const id = randomUUID(); ids.push(id);
  await prisma.lobby.create({ data: { id, organizerId: users[organizer]!, status, startsAt, title: 'Real <history> title',
    description: 'Description, not translation key', category: 'FOOD', capacity: 6, timeZone: 'America/New_York',
    isOnline: online, venueName: online ? null : 'Real place', address: 'private address', latitude: 42.8, longitude: 74.6,
    ...(member ? { members: { create: { userId: users[who]!, status: member, role: organizer === who ? 'MEMBER' : 'ORGANIZER' } } } : {}),
  } });
  return id;
}

test('history requires Bearer, validates all query shapes and exposes Swagger', async () => {
  await request(app.getHttpServer()).get(url).expect(401);
  for (const query of ['userId=x', 'organizerId=x', 'scope=mine', 'limit=0', 'limit=51', 'limit=-1', 'limit=01', 'limit=1.2',
    'limit=NaN', 'limit=1&limit=2', 'limit[x]=1', 'after=', 'after=x', 'after=a&after=b', 'after[x]=a',
    ...[null, [], {}, { startsAt: '2020-01-01T00:00:00.000Z', id: 'bad' },
      { startsAt: '2020-01-01T00:00:00.000Z', id: users[0], extra: 1 },
      ...['+275760-09-13T00:00:00.000Z', '2026-02-30T00:00:00.000Z', '0000-01-01T00:00:00.000Z', '2020-01-01', '2020-01-01T00:00:00Z']
        .map(startsAt => ({ startsAt, id: users[0] }))].map(value => `after=${cursor(value)}`), `after=${'a'.repeat(257)}`]) {
    assert.equal((await get().query(query).expect(400)).body.error.code, 'VALIDATION_FAILED', query);
  }
  assert.deepEqual((await get().query({ limit: 50 }).expect(200)).body, { items: [], nextCursor: null });
  const docs = (await request(app.getHttpServer()).get('/docs-json').expect(200)).body;
  assert.ok(docs.paths[url].get.security); assert.ok(docs.paths[url].get.responses['400']);
});

test('history filters PUBLISHED/COMPLETED, time and own JOINED before limit; organizer has no bypass', async () => {
  const expected: string[] = [];
  for (const status of ['PUBLISHED', 'COMPLETED', 'CANCELLED', 'DRAFT'] as const) {
    for (const member of ['JOINED', 'LEFT', 'REMOVED', null] as const) {
      const id = await lobby({ status, member });
      if (member === 'JOINED' && (status === 'PUBLISHED' || status === 'COMPLETED')) expected.push(id);
    }
    await lobby({ status, startsAt: '2200-01-01T00:00:00.000Z' });
  }
  const other = await lobby({ who: 1, organizer: 1 });
  const rows = (await get().expect(200)).body.items;
  assert.deepEqual(rows.map((r: { id: string }) => r.id), expected.sort().reverse());
  assert.deepEqual((await get(1).expect(200)).body.items.map((r: { id: string }) => r.id), [other]);
  const foreignCursor = cursor({ startsAt: '2300-01-01T00:00:00.000Z', id: other });
  assert.deepEqual((await get().query({ after: foreignCursor }).expect(200)).body.items, rows);
});

test('startsAt equals one serverNow is included; one millisecond later is not', async () => {
  const now = Date.now(), original = Date.now;
  const beforeId = await lobby({ startsAt: new Date(now - 1).toISOString() });
  const equalId = await lobby({ startsAt: new Date(now).toISOString(), status: 'COMPLETED' });
  await lobby({ startsAt: new Date(now + 1).toISOString() });
  try {
    Date.now = () => now;
    assert.deepEqual((await get().expect(200)).body.items.map((r: { id: string }) => r.id), [equalId, beforeId]);
  } finally { Date.now = original; }
});

test('bounded history pagination sorts equal startsAt without duplicates, ignores inaccessible leading rows and defaults to 20', async () => {
  const expected = [];
  for (let i = 0; i < 23; i++) expected.push(await lobby());
  for (let i = 0; i < 3; i++) await lobby({ who: 1, startsAt: '2021-01-01T00:00:00.000Z' });
  const latest = await lobby({ startsAt: '2022-01-01T00:00:00.000Z' });
  assert.equal((await get().expect(200)).body.items.length, 20);
  const seen: string[] = []; let next: string | null = null;
  do {
    const result: { items: { id: string }[]; nextCursor: string | null } = (await get().query({ limit: 3, ...(next ? { after: next } : {}) }).expect(200)).body;
    seen.push(...result.items.map(r => r.id)); next = result.nextCursor;
  } while (next);
  assert.deepEqual(seen, [latest, ...expected.sort().reverse()]); assert.equal(new Set(seen).size, 24);
});

test('history DTO is narrow and canonical organizerId wins over stored membership role', async () => {
  const own = await lobby(), member = await lobby({ organizer: 1, online: true });
  const result = (await get().expect(200)).body;
  assert.deepEqual(Object.keys(result).sort(), ['items', 'nextCursor']);
  for (const row of result.items) {
    assert.deepEqual(Object.keys(row).sort(), ['category', 'description', 'id', 'isOnline', 'isOrganizer', 'startsAt', 'timeZone', 'title', 'venueName']);
    assert.equal(row.title, 'Real <history> title'); assert.equal(row.isOrganizer, row.id === own);
    assert.equal(row.venueName, row.id === member ? null : 'Real place'); assert.equal(row.timeZone, 'America/New_York');
  }
  assert.doesNotMatch(JSON.stringify(result), /address|latitude|longitude|members|messages|password|email|storageKey|organizerId|capacity|token/i);
});

test('COMPLETED history does not grant details/chat/roster access; refreshing discovers new leading entries without mutation', async () => {
  const id = await lobby({ status: 'COMPLETED' });
  assert.equal((await get().expect(200)).body.items[0].id, id);
  const before = await prisma.lobby.findUniqueOrThrow({ where: { id }, include: { members: true } });
  for (const suffix of ['', '/messages', '/members']) await request(app.getHttpServer()).get(`/api/v1/lobbies/${id}${suffix}`).auth(tokens[0]!, { type: 'bearer' }).expect(404);
  assert.deepEqual(await prisma.lobby.findUniqueOrThrow({ where: { id }, include: { members: true } }), before);
  const recent = await lobby({ startsAt: '2021-01-01T00:00:00.000Z' });
  assert.deepEqual((await get().expect(200)).body.items.map((r: { id: string }) => r.id), [recent, id]);
});
