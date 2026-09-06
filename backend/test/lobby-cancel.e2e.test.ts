import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { before, after, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { LobbyStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthTokenService } from '../src/auth/auth-token.service';
import { configureApp, configureSwagger } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';

let app: INestApplication, prisma: PrismaService;
const users = [randomUUID(), randomUUID(), randomUUID()], tokens: string[] = [], fixtures: string[] = [];
before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication(); configureApp(app); configureSwagger(app); await app.init(); await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService);
  for (const id of users) {
    await prisma.user.create({ data: { id, email: `cancel_${id}@example.test`, handle: `ca_${id.replaceAll('-', '').slice(0, 24)}`, displayName: 'Cancel fixture', passwordHash: 'fixture-only' } });
    const service = app.get(AuthTokenService), material = service.createRefreshToken();
    const session = await prisma.authSession.create({ data: { userId: id, tokenHash: material.hash, expiresAt: material.expiresAt } });
    tokens.push(await service.signAccessToken(id, session.id));
  }
});
after(async () => {
  if (prisma) {
    await prisma.lobby.deleteMany({ where: { id: { in: fixtures } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  await app?.close();
});
async function lobby(status: LobbyStatus = 'PUBLISHED', past = false) {
  const id = randomUUID(); fixtures.push(id);
  await prisma.lobby.create({ data: { id, organizerId: users[0]!, title: `Cancel ${id.slice(0, 8)}`, description: 'Isolated cancellation',
    category: 'GAMING', isOnline: true, capacity: 4, status, startsAt: past ? '2000-01-01T00:00:00.000Z' : '2200-01-01T00:00:00.000Z',
    updatedAt: '2000-01-01T00:00:00.000Z', members: { create: [{ userId: users[0]!, role: 'ORGANIZER', status: 'JOINED' }, { userId: users[1]!, status: 'JOINED' }] },
  } }); return id;
}
const post = (id: string, action = 'cancel', user = 0) => request(app.getHttpServer()).post(`/api/v1/lobbies/${id}/${action}`).auth(tokens[user]!, { type: 'bearer' });
const get = (path: string, user = 0) => request(app.getHttpServer()).get(`/api/v1/${path}`).auth(tokens[user]!, { type: 'bearer' });

test('cancel requires Bearer, organizerId ownership (not membership), and empty body/query', async () => {
  const id = await lobby();
  await request(app.getHttpServer()).post(`/api/v1/lobbies/${id}/cancel`).expect(401);
  for (const user of [1, 2]) assert.equal((await post(id, 'cancel', user).expect(403)).body.error.code, 'LOBBY_ORGANIZER_REQUIRED');
  for (const body of [{ userId: users[0] }, { organizerId: users[0] }, { status: 'CANCELLED' }, { members: [] }, [], 'invalid']) {
    assert.equal((await post(id).send(body).expect(400)).body.error.code, 'VALIDATION_FAILED');
  }
  for (const query of ['userId=x', 'status=CANCELLED', 'id=x', 'x[y]=z']) assert.equal((await post(id).query(query).expect(400)).body.error.code, 'VALIDATION_FAILED');
  await post('not-a-uuid').expect(400);
  await prisma.lobbyMember.delete({ where: { lobbyId_userId: { lobbyId: id, userId: users[0]! } } });
  assert.deepEqual((await post(id).expect(200)).body, { id, status: 'CANCELLED' });
});

test('cancel status/time policy hides unavailable events and permits only owner CANCELLED replay', async () => {
  for (const id of [randomUUID(), await lobby('DRAFT'), await lobby('COMPLETED')]) {
    for (const user of [0, 1]) assert.equal((await post(id, 'cancel', user).expect(404)).body.error.code, 'LOBBY_NOT_FOUND');
  }
  const started = await lobby('PUBLISHED', true);
  assert.equal((await post(started).expect(409)).body.error.code, 'LOBBY_STARTED');
  await post(started, 'cancel', 1).expect(403);
  const cancelled = await lobby('CANCELLED', true), before = await prisma.lobby.findUniqueOrThrow({ where: { id: cancelled } });
  assert.deepEqual((await post(cancelled).expect(200)).body, { id: cancelled, status: 'CANCELLED' });
  await post(cancelled, 'cancel', 1).expect(404);
  assert.deepEqual(await prisma.lobby.findUniqueOrThrow({ where: { id: cancelled } }), before);
});

test('first cancellation changes only status/updatedAt; replays preserve all history and timestamps', async () => {
  const id = await lobby();
  await prisma.lobbyMessage.create({ data: { lobbyId: id, authorId: users[1]!, body: 'Keep this message' } });
  await prisma.lobbyMember.create({ data: { lobbyId: id, userId: users[2]!, status: 'LEFT', leftAt: new Date('2025-01-01') } });
  await prisma.lobbyInvite.create({ data: { lobbyId: id, inviterId: users[0]!, inviteeId: users[2]! } });
  await prisma.moment.create({ data: { lobbyId: id, authorId: users[0]!, caption: 'Keep linked moment' } });
  const read = () => prisma.lobby.findUniqueOrThrow({ where: { id }, include: { members: { orderBy: { userId: 'asc' } }, messages: true, invites: true, moments: true } });
  const before = await read();
  await post(id).expect(200); const first = await read();
  assert.equal(first.status, 'CANCELLED'); assert.ok(first.updatedAt > before.updatedAt);
  assert.deepEqual({ ...first, status: before.status, updatedAt: before.updatedAt }, before);
  await post(id).expect(200); assert.deepEqual(await read(), first);
  // Move only this fixture's start into the past to exercise the no-op ordering.
  await prisma.lobby.update({ where: { id }, data: { startsAt: new Date('2000-01-01') } });
  const past = await read(); await post(id).expect(200); assert.deepEqual(await read(), past);
});

test('cancel hides all/mine/search/inbox and denies details/messages/join/leave/send without deleting data', async () => {
  const id = await lobby(), record = await prisma.lobby.findUniqueOrThrow({ where: { id } });
  await post(id, 'messages', 1).send({ clientMessageId: randomUUID(), body: 'Saved before cancel' }).expect(201);
  const paths = ['lobbies?limit=50', 'lobbies?scope=mine&limit=50', `lobbies?q=${encodeURIComponent(record.title)}`, 'chats?limit=50'];
  for (const user of [0, 1]) for (const path of paths) {
    const rows = (await get(path, user).expect(200)).body.items;
    assert.ok(rows.some((r: { id?: string; lobby?: { id: string } }) => (r.id ?? r.lobby?.id) === id));
  }
  await post(id).expect(200);
  for (const user of [0, 1]) {
    for (const path of paths) assert.ok(!(await get(path, user).expect(200)).body.items.some((r: { id?: string; lobby?: { id: string } }) => (r.id ?? r.lobby?.id) === id));
    for (const path of [`lobbies/${id}`, `lobbies/${id}/messages`]) await get(path, user).expect(404);
    for (const action of ['join', 'leave']) assert.equal((await post(id, action, user).expect(404)).body.error.code, 'LOBBY_NOT_FOUND');
    await post(id, 'messages', user).send({ clientMessageId: randomUUID(), body: 'Denied' }).expect(404);
  }
  assert.equal(await prisma.lobbyMember.count({ where: { lobbyId: id } }), 2);
  assert.equal(await prisma.lobbyMessage.count({ where: { lobbyId: id } }), 1);
});

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function overlap(id: string, calls: (() => Promise<request.Response>)[]) {
  const held = deferred(), release = deferred();
  const blocker = prisma.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM "Lobby" WHERE id = ${id}::uuid FOR UPDATE`; held.resolve(); await release.promise; }, { timeout: 15000 });
  await held.promise; const pending: Promise<request.Response>[] = [];
  try {
    for (const call of calls) {
      pending.push(call()); const deadline = Date.now() + 3500; let count = 0;
      while (Date.now() < deadline) {
        const rows = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM "Lobby"%FOR UPDATE%'`;
        count = rows[0]!.count; if (count >= pending.length) break; await setImmediate();
      }
      assert.ok(count >= pending.length, 'Both HTTP transactions must be waiting on actual PostgreSQL locks');
    }
  } finally { release.resolve(); await blocker; }
  return Promise.all(pending);
}

test('overlapping cancel/cancel coalesces database effect with two identical successful responses', async () => {
  const id = await lobby();
  const results = await overlap(id, [() => post(id).then(r => r), () => post(id).then(r => r)]);
  assert.deepEqual(results.map(r => r.status), [200, 200]); assert.deepEqual(results[0]!.body, results[1]!.body);
  const first = await prisma.lobby.findUniqueOrThrow({ where: { id } }); await post(id).expect(200);
  assert.deepEqual(await prisma.lobby.findUniqueOrThrow({ where: { id } }), first);
  const notices = await prisma.notification.findMany({ where: { lobbyId: id, type: 'LOBBY_CANCELLED' } });
  assert.deepEqual(notices.map(row => row.recipientId), [users[1]]);
});

test('overlapping cancel/join, cancel/leave and cancel/send serialize both orders and snapshot the right recipients', async () => {
  for (const action of ['join', 'leave', 'messages']) for (const cancelFirst of [true, false]) {
    const id = await lobby();
    const mutation = () => (action === 'join' ? post(id, action, 2) : action === 'leave' ? post(id, action, 1) : post(id, action, 1).send({ clientMessageId: randomUUID(), body: 'Concurrent' })).then(r => r);
    const cancel = () => post(id).then(r => r);
    const responses = await overlap(id, cancelFirst ? [cancel, mutation] : [mutation, cancel]);
    assert.deepEqual(responses.map(r => r.status), cancelFirst ? [200, 404] : [action === 'messages' ? 201 : 200, 200]);
    if (action !== 'leave') {
      const count = action === 'join' ? await prisma.lobbyMember.count({ where: { lobbyId: id, userId: users[2]! } }) : await prisma.lobbyMessage.count({ where: { lobbyId: id } });
      assert.equal(count, cancelFirst ? 0 : 1);
    } else assert.equal((await prisma.lobbyMember.findUniqueOrThrow({ where: { lobbyId_userId: { lobbyId: id, userId: users[1]! } } })).status, cancelFirst ? 'JOINED' : 'LEFT');
    const recipients = (await prisma.notification.findMany({ where: { lobbyId: id, type: 'LOBBY_CANCELLED' } })).map(row => row.recipientId).sort();
    const expected = action === 'leave' && !cancelFirst ? [] : action === 'join' && !cancelFirst ? [users[1], users[2]] : [users[1]];
    assert.deepEqual(recipients, expected.sort());
    assert.equal((await prisma.lobby.findUniqueOrThrow({ where: { id } })).status, 'CANCELLED');
  }
});

test('overlapping edit/cancel snapshots the title after the preceding edit commit under the same lock', async () => {
  const id = await lobby();
  const responses = await overlap(id, [
    () => request(app.getHttpServer()).patch(`/api/v1/lobbies/${id}`).auth(tokens[0]!, { type: 'bearer' }).send({ title: 'Edited before cancellation' }).then(r => r),
    () => post(id).then(r => r),
  ]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]);
  const rows = await prisma.notification.findMany({ where: { lobbyId: id, type: 'LOBBY_CANCELLED' } });
  assert.equal(rows.length, 1); assert.equal(rows[0]!.lobbyTitleSnapshot, 'Edited before cancellation');
});

test('Swagger documents owner cancellation, replay and safe response/error codes', async () => {
  const docs = (await request(app.getHttpServer()).get('/docs-json').expect(200)).body;
  const route = docs.paths['/api/v1/lobbies/{id}/cancel'].post;
  assert.ok(route.security); for (const code of ['200', '400', '401', '403', '404', '409']) assert.ok(route.responses[code]);
  assert.match(route.description, /no-op even after startsAt/);
  assert.deepEqual(docs.components.schemas.CancelLobbyResponseDto.properties.status.enum, ['CANCELLED']);
});
