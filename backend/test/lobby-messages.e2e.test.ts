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
const users = [randomUUID(), randomUUID(), randomUUID()];
const tokens: string[] = [], lobbies: string[] = [];
before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication(); configureApp(app); configureSwagger(app); await app.init(); await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService);
  for (const id of users) {
    await prisma.user.create({ data: { id, email: `chat_${id}@example.test`, handle: `ch_${id.replaceAll('-', '').slice(0, 24)}`,
      displayName: 'Chat test author', passwordHash: 'not-a-login-hash' } });
    const service = app.get(AuthTokenService), material = service.createRefreshToken();
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
async function lobby(status: LobbyStatus = 'PUBLISHED', startsAt = '2200-01-01T00:00:00.000Z') {
  const id = randomUUID(); lobbies.push(id);
  await prisma.lobby.create({ data: { id, organizerId: users[0]!, title: 'Isolated REST chat', description: 'Chat fixtures only',
    category: 'GAMING', timeZone: 'UTC', isOnline: true, capacity: 3, status, startsAt,
    members: { create: [{ userId: users[0]!, role: 'ORGANIZER', status: 'JOINED' }, { userId: users[1]!, status: 'JOINED' }] },
  } });
  return id;
}
const url = (id: string) => `/api/v1/lobbies/${id}/messages`;
const get = (id: string, user = 0) => request(app.getHttpServer()).get(url(id)).auth(tokens[user]!, { type: 'bearer' });
const post = (id: string, input: unknown, user = 0) => request(app.getHttpServer()).post(url(id)).auth(tokens[user]!, { type: 'bearer' }).send(input as object);
const input = (body = 'Hello / Привет <b>plain text</b>') => ({ clientMessageId: randomUUID(), body });

test('chat requires Bearer and hides missing/unpublished lobbies for reads and sends', async () => {
  const id = await lobby();
  await request(app.getHttpServer()).get(url(id)).expect(401);
  await request(app.getHttpServer()).post(url(id)).send(input()).expect(401);
  for (const unavailable of [randomUUID(), await lobby('DRAFT'), await lobby('COMPLETED'), await lobby('CANCELLED')]) {
    for (const call of [get(unavailable), post(unavailable, input())]) {
      assert.equal((await call.expect(404)).body.error.code, 'LOBBY_NOT_FOUND');
    }
  }
});
test('two JOINED members read persisted safe messages, including organizer and past PUBLISHED', async () => {
  const id = await lobby('PUBLISHED', '2000-01-01T00:00:00.000Z');
  const sent = (await post(id, input('  Hello\nПривет  ')).expect(201)).body;
  assert.equal(sent.body, 'Hello\nПривет'); assert.equal(sent.lobbyId, id);
  assert.deepEqual(Object.keys(sent).sort(), ['id','lobbyId','body','createdAt','author'].sort());
  assert.deepEqual(Object.keys(sent.author).sort(), ['id','displayName','handle'].sort());
  assert.equal(sent.author.id, users[0]);
  assert.doesNotMatch(JSON.stringify(sent), /email|passwordHash|tokenHash|refreshToken|storageKey|deletedAt|editedAt/);
  for (const user of [0, 1]) assert.deepEqual((await get(id, user).expect(200)).body.items, [sent]);
  await prisma.lobbyMember.update({ where: { lobbyId_userId: { lobbyId: id, userId: users[0]! } }, data: { status: 'LEFT' } });
  await get(id).expect(403); // organizerId alone never grants chat access
});
test('outsider, LEFT and REMOVED cannot read or send; access is checked before idempotent replay', async () => {
  const id = await lobby(), payload = input();
  await post(id, payload, 1).expect(201);
  for (const call of [get(id, 2), post(id, input(), 2)]) assert.equal((await call.expect(403)).body.error.code, 'LOBBY_CHAT_FORBIDDEN');
  for (const status of ['LEFT', 'REMOVED'] as const) {
    await prisma.lobbyMember.update({ where: { lobbyId_userId: { lobbyId: id, userId: users[1]! } }, data: { status } });
    for (const call of [get(id, 1), post(id, payload, 1)]) assert.equal((await call.expect(403)).body.error.code, 'LOBBY_CHAT_FORBIDDEN');
  }
});
test('message input rejects empty/oversized/non-string/NUL text, invalid UUID and internal fields', async () => {
  const id = await lobby();
  for (const invalid of [ {}, { body: 'x' }, { ...input(), clientMessageId: 'not-uuid' },
    ...['', ' \n ', 'x'.repeat(2001), 123, null, [], {}, 'a\u0000b'].map(body => ({ ...input(), body })),
    ...['authorId','lobbyId','createdAt','deletedAt','status'].map(key => ({ ...input(), [key]: users[2] })) ]) {
    assert.equal((await post(id, invalid).expect(400)).body.error.code, 'VALIDATION_FAILED');
  }
  await post(id, input()).query({ authorId: users[2] }).expect(400);
  await post(id, input('x'.repeat(2000))).expect(201);
  assert.equal(await prisma.lobbyMessage.count({ where: { lobbyId: id } }), 1);
});
test('message query validates limits, cursors, arrays, objects, extended years and unknown fields', async () => {
  const id = await lobby();
  const cursor = (createdAt: string) => Buffer.from(JSON.stringify({ createdAt, id: randomUUID() })).toString('base64url');
  for (const query of ['limit=0','limit=51','limit=1.5','limit=x','limit=2&limit=3','before=x','before=',
    'before[x]=y','limit[x]=2','userId=x', `before=${cursor('+275760-09-13T00:00:00.000Z')}`, `before=${cursor('2026-02-30T00:00:00.000Z')}`]) {
    const result = await get(id).query(query).expect(400); assert.equal(result.body.error.code, 'VALIDATION_FAILED');
  }
  await get('not-uuid').expect(400);
  assert.deepEqual((await get(id).expect(200)).body, { items: [], nextCursor: null });
});
test('history filters lobby/deleted messages before stable tuple pagination with equal timestamps', async () => {
  const id = await lobby(), other = await lobby(), createdAt = new Date('2025-01-01T00:00:00.000Z');
  const ids = Array.from({ length: 7 }, () => randomUUID()).sort().reverse();
  await prisma.lobbyMessage.createMany({ data: ids.map(messageId => ({ id: messageId, lobbyId: id, authorId: users[0]!, body: messageId, createdAt })) });
  await prisma.lobbyMessage.createMany({ data: [
    { lobbyId: other, authorId: users[0]!, body: 'other lobby', createdAt },
    { lobbyId: id, authorId: users[0]!, body: 'deleted', createdAt, deletedAt: new Date() },
  ] });
  const seen: string[] = []; let before: string | null = null;
  do {
    const result: { body: { items: { id: string }[]; nextCursor: string | null } } = await get(id).query({ limit: 2, ...(before ? { before } : {}) }).expect(200);
    seen.push(...result.body.items.map(item => item.id)); before = result.body.nextCursor;
  } while (before);
  assert.deepEqual(seen, ids);
});
test('same logical POST is 200 on retry, preserves normalized body/time and inserts one row', async () => {
  const id = await lobby(), payload = input('  message  ');
  const first = (await post(id, payload).expect(201)).body;
  assert.deepEqual((await post(id, { ...payload, body: 'message' }).expect(200)).body, first);
  assert.equal(await prisma.lobbyMessage.count({ where: { id: payload.clientMessageId } }), 1);
});
test('id conflicts with body, author, lobby or deleted id are generic 409 without foreign data', async () => {
  const id = await lobby(), other = await lobby(), payload = input('PRIVATE BODY');
  await post(id, payload).expect(201);
  for (const call of [post(id, { ...payload, body: 'different' }), post(id, payload, 1), post(other, payload)]) {
    const conflict = await call.expect(409); assert.equal(conflict.body.error.code, 'MESSAGE_ID_CONFLICT');
    assert.doesNotMatch(JSON.stringify(conflict.body), /PRIVATE BODY|displayName|handle/);
  }
  await prisma.lobbyMessage.update({ where: { id: payload.clientMessageId }, data: { deletedAt: new Date() } });
  await post(id, payload).expect(409); assert.equal((await get(id).expect(200)).body.items.length, 0);
});

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
// Both real HTTP transactions are observed blocked in PostgreSQL, in dispatch order.
async function overlapping(ids: string[], calls: (() => Promise<request.Response>)[]) {
  const held = deferred(), release = deferred();
  const blocker = prisma.$transaction(async tx => {
    for (const id of ids) await tx.$queryRaw`SELECT id FROM "Lobby" WHERE id = ${id}::uuid FOR UPDATE`;
    held.resolve(); await release.promise;
  }, { timeout: 15000 });
  await held.promise;
  const pending: Promise<request.Response>[] = [];
  try {
    for (const call of calls) {
      pending.push(call());
      const deadline = Date.now() + 3500; let waiting = 0;
      while (Date.now() < deadline) {
        const rows = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM "Lobby"%FOR UPDATE%'`;
        waiting = rows[0]!.count; if (waiting >= pending.length) break; await setImmediate();
      }
      assert.ok(waiting >= pending.length, 'All dispatched HTTP transactions overlap under the PostgreSQL lock');
    }
  } finally { release.resolve(); await blocker; }
  return Promise.all(pending);
}
test('concurrent duplicate sends create exactly one message and return 201/200', async () => {
  const id = await lobby(), payload = input();
  const results = await overlapping([id], [() => post(id, payload).then(r => r), () => post(id, payload).then(r => r)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
  assert.deepEqual(results[0]!.body, results[1]!.body);
  assert.equal(await prisma.lobbyMessage.count({ where: { lobbyId: id } }), 1);
});
test('concurrent same UUID in different lobbies returns one 201 and one safe 409, not P2002/500', async () => {
  const a = await lobby(), b = await lobby(), payload = input();
  const results = await overlapping([a, b], [() => post(a, payload).then(r => r), () => post(b, payload).then(r => r)]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal(results.find(r => r.status === 409)?.body.error.code, 'MESSAGE_ID_CONFLICT');
  assert.equal(await prisma.lobbyMessage.count({ where: { id: payload.clientMessageId } }), 1);
});
test('real send/leave overlap: leave first denies send; send first persists before leave', async () => {
  for (const leaveFirst of [true, false]) {
    const id = await lobby(), payload = input();
    const send = () => post(id, payload, 1).then(r => r);
    const leave = () => request(app.getHttpServer()).post(`/api/v1/lobbies/${id}/leave`).auth(tokens[1]!, { type: 'bearer' }).then(r => r);
    const results = await overlapping([id], leaveFirst ? [leave, send] : [send, leave]);
    assert.deepEqual(results.map(r => r.status), leaveFirst ? [200, 403] : [201, 200]);
    assert.equal(await prisma.lobbyMessage.count({ where: { lobbyId: id } }), leaveFirst ? 0 : 1);
    await get(id, 1).expect(403);
  }
});
test('Swagger includes message DTO, query parameters, Bearer and repeat/conflict contract', async () => {
  const docs = (await request(app.getHttpServer()).get('/docs-json').expect(200)).body;
  const route = docs.paths['/api/v1/lobbies/{id}/messages'];
  for (const method of ['get', 'post']) {
    assert.ok(route[method].security);
    for (const code of ['200','400','401','403','404']) assert.ok(route[method].responses[code]);
  }
  assert.ok(route.post.responses['201']); assert.ok(route.post.responses['409']);
  assert.ok(route.get.parameters.some((p: { name: string }) => p.name === 'before'));
  assert.ok(docs.components.schemas.SendLobbyMessageDto.properties.clientMessageId);
});
