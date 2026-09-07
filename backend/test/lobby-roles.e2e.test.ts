import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp, configureSwagger } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthTokenService } from '../src/auth/auth-token.service';
import { LobbiesService } from '../src/lobbies/lobbies.service';
import type { LobbyRolesDto } from '../src/lobbies/dto/lobby-role.dto';

let app: INestApplication | undefined;
let db: PrismaService;
const users: string[] = [], tokens: string[] = [], ids: string[] = [];
const input = { title: 'Roles isolated fixture', description: 'Optional duties', startsAt: '2200-01-01T12:00:00.000Z', timeZone: 'Asia/Bishkek', capacity: 8, isOnline: true, venueName: null };
const definitions = [{ name: 'Ведущий', description: ' Ведёт игру ' }, { name: 'Музыкант' }, { name: 'Фотограф' }];
before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication(); configureApp(app); configureSwagger(app); await app.init(); db = app.get(PrismaService);
  for (let i = 0; i < 4; i++) {
    const id = randomUUID();
    const user = await db.user.create({ data: { id, email: `roles_${id}@example.test`, handle: `r_${id.replaceAll('-', '').slice(0, 22)}`, displayName: 'Role fixture', passwordHash: 'not-a-login-hash' } });
    users.push(user.id); // Only confirmed creations are cleanup targets, including partial setup failure.
    const tokenService = app.get(AuthTokenService), material = tokenService.createRefreshToken();
    const session = await db.authSession.create({ data: { userId: user.id, tokenHash: material.hash, expiresAt: material.expiresAt } });
    tokens.push(await tokenService.signAccessToken(user.id, session.id));
  }
});
after(async () => {
  try {
    if (db) {
      await db.lobby.deleteMany({ where: { id: { in: ids }, organizerId: { in: users } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
    }
  } finally { await app?.close(); }
});
const http = () => request(app!.getHttpServer());
const auth = (req: request.Test, u = 0) => req.auth(tokens[u]!, { type: 'bearer' });
const roles = (id: string, u = 0) => auth(http().get(`/api/v1/lobbies/${id}/roles`), u);
const change = (id: string, role: string, action: 'select' | 'release' = 'select', u = 0) => auth(http().post(`/api/v1/lobbies/${id}/roles/${role}/${action}`), u);
const member = (id: string, action: 'join' | 'leave', u: number) => auth(http().post(`/api/v1/lobbies/${id}/${action}`), u);
async function create(withRoles = true) {
  const r = await auth(http().post('/api/v1/lobbies')).send({ ...input, ...(withRoles ? { roles: definitions } : {}) }).expect(201);
  ids.push(r.body.id as string);
  return r.body.id as string;
}
const list = async (id: string, u = 0): Promise<LobbyRolesDto['items']> => (await roles(id, u).expect(200)).body.items as LobbyRolesDto['items'];

test('creation without/with optional roles preserves order, Unicode trims, safe projection and unassigned organizer', async () => {
  const old = await create(false); assert.deepEqual(await list(old), []);
  const id = await create(); const rows = await list(id);
  assert.deepEqual(rows.map(r => [r.name, r.description, r.assignedUserId]), [['Ведущий','Ведёт игру',null],['Музыкант','',null],['Фотограф','',null]]);
  assert.equal(await db.lobbyMember.count({ where: { lobbyId: id, userId: users[0], role: 'ORGANIZER', status: 'JOINED' } }), 1);
  assert.equal(await db.lobbyRoleAssignment.count({ where: { lobbyId: id } }), 0);
  assert.deepEqual(Object.keys(rows[0]!).sort(), ['id','name','description','assignedUserId'].sort());
  assert.doesNotMatch(JSON.stringify(rows), /email|password|storageKey|tokenHash|recipientId/);
  await change(id, rows[0]!.id).expect(200);
  const service = app!.get(AuthTokenService), material = service.createRefreshToken();
  const session = await db.authSession.create({ data: { userId: users[0]!, tokenHash: material.hash, expiresAt: material.expiresAt } });
  tokens[0] = await service.signAccessToken(users[0]!, session.id);
  assert.equal((await list(id))[0]!.assignedUserId, users[0], 'new authenticated session reads persisted assignment');
});

test('role validation rejects malformed arrays, extra fields, NUL, empty/overlong strings; code points not UTF-16', async () => {
  for (const rolesInput of [null, {}, 'roles', [null], ['name'], [{ name: '  ' }], [{ name: 1 }], [{ name: '12345678901' }],
    [{ name: 'a', description: 'x'.repeat(51) }], [{ name: 'a', description: null }], [{ name: 'a', userId: users[0] }],
    [{ name: 'a\u0000' }], [{ name: 'a', description: '\u0000' }], Array.from({ length: 21 }, () => ({ name: 'a' }))]) {
    const r = await auth(http().post('/api/v1/lobbies')).send({ ...input, roles: rolesInput }).expect(400);
    assert.equal(r.body.error.code, 'VALIDATION_FAILED');
  }
  const r = await auth(http().post('/api/v1/lobbies')).send({ ...input, roles: [{ name: ` ${'🎭'.repeat(10)} `, description: ` ${'𐐀'.repeat(50)} ` }] }).expect(201);
  ids.push(r.body.id as string);
  assert.equal(Array.from((await list(r.body.id as string))[0]!.name).length, 10);
  await auth(http().post('/api/v1/lobbies')).send({ ...input, roles: [{ name: '🎭'.repeat(11) }] }).expect(400);
});

test('nested role failure rolls back lobby and organizer membership atomically', async () => {
  const beforeCount = await db.lobby.count({ where: { organizerId: users[0] } });
  // Bypass HTTP validation only to exercise the DB CHECK in the real nested write.
  await assert.rejects(app!.get(LobbiesService).create({ ...input, roles: [{ name: '' }] }, users[0]!));
  assert.equal(await db.lobby.count({ where: { organizerId: users[0] } }), beforeCount);
});

test('roles use chat access: Bearer, JOINED only, no identity/body/query overrides, PUBLISHED past allowed', async () => {
  const id = await create(), role = (await list(id))[0]!.id;
  await http().get(`/api/v1/lobbies/${id}/roles`).expect(401);
  await http().post(`/api/v1/lobbies/${id}/roles/${role}/select`).expect(401);
  for (const status of [null, 'LEFT', 'REMOVED'] as const) {
    if (status) await db.lobbyMember.upsert({ where: { lobbyId_userId: { lobbyId: id, userId: users[1]! } },
      create: { lobbyId: id, userId: users[1]!, status }, update: { status } });
    await roles(id, 1).expect(403); await change(id, role, 'select', 1).expect(403); await change(id, role, 'release', 1).expect(403);
  }
  for (const action of ['select','release'] as const) {
    await change(id, role, action).send({ userId: users[1] }).expect(400);
    await change(id, role, action).query({ role: 'ORGANIZER' }).expect(400);
  }
  await roles(id).query({ userId: users[1] }).expect(400);
  await roles('bad-id').expect(400);
  await db.lobby.update({ where: { id }, data: { startsAt: '2000-01-01T00:00:00.000Z' } });
  await change(id, role).expect(200); await roles(id).expect(200);
  for (const status of ['CANCELLED','COMPLETED','DRAFT'] as const) {
    await db.lobby.update({ where: { id }, data: { status } });
    await roles(id).expect(404); await change(id, role).expect(404); await change(id, role, 'release').expect(404);
  }
});

test('select/switch/release are idempotent; failed switch keeps old role; late release(A) cannot remove B', async () => {
  const id = await create(), [a,b,c] = await list(id);
  await member(id, 'join', 1).expect(200);
  await change(id, a!.id).expect(200); await change(id, a!.id).expect(200);
  assert.equal(await db.lobbyRoleAssignment.count({ where: { lobbyId: id, userId: users[0] } }), 1);
  await change(id, b!.id, 'select', 1).expect(200);
  const conflict = await change(id, b!.id).expect(409); assert.equal(conflict.body.error.code, 'LOBBY_ROLE_TAKEN');
  assert.equal((await list(id))[0]!.assignedUserId, users[0]);
  await change(id, c!.id).expect(200);
  await change(id, a!.id, 'release').expect(200); await change(id, a!.id, 'release').expect(200);
  assert.equal((await list(id))[2]!.assignedUserId, users[0]);
  await change(id, b!.id, 'release').expect(200); assert.equal((await list(id))[1]!.assignedUserId, users[1]);
  await change(id, c!.id, 'release').expect(200); assert.equal((await list(id))[2]!.assignedUserId, null);
});

test('leave frees only own assignment in its transaction; rejoin never restores it; role is unrelated to permissions/messages', async () => {
  const id = await create(), a = (await list(id))[0]!;
  await member(id, 'join', 1).expect(200); await change(id, a.id, 'select', 1).expect(200);
  const messageId = randomUUID();
  await auth(http().post(`/api/v1/lobbies/${id}/messages`), 1).send({ clientMessageId: messageId, body: 'Current not historical role' }).expect(201);
  await member(id, 'leave', 1).expect(200);
  assert.equal((await list(id))[0]!.assignedUserId, null);
  await member(id, 'join', 1).expect(200); assert.equal((await list(id))[0]!.assignedUserId, null);
  assert.equal((await db.lobbyMessage.findUniqueOrThrow({ where: { id: messageId } })).body, 'Current not historical role');
  assert.equal((await db.lobbyMember.findUniqueOrThrow({ where: { lobbyId_userId: { lobbyId: id, userId: users[1]! } } })).role, 'MEMBER');
  await auth(http().post(`/api/v1/lobbies/${id}/messages`), 1).send({ clientMessageId: randomUUID(), body: 'Writing without a role' }).expect(201);
});

test('DB uniqueness and composite foreign keys forbid double/cross-lobby assignments', async () => {
  const id = await create(), other = await create(), [a,b] = await list(id), foreign = (await list(other))[0]!;
  await member(id, 'join', 1).expect(200); await change(id, a!.id).expect(200);
  await change(id, foreign.id).expect(404);
  await assert.rejects(db.lobbyRoleAssignment.create({ data: { lobbyId: id, roleId: foreign.id, userId: users[1]! } }));
  await assert.rejects(db.lobbyRoleAssignment.create({ data: { lobbyId: id, roleId: b!.id, userId: users[0]! } }));
  await assert.rejects(db.lobbyRoleAssignment.create({ data: { lobbyId: id, roleId: a!.id, userId: users[1]! } }));
  await assert.rejects(db.lobbyRoleAssignment.create({ data: { lobbyId: id, roleId: b!.id, userId: users[3]! } }));
  assert.equal(await db.lobbyRoleAssignment.count({ where: { lobbyId: id } }), 1);
});

async function overlap(id: string, calls: (() => Promise<request.Response>)[]) {
  let ready!: () => void, release!: () => void;
  const started = new Promise<void>(r => { ready = r; }), gate = new Promise<void>(r => { release = r; });
  const blocker = db.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM "Lobby" WHERE id = ${id}::uuid FOR UPDATE`; ready(); await gate; }, { timeout: 15000 });
  await started; const pending = calls.map(call => call());
  const settled = Promise.allSettled(pending);
  try {
    const deadline = Date.now() + 4000; let count = 0;
    while (count < calls.length && Date.now() < deadline) {
      const rows = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM "Lobby"%FOR UPDATE%'`;
      count = rows[0]!.n; if (count < calls.length) await setImmediate();
    }
    assert.ok(count >= calls.length, 'requests overlap on PostgreSQL Lobby lock');
  } finally { release(); try { await blocker; } finally { await settled; } }
  return Promise.all(pending);
}
test('real concurrent selection has one winner; loser retains previous role; concurrent identical requests are safe', async () => {
  const id = await create(), [a,b,c] = await list(id); await member(id, 'join', 1).expect(200);
  await change(id, a!.id).expect(200); await change(id, b!.id, 'select', 1).expect(200);
  const results = await overlap(id, [() => change(id, c!.id).then(r => r), () => change(id, c!.id, 'select', 1).then(r => r)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200,409]);
  const loser = results[0]!.status === 409 ? 0 : 1;
  assert.equal((await list(id))[loser]!.assignedUserId, users[loser]);
  const repeated = await overlap(id, [() => change(id, [a,b][loser]!.id, 'select', loser).then(r => r), () => change(id, [a,b][loser]!.id, 'select', loser).then(r => r)]);
  assert.ok(repeated.every(r => r.status === 200));
  assert.equal(await db.lobbyRoleAssignment.count({ where: { lobbyId: id } }), 2);
});
test('overlapping selection/leave either selects then releases, or rejects after leave; no assignment survives', async () => {
  const id = await create(), role = (await list(id))[0]!; await member(id, 'join', 1).expect(200);
  const result = await overlap(id, [() => change(id, role.id, 'select', 1).then(r => r), () => member(id, 'leave', 1).then(r => r)]);
  assert.ok([200,403].includes(result[0]!.status)); assert.equal(result[1]!.status, 200);
  assert.equal(await db.lobbyRoleAssignment.count({ where: { lobbyId: id, userId: users[1] } }), 0);
});
test('Swagger describes creation roles and strict role access/actions', async () => {
  const r = await http().get('/docs-json').expect(200);
  assert.equal(r.body.components.schemas.CreateLobbyRequestDto.properties.roles.maxItems, 20);
  for (const action of ['select','release']) {
    const op = r.body.paths[`/api/v1/lobbies/{id}/roles/{roleId}/${action}`].post;
    assert.ok(op.security); for (const status of ['200','400','401','403','404']) assert.ok(op.responses[status]);
  }
});
