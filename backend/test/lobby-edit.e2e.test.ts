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
const users = Array.from({ length: 4 }, () => randomUUID()), tokens: string[] = [], fixtures: string[] = [];
before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication(); configureApp(app); configureSwagger(app); await app.init(); await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService);
  for (const id of users) {
    await prisma.user.create({ data: { id, email: `edit_${id}@example.test`, handle: `ed_${id.replaceAll('-', '').slice(0, 24)}`, displayName: 'Edit fixture', passwordHash: 'fixture-only' } });
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
async function lobby(status: LobbyStatus = 'PUBLISHED', startsAt = '2200-01-01T00:00:12.345Z') {
  const id = randomUUID(); fixtures.push(id);
  await prisma.lobby.create({ data: { id, organizerId: users[0]!, title: 'Original title', description: 'Original description',
    category: 'FOOD', isOnline: true, capacity: 4, status, startsAt, timeZone: 'America/New_York',
    members: { create: [{ userId: users[0]!, role: 'MEMBER', status: 'JOINED' }, { userId: users[1]!, role: 'ORGANIZER', status: 'JOINED' }] },
  } }); return id;
}
const patch = (id: string, body: unknown, user = 0) => request(app.getHttpServer()).patch(`/api/v1/lobbies/${id}`).auth(tokens[user]!, { type: 'bearer' }).send(body as object);
const post = (id: string, action: string, user = 0) => request(app.getHttpServer()).post(`/api/v1/lobbies/${id}/${action}`).auth(tokens[user]!, { type: 'bearer' });
const read = (id: string) => prisma.lobby.findUniqueOrThrow({ where: { id }, include: { members: { orderBy: { userId: 'asc' } }, messages: true } });

test('edit requires Bearer and actual organizerId; unavailable statuses and started events reject', async () => {
  const id = await lobby();
  await request(app.getHttpServer()).patch(`/api/v1/lobbies/${id}`).send({ title: 'Changed' }).expect(401);
  for (const user of [1, 2]) assert.equal((await patch(id, { title: 'Forbidden' }, user).expect(403)).body.error.code, 'LOBBY_ORGANIZER_REQUIRED');
  for (const hidden of [randomUUID(), await lobby('DRAFT'), await lobby('CANCELLED'), await lobby('COMPLETED')])
    for (const user of [0, 1]) assert.equal((await patch(hidden, { title: 'Hidden' }, user).expect(404)).body.error.code, 'LOBBY_NOT_FOUND');
  const past = await lobby('PUBLISHED', '2000-01-01T00:00:00.000Z');
  assert.equal((await patch(past, { title: 'Started' }).expect(409)).body.error.code, 'LOBBY_STARTED');
  await prisma.lobbyMember.delete({ where: { lobbyId_userId: { lobbyId: id, userId: users[0]! } } });
  await patch(id, { title: 'Organizer without membership' }).expect(200);
});

test('edit strictly rejects empty/null/unknown patches, query fields and invalid scalar types', async () => {
  const id = await lobby();
  const invalid: unknown[] = [{}, [], { title: '' }, { title: '  ' }, { title: 'x'.repeat(41) }, { description: 'x'.repeat(201) },
    { description: '  ' }, { category: 'OTHER' }, { capacity: 1 }, { capacity: 2.1 }, { capacity: 2147483648 },
    ...['title', 'description', 'category', 'capacity', 'isOnline'].flatMap(key => [null, [], {}, 123, 'true'].filter(value => key !== 'capacity' || value !== 123).map(value => ({ [key]: value }))),
    ...['startsAt','timeZone','organizerId','status','minParticipants','members','joinedCount','id','photos'].map(key => ({ [key]: 'forbidden' })),
    { title: 'a\u0000b' }, { description: 'a\u0000b' }];
  // Strings are valid text values, but invalid category/boolean/numeric values.
  for (const body of invalid.filter(value => !value || typeof value !== 'object' || !Object.entries(value).some(([key, value]) => ['title', 'description'].includes(key) && value === 'true'))) {
    const result = await patch(id, body); assert.equal(result.status, 400, JSON.stringify(body));
    assert.equal(result.body.error.code, 'VALIDATION_FAILED', JSON.stringify(body));
  }
  for (const query of ['userId=x','id=x','x[y]=z']) await patch(id, { title: 'No query' }).query(query).expect(400);
  await patch('bad-uuid', { title: 'x' }).expect(400);
});

test('edit online/venue must be a complete normalized pair; scalar null never means omitted', async () => {
  const id = await lobby();
  for (const body of [{ isOnline: true }, { isOnline: false }, { venueName: null }, { venueName: 'Cafe' },
    { isOnline: true, venueName: '' }, { isOnline: false, venueName: null }, { isOnline: false, venueName: '  ' },
    { isOnline: false, venueName: 'x'.repeat(141) }, { isOnline: false, venueName: [] }, { isOnline: null, venueName: null },
    { isOnline: false, venueName: 'a\u0000b' }]) await patch(id, body).expect(400);
  const offline = (await patch(id, { isOnline: false, venueName: '  Real cafe  ' }).expect(200)).body;
  assert.equal(offline.venueName, 'Real cafe'); assert.equal(offline.isOnline, false);
  const online = (await patch(id, { isOnline: true, venueName: null }).expect(200)).body;
  assert.equal(online.venueName, null); assert.equal(online.isOnline, true);
});

test('capacity uses current JOINED including organizer, excludes LEFT/REMOVED, and preserves minParticipants', async () => {
  const id = await lobby();
  await prisma.lobbyMember.createMany({ data: [{ lobbyId: id, userId: users[2]!, status: 'LEFT' }, { lobbyId: id, userId: users[3]!, status: 'REMOVED' }] });
  assert.equal((await patch(id, { capacity: 2 }).expect(200)).body.joinedCount, 2);
  await patch(id, { capacity: 4 }).expect(200);
  await prisma.lobbyMember.update({ where: { lobbyId_userId: { lobbyId: id, userId: users[2]! } }, data: { status: 'JOINED' } });
  assert.equal((await patch(id, { capacity: 2 }).expect(409)).body.error.code, 'LOBBY_CAPACITY_BELOW_JOINED');
  await patch(id, { capacity: 3 }).expect(200);
  await prisma.lobby.update({ where: { id }, data: { capacity: 4, minParticipants: 4 } });
  assert.equal((await patch(id, { capacity: 3 }).expect(409)).body.error.code, 'LOBBY_CAPACITY_BELOW_MIN_PARTICIPANTS');
  assert.equal((await read(id)).minParticipants, 4);
});

test('successful PATCH changes only allowed fields and keeps exact schedule, membership and messages', async () => {
  const id = await lobby();
  await prisma.lobbyMessage.create({ data: { lobbyId: id, authorId: users[1]!, body: 'Keep our plans' } });
  const before = await read(id);
  const dto = (await patch(id, { title: '  New title  ', description: '  New description  ', category: 'SPORT', capacity: 3, isOnline: false, venueName: '  Stadium  ' }).expect(200)).body;
  const updated = await read(id);
  assert.deepEqual({ ...updated, title: before.title, description: before.description, category: before.category, capacity: before.capacity, isOnline: before.isOnline, venueName: before.venueName, updatedAt: before.updatedAt }, before);
  assert.equal(dto.title, 'New title'); assert.equal(dto.startsAt, before.startsAt.toISOString()); assert.equal(dto.timeZone, 'America/New_York');
  assert.equal(dto.isOrganizer, true); assert.equal(dto.isJoined, true);
  assert.deepEqual(Object.keys(dto).sort(), ['id','title','description','category','startsAt','timeZone','isOnline','venueName','capacity','joinedCount','isJoined','membershipStatus','isOrganizer','groupExtroversionLevel'].sort());
  assert.doesNotMatch(JSON.stringify(dto), /email|passwordHash|tokenHash|storageKey|organizerId|minParticipants|members":/);
});

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function overlap(id: string, calls: (() => Promise<request.Response>)[], beforeRelease?: () => Promise<void>) {
  const held = deferred(), release = deferred();
  const blocker = prisma.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM "Lobby" WHERE id = ${id}::uuid FOR UPDATE`; held.resolve(); await release.promise; }, { timeout: 15000 });
  await held.promise; const pending: Promise<request.Response>[] = [];
  try {
    for (const call of calls) {
      pending.push(call()); const deadline = performance.now() + 3500; let count = 0;
      while (performance.now() < deadline) {
        const rows = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM "Lobby"%FOR UPDATE%'`;
        count = rows[0]!.count; if (count >= pending.length) break; await setImmediate();
      }
      assert.ok(count >= pending.length, 'HTTP transactions really overlap while blocked in PostgreSQL');
    }
    await beforeRelease?.();
  } finally { release.resolve(); await blocker; }
  return Promise.all(pending);
}

test('overlapping capacity PATCH/join protects the last place in both lock orders', async () => {
  for (const editFirst of [true, false]) {
    const id = await lobby();
    const edit = () => patch(id, { capacity: 2 }).then(r => r), join = () => post(id, 'join', 2).then(r => r);
    const results = await overlap(id, editFirst ? [edit, join] : [join, edit]);
    assert.deepEqual(results.map(r => r.status), [200, 409]);
    assert.equal(results[1]!.body.error.code, editFirst ? 'LOBBY_FULL' : 'LOBBY_CAPACITY_BELOW_JOINED');
    const record = await read(id); assert.ok(record.members.filter(m => m.status === 'JOINED').length <= record.capacity);
  }
});

test('overlapping PATCH/cancel serializes; separate fields merge and same field is last commit wins', async () => {
  for (const cancelFirst of [true, false]) {
    const id = await lobby(), edit = () => patch(id, { title: 'Edited first' }).then(r => r), cancel = () => post(id, 'cancel').then(r => r);
    const results = await overlap(id, cancelFirst ? [cancel, edit] : [edit, cancel]);
    assert.deepEqual(results.map(r => r.status), cancelFirst ? [200, 404] : [200, 200]);
    const record = await read(id); assert.equal(record.status, 'CANCELLED'); assert.equal(record.title, cancelFirst ? 'Original title' : 'Edited first');
  }
  const id = await lobby();
  const results = await overlap(id, [() => patch(id, { title: 'First' }).then(r => r), () => patch(id, { description: 'Independent' }).then(r => r)]);
  assert.deepEqual(results.map(r => r.status), [200, 200]); assert.equal((await read(id)).title, 'First'); assert.equal((await read(id)).description, 'Independent');
  await overlap(id, [() => patch(id, { title: 'Earlier' }).then(r => r), () => patch(id, { title: 'Later' }).then(r => r)]);
  assert.equal((await read(id)).title, 'Later');
});

test('PATCH checks the clock after the lock wait, not when the request started', async t => {
  const now = Date.now(), id = await lobby('PUBLISHED', new Date(now + 60000).toISOString());
  t.mock.method(Date, 'now', () => now);
  const results = await overlap(id, [() => patch(id, { title: 'Too late' }).then(r => r)], async () => { t.mock.method(Date, 'now', () => now + 60001); });
  assert.equal(results[0]!.status, 409); assert.equal(results[0]!.body.error.code, 'LOBBY_STARTED'); assert.equal((await read(id)).title, 'Original title');
});

test('Swagger documents partial inputs, fixed schedule and capacity business errors', async () => {
  const docs = (await request(app.getHttpServer()).get('/docs-json').expect(200)).body;
  const route = docs.paths['/api/v1/lobbies/{id}'].patch;
  assert.ok(route.security); for (const code of ['200','400','401','403','404','409']) assert.ok(route.responses[code]);
  assert.match(route.responses['409'].description, /LOBBY_CAPACITY_BELOW_MIN_PARTICIPANTS/);
  assert.deepEqual(Object.keys(docs.components.schemas.UpdateLobbyRequestDto.properties).sort(), ['capacity','category','description','isOnline','title','venueName']);
});
