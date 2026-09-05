import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { LobbyStatus } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AuthTokenService } from '../src/auth/auth-token.service';
import { configureApp, configureSwagger } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';

let app: INestApplication;
let prisma: PrismaService;
const users = [randomUUID(), randomUUID(), randomUUID()];
const tokens: string[] = [];
const lobbies: string[] = [];
const future = '2200-01-01T12:00:00.000Z';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication(); configureApp(app); configureSwagger(app); await app.init();
  prisma = app.get(PrismaService);
  for (const [index, id] of users.entries()) {
    await prisma.user.create({ data: { id, email: `membership_${id}@example.test`, handle: `mb_${id.replaceAll('-', '').slice(0, 24)}`,
      displayName: 'Isolated membership test', passwordHash: 'not-a-login-hash', extroversionScoreX2: [2, 20, 10][index]! } });
    const service = app.get(AuthTokenService);
    const material = service.createRefreshToken();
    const session = await prisma.authSession.create({ data: { userId: id, tokenHash: material.hash, expiresAt: material.expiresAt } });
    tokens.push(await service.signAccessToken(id, session.id));
  }
});
after(async () => {
  if (prisma) {
    await prisma.lobby.deleteMany({ where: { id: { in: lobbies } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  await app?.close();
});
async function makeLobby(options: { capacity?: number; startsAt?: string; status?: LobbyStatus } = {}) {
  const id = randomUUID(); lobbies.push(id);
  await prisma.lobby.create({ data: {
    id, organizerId: users[0]!, title: 'Isolated membership lobby', description: 'Never touches existing records.',
    category: 'SPORT', timeZone: 'UTC', isOnline: true, capacity: 3, startsAt: future, ...options,
    members: { create: { userId: users[0]!, role: 'ORGANIZER', status: 'JOINED' } },
  } });
  return id;
}
const action = (id: string, verb: 'join' | 'leave', user = 1) =>
  request(app.getHttpServer()).post(`/api/v1/lobbies/${id}/${verb}`).auth(tokens[user]!, { type: 'bearer' });
const row = (id: string, user = 1) => prisma.lobbyMember.findUnique({ where: { lobbyId_userId: { lobbyId: id, userId: users[user]! } } });
const mine = (user = 1) => request(app.getHttpServer()).get('/api/v1/lobbies').query({ scope: 'mine', limit: 50 }).auth(tokens[user]!, { type: 'bearer' });
const includes = (body: { items: { id: string }[] }, id: string) => body.items.some((item) => item.id === id);
async function conflict(id: string, verb: 'join' | 'leave', code: string, user = 1) {
  const response = await action(id, verb, user).expect(409);
  assert.equal(response.body.error.code, code);
}

test('membership endpoints require Bearer, reject client identity/role/status, and hide unavailable events', async () => {
  const id = await makeLobby();
  for (const verb of ['join', 'leave'] as const) {
    const unauthorized = await request(app.getHttpServer()).post(`/api/v1/lobbies/${id}/${verb}`).expect(401);
    assert.equal(unauthorized.body.error.code, 'INVALID_ACCESS_TOKEN');
    for (const body of [{ userId: users[2] }, { role: 'ORGANIZER' }, { status: 'JOINED' }, { members: [] }]) {
      const invalid = await action(id, verb).send(body).expect(400);
      assert.equal(invalid.body.error.code, 'VALIDATION_FAILED');
      // A query's empty array is otherwise omitted by Supertest's serializer.
      const query = await action(id, verb).query(Object.fromEntries(Object.entries(body).map(([key, value]) => [key, JSON.stringify(value)]))).expect(400);
      assert.equal(query.body.error.code, 'VALIDATION_FAILED');
    }
    for (const unavailable of [randomUUID(), await makeLobby({ status: 'DRAFT' }), await makeLobby({ status: 'CANCELLED' }), await makeLobby({ status: 'COMPLETED' })]) {
      const response = await action(unavailable, verb).expect(404);
      assert.equal(response.body.error.code, 'LOBBY_NOT_FOUND');
    }
  }
  assert.equal(await row(id), null);
});

test('join -> mine -> leave updates safe DTO, group statistics and preserves membership history', async () => {
  const id = await makeLobby();
  const joined = await action(id, 'join').expect(200);
  assert.equal(joined.body.joinedCount, 2); assert.equal(joined.body.groupExtroversionLevel, 5.5);
  assert.equal(joined.body.isJoined, true); assert.equal(joined.body.membershipStatus, 'JOINED'); assert.equal(joined.body.isOrganizer, false);
  assert.ok(includes((await mine().expect(200)).body, id));
  const first = await row(id); assert.equal(first?.role, 'MEMBER');
  const left = await action(id, 'leave').expect(200);
  assert.equal(left.body.joinedCount, 1); assert.equal(left.body.groupExtroversionLevel, 1);
  assert.equal(left.body.isJoined, false); assert.equal(left.body.membershipStatus, 'LEFT');
  assert.ok(!includes((await mine().expect(200)).body, id));
  const second = await row(id); assert.equal(second?.status, 'LEFT'); assert.ok(second?.leftAt);
  assert.deepEqual(second?.joinedAt, first?.joinedAt);
  assert.deepEqual(Object.keys(joined.body).sort(), ['id','title','description','category','startsAt','timeZone','isOnline','venueName','capacity','joinedCount','isJoined','membershipStatus','isOrganizer','groupExtroversionLevel'].sort());
  assert.doesNotMatch(JSON.stringify(joined.body), /passwordHash|tokenHash|refreshToken|storageKey|userId|@example/);
});

test('repeat join succeeds even when full; repeat leave/absent leave do not rewrite history or create rows', async () => {
  const id = await makeLobby({ capacity: 2 });
  await action(id, 'join').expect(200); const joined = await row(id);
  await action(id, 'join').expect(200); assert.deepEqual(await row(id), joined);
  assert.equal(await prisma.lobbyMember.count({ where: { lobbyId: id } }), 2);
  await action(id, 'leave').expect(200); const left = await row(id);
  await action(id, 'leave').expect(200); assert.deepEqual(await row(id), left);
  await action(id, 'leave', 2).expect(200); assert.equal(await row(id, 2), null);
});

test('LEFT reuses its membership, refreshes joinedAt and clears leftAt only on a real rejoin', async () => {
  const id = await makeLobby({ capacity: 2 });
  await action(id, 'join').expect(200); await action(id, 'leave').expect(200);
  const old = new Date('2001-01-01T00:00:00.000Z');
  await prisma.lobbyMember.update({ where: { lobbyId_userId: { lobbyId: id, userId: users[1]! } }, data: { joinedAt: old } });
  await action(id, 'join').expect(200);
  const rejoined = await row(id);
  assert.equal(rejoined?.leftAt, null); assert.ok(rejoined!.joinedAt > old); assert.equal(rejoined?.role, 'MEMBER');
  assert.equal(await prisma.lobbyMember.count({ where: { lobbyId: id, userId: users[1] } }), 1);
  await action(id, 'join').expect(200); assert.deepEqual(await row(id), rejoined);
  await action(id, 'leave').expect(200); const left = await row(id);
  await action(id, 'join', 2).expect(200);
  await conflict(id, 'join', 'LOBBY_FULL'); assert.deepEqual(await row(id), left);
});

test('REMOVED cannot bypass exclusion with leave -> join and organizer cannot leave', async () => {
  const id = await makeLobby();
  await prisma.lobbyMember.create({ data: { lobbyId: id, userId: users[1]!, status: 'REMOVED', leftAt: new Date() } });
  const removed = await row(id);
  await conflict(id, 'join', 'LOBBY_MEMBERSHIP_REMOVED');
  await conflict(id, 'leave', 'LOBBY_MEMBERSHIP_REMOVED');
  await conflict(id, 'join', 'LOBBY_MEMBERSHIP_REMOVED');
  assert.deepEqual(await row(id), removed);
  const organizer = await row(id, 0);
  await conflict(id, 'leave', 'LOBBY_ORGANIZER_CANNOT_LEAVE', 0);
  assert.deepEqual(await row(id, 0), organizer);
  const response = await action(id, 'join', 0).expect(200);
  assert.equal(response.body.isOrganizer, true);
  assert.equal(response.body.joinedCount, 1); assert.equal(response.body.groupExtroversionLevel, 1);
});

test('started events reject real transitions but completed no-ops remain successful', async () => {
  const id = await makeLobby();
  await action(id, 'join').expect(200);
  await prisma.lobby.update({ where: { id }, data: { startsAt: '2000-01-01T00:00:00.000Z' } });
  const joined = await row(id);
  await action(id, 'join').expect(200); assert.deepEqual(await row(id), joined);
  await conflict(id, 'leave', 'LOBBY_STARTED'); await conflict(id, 'join', 'LOBBY_STARTED', 2);
  await action(id, 'leave', 2).expect(200); assert.equal(await row(id, 2), null);
  const leftId = await makeLobby();
  await action(leftId, 'join').expect(200); await action(leftId, 'leave').expect(200);
  await prisma.lobby.update({ where: { id: leftId }, data: { startsAt: '2000-01-01T00:00:00.000Z' } });
  const left = await row(leftId);
  await action(leftId, 'leave').expect(200); assert.deepEqual(await row(leftId), left);
  await conflict(leftId, 'join', 'LOBBY_STARTED');
});

// Hold the real row lock, dispatch both HTTP requests, and observe BOTH waiting in
// pg_stat_activity before release. Promise.all alone would not prove overlap.
async function overlap(id: string, calls: (() => Promise<request.Response>)[]) {
  const locked = deferred(), release = deferred();
  const blocker = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Lobby" WHERE id = ${id}::uuid FOR UPDATE`;
    locked.resolve(); await release.promise;
  }, { timeout: 15000 });
  await locked.promise;
  const pending = calls.map((call) => call());
  try {
    const deadline = Date.now() + 3500;
    let waiting = 0;
    while (waiting < calls.length && Date.now() < deadline) {
      const rows = await prisma.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE '%FROM "Lobby"%FOR UPDATE%'
      `;
      waiting = rows[0]!.count;
      if (waiting < calls.length) await setImmediate();
    }
    assert.ok(waiting >= calls.length, 'Both requests must concurrently wait on the real PostgreSQL row lock');
  } finally { release.resolve(); await blocker; }
  return Promise.all(pending);
}

test('two concurrent users competing for the last place yield exactly one join and one LOBBY_FULL', async () => {
  const id = await makeLobby({ capacity: 2 });
  const results = await overlap(id, [() => action(id, 'join', 1).then((r) => r), () => action(id, 'join', 2).then((r) => r)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(results.find((r) => r.status === 409)?.body.error.code, 'LOBBY_FULL');
  assert.equal(await prisma.lobbyMember.count({ where: { lobbyId: id, status: 'JOINED' } }), 2);
  const winner = results[0]!.status === 200 ? 1 : 2;
  const membership = await row(id, winner);
  await action(id, 'join', winner).expect(200); assert.deepEqual(await row(id, winner), membership);
});

test('concurrent joins by the same user occupy one place and create one membership', async () => {
  const id = await makeLobby({ capacity: 2 });
  const results = await overlap(id, [() => action(id, 'join').then((r) => r), () => action(id, 'join').then((r) => r)]);
  assert.ok(results.every((r) => r.status === 200 && r.body.joinedCount === 2));
  assert.equal(await prisma.lobbyMember.count({ where: { lobbyId: id, userId: users[1] } }), 1);
  assert.equal(await prisma.lobbyMember.count({ where: { lobbyId: id, status: 'JOINED' } }), 2);
});

test('join and leave take the same row lock and never exceed capacity', async () => {
  const id = await makeLobby({ capacity: 2 }); await action(id, 'join').expect(200);
  const results = await overlap(id, [() => action(id, 'leave').then((r) => r), () => action(id, 'join', 2).then((r) => r)]);
  assert.equal(results[0]?.status, 200);
  assert.ok(results[1]?.status === 200 || (results[1]?.status === 409 && results[1]?.body.error.code === 'LOBBY_FULL'));
  await action(id, 'join', 2).expect(200);
  assert.equal((await row(id))?.status, 'LEFT');
  assert.equal(await prisma.lobbyMember.count({ where: { lobbyId: id, status: 'JOINED' } }), 2);
});

test('Swagger describes membership success, authorization, missing lobbies and conflict codes', async () => {
  const docs = await request(app.getHttpServer()).get('/docs-json').expect(200);
  for (const verb of ['join', 'leave']) {
    const operation = docs.body.paths[`/api/v1/lobbies/{id}/${verb}`].post;
    assert.ok(operation.security);
    for (const status of ['200','400','401','404','409']) assert.ok(operation.responses[status]);
    assert.match(operation.responses['409'].description, /LOBBY_STARTED/);
  }
  assert.ok(docs.body.components.schemas.LobbyResponseDto.properties.membershipStatus);
  assert.ok(docs.body.components.schemas.LobbyResponseDto.properties.isOrganizer);
});
