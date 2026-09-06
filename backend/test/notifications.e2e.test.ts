import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthTokenService } from '../src/auth/auth-token.service';
import { configureApp, configureSwagger } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { LobbiesService } from '../src/lobbies/lobbies.service';

let app: INestApplication, prisma: PrismaService;
const users = Array.from({ length: 4 }, () => randomUUID()), tokens: string[] = [], lobbies: string[] = [], media: string[] = [];
before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication(); configureApp(app); configureSwagger(app); await app.listen(0, '127.0.0.1'); prisma = app.get(PrismaService);
  for (const id of users) {
    await prisma.user.create({ data: { id, email: `notice_${id}@example.test`, handle: `n_${id.replaceAll('-', '').slice(0, 24)}`,
      displayName: 'Имя <plain>', passwordHash: 'fixture-only' } });
    const auth = app.get(AuthTokenService), token = auth.createRefreshToken();
    const session = await prisma.authSession.create({ data: { userId: id, tokenHash: token.hash, expiresAt: token.expiresAt } });
    tokens.push(await auth.signAccessToken(id, session.id));
  }
});
after(async () => {
  if (prisma) {
    await prisma.notification.deleteMany({ where: { recipientId: { in: users } } });
    await prisma.lobby.deleteMany({ where: { id: { in: lobbies } } });
    await prisma.user.updateMany({ where: { id: { in: users } }, data: { avatarMediaId: null } });
    await prisma.mediaAsset.deleteMany({ where: { id: { in: media } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  await app?.close();
});
async function lobby(capacity = 4) {
  const id = randomUUID(); lobbies.push(id);
  await prisma.lobby.create({ data: { id, organizerId: users[0]!, title: 'Notification fixture', description: 'History', category: 'FOOD',
    isOnline: true, capacity, timeZone: 'UTC', status: 'PUBLISHED', startsAt: '2200-01-01T00:00:00.000Z',
    members: { create: { userId: users[0]!, role: 'ORGANIZER', status: 'JOINED' } } } }); return id;
}
const action = (id: string, kind = 'join', user = 1) => request(app.getHttpServer()).post(`/api/v1/lobbies/${id}/${kind}`).auth(tokens[user]!, { type: 'bearer' });
const list = (user = 0) => request(app.getHttpServer()).get('/api/v1/notifications').auth(tokens[user]!, { type: 'bearer' });
const read = (id: string, user = 0) => request(app.getHttpServer()).post(`/api/v1/notifications/${id}/read`).auth(tokens[user]!, { type: 'bearer' });
const notes = (id: string) => prisma.notification.findMany({ where: { lobbyId: id }, orderBy: { createdAt: 'asc' } });
const cursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

test('only real join/rejoin creates an event; no historical backfill, no-op, leave, rejected or self event', async () => {
  const id = await lobby(2); assert.equal((await notes(id)).length, 0);
  await action(id, 'join', 0).expect(200); await action(id).expect(200);
  const first = await notes(id); assert.equal(first.length, 1);
  assert.equal(first[0]!.recipientId, users[0]); assert.equal(first[0]!.actorId, users[1]); assert.equal(first[0]!.type, 'LOBBY_JOINED');
  await action(id).expect(200); await action(id, 'join', 2).expect(409); assert.deepEqual(await notes(id), first);
  await action(id, 'leave').expect(200); assert.deepEqual(await notes(id), first);
  await action(id).expect(200); const rejoined = await notes(id); assert.equal(rejoined.length, 2); assert.notEqual(rejoined[0]!.id, rejoined[1]!.id);
  await prisma.lobbyMember.update({ where: { lobbyId_userId: { lobbyId: id, userId: users[1]! } }, data: { status: 'REMOVED' } });
  await action(id).expect(409); assert.equal((await notes(id)).length, 2);
  // Organizer restored through an actual membership transition still gets no self notice.
  await prisma.lobbyMember.delete({ where: { lobbyId_userId: { lobbyId: id, userId: users[0]! } } });
  await action(id, 'join', 0).expect(200); assert.equal((await notes(id)).length, 2);
  const created = (await request(app.getHttpServer()).post('/api/v1/lobbies').auth(tokens[0]!, { type: 'bearer' }).send({ title: 'Created', description: 'Not a join event', category: 'FOOD', capacity: 2,
    isOnline: true, venueName: null, startsAt: '2200-01-01T00:00:00.000Z', timeZone: 'UTC' }).expect(201)).body;
  lobbies.push(created.id); assert.equal((await notes(created.id)).length, 0);
});

test('notification insert failure rolls back the real PostgreSQL membership transaction', async () => {
  const id = await lobby();
  // Isolated Prisma query extension faults only the notification delegate; the
  // actual service still inserts membership in a real PostgreSQL transaction.
  const faulted = prisma.$extends({ query: { notification: { create() { throw new Error('Isolated notification insertion failure'); } } } });
  const service = new LobbiesService(faulted as unknown as PrismaService);
  await assert.rejects(service.changeMembership(id, users[1]!, 'join'), /Isolated notification insertion failure/);
  assert.equal(await prisma.lobbyMember.count({ where: { lobbyId: id, userId: users[1] } }), 0);
  assert.equal((await notes(id)).length, 0); await action(id).expect(200); assert.equal((await notes(id)).length, 1);
});

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function overlap(table: 'Lobby' | 'Notification', id: string, calls: (() => Promise<request.Response>)[]) {
  const locked = deferred(), release = deferred();
  const blocker = prisma.$transaction(async tx => {
    if (table === 'Lobby') await tx.$queryRaw`SELECT id FROM "Lobby" WHERE id = ${id}::uuid FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "Notification" WHERE id = ${id}::uuid FOR UPDATE`;
    locked.resolve(); await release.promise;
  }, { timeout: 15000 });
  await locked.promise; const pending = calls.map(call => call());
  try {
    const end = performance.now() + 3500; let waiting = 0;
    while (performance.now() < end) {
      const rows = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${`%"${table}"%`}`;
      waiting = rows[0]!.count; if (waiting >= calls.length) break; await setImmediate();
    }
    assert.ok(waiting >= calls.length, 'HTTP transactions actually overlap under a PostgreSQL lock');
  } finally { release.resolve(); await blocker; }
  return Promise.all(pending);
}
test('two concurrent joins by the same user create exactly one membership and one notification', async () => {
  const id = await lobby(); const results = await overlap('Lobby', id, [() => action(id).then(r => r), () => action(id).then(r => r)]);
  assert.deepEqual(results.map(r => r.status), [200, 200]); assert.equal((await notes(id)).length, 1);
  assert.equal(await prisma.lobbyMember.count({ where: { lobbyId: id, userId: users[1] } }), 1);
});

test('list filters recipient AND supported type before stable equal-timestamp cursor pagination', async () => {
  const id = await lobby(), createdAt = new Date('2300-01-01T00:00:00.000Z'), expected: string[] = [];
  for (let i = 0; i < 5; i++) expected.push((await prisma.notification.create({ data: { recipientId: users[2]!, actorId: users[1]!, lobbyId: id, type: 'LOBBY_JOINED', createdAt } })).id);
  for (const type of ['LOBBY_INVITED', 'MOMENT_LIKED', 'MOMENT_COMMENTED'] as const) await prisma.notification.create({ data: { recipientId: users[2]!, type, createdAt: '2301-01-01T00:00:00.000Z' } });
  await prisma.notification.create({ data: { recipientId: users[3]!, type: 'LOBBY_JOINED', createdAt: '2301-01-01T00:00:00.000Z' } });
  const seen: string[] = []; let next: string | null = null;
  do {
    const page: { items: { id: string }[]; nextCursor: string | null } = (await list(2).query({ limit: 2, ...(next ? { after: next } : {}) }).expect(200)).body;
    seen.push(...page.items.map(row => row.id)); next = page.nextCursor;
  } while (next);
  assert.deepEqual(seen, expected.sort().reverse());
  assert.equal((await list(3).expect(200)).body.items.length, 1);
});

test('safe live projections hide cancelled/draft/completed lobbies, deleted actor and invalid avatar records', async () => {
  const id = await lobby(); await action(id).expect(200); const note = (await notes(id))[0]!;
  const row = async () => (await list().expect(200)).body.items.find((item: { id: string }) => item.id === note.id);
  const mediaId = randomUUID(); media.push(mediaId);
  await prisma.mediaAsset.create({ data: { id: mediaId, ownerId: users[1]!, kind: 'IMAGE', storageKey: `avatars/${mediaId}.jpg`, mimeType: 'image/jpeg', width: 512, height: 512, bytes: 300 } });
  await prisma.user.update({ where: { id: users[1]! }, data: { avatarMediaId: mediaId, displayName: 'Current <name>' } });
  await prisma.lobby.update({ where: { id }, data: { title: 'Current title' } });
  const result = await row(); assert.deepEqual(Object.keys(result).sort(), ['actor', 'createdAt', 'id', 'lobby', 'readAt', 'type']);
  assert.deepEqual(Object.keys(result.actor).sort(), ['avatar', 'displayName', 'handle', 'id']);
  assert.deepEqual(result.actor.avatar, { id: mediaId, mimeType: 'image/jpeg', width: 512, height: 512 });
  assert.equal(result.actor.displayName, 'Current <name>'); assert.deepEqual(result.lobby, { id, title: 'Current title' });
  assert.doesNotMatch(JSON.stringify(result), /email|recipientId|passwordHash|tokenHash|storageKey|momentId|commentId/);
  await prisma.mediaAsset.update({ where: { id: mediaId }, data: { storageKey: 'demo/not-an-avatar.jpg' } }); assert.equal((await row()).actor.avatar, null);
  await prisma.mediaAsset.update({ where: { id: mediaId }, data: { storageKey: `avatars/${mediaId}.jpg`, ownerId: users[0]! } }); assert.equal((await row()).actor.avatar, null);
  for (const status of ['CANCELLED', 'DRAFT', 'COMPLETED'] as const) {
    await prisma.lobby.update({ where: { id }, data: { status } }); assert.equal((await row()).lobby, null);
  }
  await prisma.user.update({ where: { id: users[1]! }, data: { avatarMediaId: null } });
  // Real FK SetNull behavior, using a dedicated disposable actor with no memberships.
  const deletedId = randomUUID(); users.push(deletedId);
  await prisma.user.create({ data: { id: deletedId, email: `deleted_${deletedId}@example.test`, handle: `d_${deletedId.replaceAll('-', '').slice(0, 24)}`, displayName: 'Deleted', passwordHash: 'fixture-only' } });
  await prisma.notification.update({ where: { id: note.id }, data: { actorId: deletedId } });
  await prisma.user.delete({ where: { id: deletedId } }); assert.equal((await row()).actor, null);
});

test('read is recipient-scoped, same 404 for unsupported/foreign/missing, and concurrent replay keeps first timestamp', async () => {
  const id = await lobby(); await action(id).expect(200); const note = (await notes(id))[0]!;
  const unsupported = await prisma.notification.create({ data: { recipientId: users[0]!, type: 'LOBBY_INVITED' } });
  for (const [target, user] of [[note.id, 1], [unsupported.id, 0], [randomUUID(), 0]] as const) {
    assert.equal((await read(target, user).expect(404)).body.error.code, 'NOTIFICATION_NOT_FOUND');
  }
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: note.id } })).readAt, null);
  const results = await overlap('Notification', note.id, [() => read(note.id).then(r => r), () => read(note.id).then(r => r)]);
  assert.deepEqual(results.map(r => r.status), [200, 200]); assert.deepEqual(results[0]!.body, results[1]!.body);
  assert.deepEqual((await read(note.id).expect(200)).body, results[0]!.body);
  assert.deepEqual(Object.keys(results[0]!.body).sort(), ['id', 'readAt']);
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: note.id } })).readAt!.toISOString(), results[0]!.body.readAt);
});

test('strict query/body/cursor validation and Bearer requirements are documented', async () => {
  const id = randomUUID(); await request(app.getHttpServer()).get('/api/v1/notifications').expect(401);
  await request(app.getHttpServer()).post(`/api/v1/notifications/${id}/read`).expect(401);
  for (const query of ['limit=0', 'limit=51', 'limit=1.5', 'limit=01', 'limit=2&limit=3', 'limit[x]=2', 'after=', 'after=a&after=b', 'after[x]=x', 'userId=x', 'type=LOBBY_INVITED',
    ...[{}, [], { createdAt: '+275760-09-13T00:00:00.000Z', id }, { createdAt: '2026-02-30T00:00:00.000Z', id }, { createdAt: '2026-01-01T00:00:00.000Z', id, extra: true }, { createdAt: '2026-01-01T00:00:00.000Z', id: 'bad' }].map(value => `after=${cursor(value)}`)]) {
    assert.equal((await list().query(query).expect(400)).body.error.code, 'VALIDATION_FAILED');
  }
  await list().query({ limit: 50 }).expect(200);
  for (const body of [[], { userId: users[0] }, { readAt: '2001-01-01' }]) assert.equal((await read(id).send(body).expect(400)).body.error.code, 'VALIDATION_FAILED');
  await read(id).query({ userId: users[0] }).expect(400); await read('bad').expect(400);
  const docs = (await request(app.getHttpServer()).get('/docs-json').expect(200)).body;
  assert.ok(docs.paths['/api/v1/notifications'].get.security); assert.ok(docs.paths['/api/v1/notifications/{id}/read'].post.responses['404']);
});
