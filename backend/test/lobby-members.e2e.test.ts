import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
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
const users = Array.from({ length: 4 }, () => randomUUID());
const tokens: string[] = [], lobbies: string[] = [], media: string[] = [];
const joinedAt = '2026-01-01T00:00:00.000Z';
before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication(); configureApp(app); configureSwagger(app); await app.init(); await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService);
  for (const id of users) {
    await prisma.user.create({ data: { id, email: `members_${id}@example.test`, handle: `m_${id.replaceAll('-', '').slice(0, 24)}`,
      displayName: 'Имя <plain text>', passwordHash: 'not-a-login-hash', bio: 'private bio', city: 'private city' } });
    const service = app.get(AuthTokenService), material = service.createRefreshToken();
    const session = await prisma.authSession.create({ data: { userId: id, tokenHash: material.hash, expiresAt: material.expiresAt } });
    tokens.push(await service.signAccessToken(id, session.id));
  }
});
after(async () => {
  if (prisma) {
    await prisma.lobby.deleteMany({ where: { id: { in: lobbies } } });
    await prisma.user.updateMany({ where: { id: { in: users } }, data: { avatarMediaId: null } });
    await prisma.mediaAsset.deleteMany({ where: { id: { in: media } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  await app?.close();
});
async function lobby(status: LobbyStatus = 'PUBLISHED', startsAt = '2200-01-01T00:00:00.000Z') {
  const id = randomUUID(); lobbies.push(id);
  await prisma.lobby.create({ data: { id, organizerId: users[0]!, title: 'Isolated members', description: 'Members fixtures',
    category: 'GAMING', timeZone: 'UTC', isOnline: true, capacity: 4, status, startsAt,
    members: { create: users.slice(0, 3).map((userId, index) => ({ userId, joinedAt, status: 'JOINED', role: index === 1 ? 'ORGANIZER' : 'MEMBER' })) },
  } });
  return id;
}
const url = (id: string) => `/api/v1/lobbies/${id}/members`;
const get = (id: string, user = 0) => request(app.getHttpServer()).get(url(id)).auth(tokens[user]!, { type: 'bearer' });
const membership = (id: string, user: number) => ({ lobbyId_userId: { lobbyId: id, userId: users[user]! } });
const cursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

test('members require Bearer, PUBLISHED and JOINED even for organizer; past events remain readable', async () => {
  const id = await lobby('PUBLISHED', '2000-01-01T00:00:00.000Z');
  await request(app.getHttpServer()).get(url(id)).expect(401);
  for (const user of [0, 1, 2]) assert.equal((await get(id, user).expect(200)).body.items.length, 3);
  assert.equal((await get(id, 3).expect(403)).body.error.code, 'LOBBY_MEMBERS_FORBIDDEN');
  for (const status of ['LEFT', 'REMOVED'] as const) {
    await prisma.lobbyMember.update({ where: membership(id, 1), data: { status } });
    assert.equal((await get(id, 1).expect(403)).body.error.code, 'LOBBY_MEMBERS_FORBIDDEN');
    assert.equal((await get(id).expect(200)).body.items.length, 2);
  }
  await prisma.lobbyMember.delete({ where: membership(id, 0) });
  await get(id).expect(403);
  for (const hidden of [randomUUID(), await lobby('DRAFT'), await lobby('CANCELLED'), await lobby('COMPLETED')]) {
    for (const viewer of [0, 3]) assert.equal((await get(hidden, viewer).expect(404)).body.error.code, 'LOBBY_NOT_FOUND');
  }
});

test('members DTO exposes only safe projection and organizerId, not membership role', async () => {
  const id = await lobby();
  const result = (await get(id).expect(200)).body;
  assert.deepEqual(Object.keys(result).sort(), ['items', 'nextCursor']);
  for (const row of result.items) {
    assert.deepEqual(Object.keys(row).sort(), ['isOrganizer', 'joinedAt', 'user']);
    assert.deepEqual(Object.keys(row.user).sort(), ['avatar', 'displayName', 'handle', 'id']);
    assert.equal(row.isOrganizer, row.user.id === users[0]);
    assert.equal(row.user.avatar, null); assert.equal(row.joinedAt, joinedAt);
    assert.equal(row.user.displayName, 'Имя <plain text>');
  }
  assert.doesNotMatch(JSON.stringify(result), /email|passwordHash|tokenHash|storageKey|bio|city|extroversion|avatarMediaId/);
});

test('members cursor sorts equal joinedAt by userId without duplicates and never replaces access/lobby filters', async () => {
  const id = await lobby(), other = await lobby();
  await prisma.lobbyMember.delete({ where: membership(other, 2) });
  const seen: string[] = []; let next: string | null = null;
  do {
    const page: { items: { user: { id: string } }[]; nextCursor: string | null } = (await get(id).query({ limit: 1, ...(next ? { after: next } : {}) }).expect(200)).body;
    seen.push(...page.items.map((row: { user: { id: string } }) => row.user.id)); next = page.nextCursor;
  } while (next);
  assert.deepEqual(seen, users.slice(0, 3).sort());
  const earlier = cursor({ joinedAt: '2000-01-01T00:00:00.000Z', userId: users[0] });
  await get(id, 3).query({ after: earlier }).expect(403);
  const cross = (await get(other).query({ after: earlier }).expect(200)).body.items;
  assert.deepEqual(cross.map((row: { user: { id: string } }) => row.user.id), users.slice(0, 2).sort());
});

test('members validate UUID, limit, unknown fields and strict cursor shapes before Prisma', async () => {
  const id = await lobby();
  for (const query of ['limit=0', 'limit=51', 'limit=-1', 'limit=1.1', 'limit=01', 'limit=x', 'limit=2&limit=3', 'limit[x]=1',
    'after=', 'after=x', 'after[x]=x', 'after=a&after=b', 'userId=x', 'role=ORGANIZER',
    ...[null, [], {}, { joinedAt, userId: 'bad' }, { joinedAt, userId: users[0], extra: true },
      { joinedAt: '+275760-09-13T00:00:00.000Z', userId: users[0] }, { joinedAt: '2026-02-30T00:00:00.000Z', userId: users[0] }].map(value => `after=${cursor(value)}`)]) {
    assert.equal((await get(id).query(query).expect(400)).body.error.code, 'VALIDATION_FAILED', query);
  }
  await get('not-uuid').expect(400);
  await get(id).query({ limit: 50 }).expect(200);
});

test('members avatars use each owner, reflect replacement, and reject non-avatar or foreign-owner records', async () => {
  const id = await lobby();
  async function avatar(owner: number, valid = true) {
    const mediaId = randomUUID(); media.push(mediaId);
    await prisma.mediaAsset.create({ data: { id: mediaId, ownerId: users[owner]!, kind: 'IMAGE', mimeType: 'image/jpeg',
      storageKey: valid ? `avatars/${mediaId}.jpg` : `demo/${mediaId}.jpg`, width: 512, height: 512, bytes: 500 } });
    return mediaId;
  }
  for (const mediaId of [await avatar(1), await avatar(1), await avatar(2), await avatar(1, false)]) {
    await prisma.user.update({ where: { id: users[1]! }, data: { avatarMediaId: mediaId } });
    const row = (await get(id).expect(200)).body.items.find((item: { user: { id: string } }) => item.user.id === users[1]);
    const record = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } });
    assert.deepEqual(row.user.avatar, record.ownerId === users[1] && record.storageKey.startsWith('avatars/')
      ? { id: mediaId, width: 512, height: 512, mimeType: 'image/jpeg' } : null);
  }
});
