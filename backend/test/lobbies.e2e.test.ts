import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AuthTokenService } from '../src/auth/auth-token.service';
import { configureApp, configureSwagger } from '../src/bootstrap';
import type { LobbyPageResponseDto, LobbyResponseDto } from '../src/lobbies/dto/lobby-response.dto';
import { PrismaService } from '../src/prisma/prisma.service';

let app: INestApplication;
let prisma: PrismaService;
let access: string;
let leftAccess: string;
const users = Array.from({ length: 4 }, () => randomUUID());
const ids = Array.from({ length: 7 }, () => randomUUID());
const sorted = ids.slice(0, 3).sort();
const start = '2200-01-01T10:00:00.000Z';
const later = '2200-01-01T11:00:00.000Z';
const cursorBefore = Buffer.from(JSON.stringify({ startsAt: '2200-01-01T09:59:59.999Z', id: randomUUID() })).toString('base64url');
const mediaId = randomUUID();

before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication();
  configureApp(app);
  configureSwagger(app);
  await app.init();
  prisma = app.get(PrismaService);
  await prisma.user.createMany({ data: users.map((id, index) => ({
    id, email: `lobby_${id}@example.test`, handle: `lb_${id.replaceAll('-', '').slice(0, 24)}`,
    passwordHash: 'isolated-lobby-test-not-a-login-password', displayName: 'Lobby fixture',
    extroversionScoreX2: [2, 3, 20, 20][index]!,
  })) });
  for (const [index, id] of ids.entries()) {
    await prisma.lobby.create({ data: {
      id, organizerId: users[0]!, title: `User title ${index}`, description: 'User-authored description, not a translation key.',
      category: index === 1 ? 'GAMING' : 'FOOD', isOnline: index === 1,
      venueName: index === 1 ? null : 'Test venue', capacity: 8,
      status: index === 4 ? 'DRAFT' : index === 5 ? 'CANCELLED' : index === 6 ? 'COMPLETED' : 'PUBLISHED',
      startsAt: index === 3 ? '2000-01-01T00:00:00.000Z' : id === sorted[2] ? later : start,
      timeZone: 'Asia/Bishkek',
    } });
  }
  await prisma.lobbyMember.createMany({ data: users.map((userId, index) => ({
    userId, lobbyId: sorted[0]!, status: index === 2 ? 'LEFT' : index === 3 ? 'REMOVED' : 'JOINED',
    role: index === 0 ? 'ORGANIZER' : 'MEMBER',
  })) });
  await prisma.mediaAsset.create({ data: { id: mediaId, ownerId: users[0]!, storageKey: `private/${mediaId}`, mimeType: 'image/jpeg', bytes: 1 } });
  await prisma.lobbyMedia.create({ data: { lobbyId: sorted[0]!, mediaId, position: 0 } });
  const tokens = app.get(AuthTokenService);
  for (const userId of [users[0]!, users[2]!]) {
    const material = tokens.createRefreshToken();
    const session = await prisma.authSession.create({ data: { userId, tokenHash: material.hash, expiresAt: material.expiresAt } });
    const jwt = await tokens.signAccessToken(userId, session.id);
    if (userId === users[0]) access = jwt; else leftAccess = jwt;
  }
});

after(async () => {
  if (prisma) {
    // Only this run's freshly-created ids; no reseeding or changes to existing data.
    await prisma.lobby.deleteMany({ where: { id: { in: ids } } });
    await prisma.mediaAsset.deleteMany({ where: { id: mediaId } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  await app?.close();
});

test('both Lobby endpoints require Bearer authentication', async () => {
  for (const path of ['/api/v1/lobbies', `/api/v1/lobbies/${ids[0]}`]) {
    const response = await request(app.getHttpServer()).get(path).expect(401);
    assert.equal(response.body.error.code, 'INVALID_ACCESS_TOKEN');
    await request(app.getHttpServer()).get(path).auth('invalid', { type: 'bearer' }).expect(401);
  }
});

test('catalog only returns future PUBLISHED events, with stable tuple pagination', async () => {
  const first = await request(app.getHttpServer()).get('/api/v1/lobbies')
    .query({ limit: 1, after: cursorBefore }).auth(access, { type: 'bearer' }).expect(200);
  const page1 = first.body as LobbyPageResponseDto;
  assert.deepEqual(page1.items.map((item) => item.id), [sorted[0]]);
  assert.ok(page1.nextCursor);
  const second = await request(app.getHttpServer()).get('/api/v1/lobbies')
    .query({ limit: 1, after: page1.nextCursor }).auth(access, { type: 'bearer' }).expect(200);
  const page2 = second.body as LobbyPageResponseDto;
  assert.deepEqual(page2.items.map((item) => item.id), [sorted[1]]);
  assert.ok(page2.nextCursor);
  const third = await request(app.getHttpServer()).get('/api/v1/lobbies')
    .query({ limit: 1, after: page2.nextCursor }).auth(access, { type: 'bearer' }).expect(200);
  assert.equal((third.body as LobbyPageResponseDto).items[0]?.id, sorted[2]);
  const catalog = await request(app.getHttpServer()).get('/api/v1/lobbies')
    .query({ limit: 50, after: cursorBefore }).auth(access, { type: 'bearer' }).expect(200);
  const fixtureRows = (catalog.body as LobbyPageResponseDto).items.filter((item) => ids.some((id) => id === item.id));
  assert.deepEqual(fixtureRows.map((item) => item.id), sorted);
  const normal = await request(app.getHttpServer()).get('/api/v1/lobbies').auth(access, { type: 'bearer' }).expect(200);
  assert.ok((normal.body as LobbyPageResponseDto).items.every((item) => Date.parse(item.startsAt) > Date.now()));
  assert.ok((normal.body as LobbyPageResponseDto).items.length <= 20);
});

test('unpublished and missing details share 404; a past published lobby remains viewable', async () => {
  for (const id of [...ids.slice(4), randomUUID()]) {
    const response = await request(app.getHttpServer()).get(`/api/v1/lobbies/${id}`).auth(access, { type: 'bearer' }).expect(404);
    assert.equal(response.body.error.code, 'LOBBY_NOT_FOUND');
  }
  await request(app.getHttpServer()).get(`/api/v1/lobbies/${ids[3]}`).auth(access, { type: 'bearer' }).expect(200);
});

test('only JOINED members count and contribute to group mean; LEFT/REMOVED do not', async () => {
  const response = await request(app.getHttpServer()).get(`/api/v1/lobbies/${sorted[0]}`).auth(access, { type: 'bearer' }).expect(200);
  const lobby = response.body as LobbyResponseDto;
  assert.equal(lobby.joinedCount, 2);
  assert.equal(lobby.isJoined, true);
  assert.equal(lobby.groupExtroversionLevel, 1.5, 'Mean 1.25 rounds to 1.5; inactive scores ignored');
  const left = await request(app.getHttpServer()).get(`/api/v1/lobbies/${sorted[0]}`).auth(leftAccess, { type: 'bearer' }).expect(200);
  assert.equal(left.body.isJoined, false);
  assert.equal(left.body.joinedCount, 2);
  const empty = await request(app.getHttpServer()).get(`/api/v1/lobbies/${sorted[1]}`).auth(access, { type: 'bearer' }).expect(200);
  assert.equal(empty.body.groupExtroversionLevel, null);
  assert.equal(empty.body.joinedCount, 0);
  assert.equal(empty.body.isJoined, false);
});

test('details and catalog use an explicit safe DTO without members, media storage or credentials', async () => {
  const response = await request(app.getHttpServer()).get(`/api/v1/lobbies/${sorted[0]}`).auth(access, { type: 'bearer' }).expect(200);
  const list = await request(app.getHttpServer()).get('/api/v1/lobbies').query({ after: cursorBefore }).auth(access, { type: 'bearer' }).expect(200);
  for (const dto of [response.body, ...(list.body as LobbyPageResponseDto).items]) {
    assert.deepEqual(Object.keys(dto).sort(), ['id', 'title', 'description', 'category', 'startsAt', 'timeZone', 'isOnline', 'venueName', 'capacity', 'joinedCount', 'isJoined', 'groupExtroversionLevel'].sort());
    assert.doesNotMatch(JSON.stringify(dto), /passwordHash|tokenHash|refreshToken|storageKey|@example\.test/);
  }
  assert.equal(response.body.timeZone, 'Asia/Bishkek');
  assert.match(response.body.description, /User-authored/);
  const online = await request(app.getHttpServer()).get(`/api/v1/lobbies/${ids[1]}`).auth(access, { type: 'bearer' }).expect(200);
  assert.equal(online.body.isOnline, true);
  assert.equal(online.body.venueName, null);
});

test('pagination is bounded and validated; unknown query fields are rejected', async () => {
  for (const query of [
    { limit: 0 }, { limit: 51 }, { limit: -1 }, { limit: '1.5' }, { limit: 'no' },
    { limit: '' }, { limit: '1e1' }, { limit: [1, 2] }, { after: 'bad' }, { after: '' },
    { after: 'x'.repeat(257) }, { status: 'DRAFT' },
    { after: Buffer.from(JSON.stringify({ id: ids[0], startsAt: 'not-a-date' })).toString('base64url') },
  ]) {
    const response = await request(app.getHttpServer()).get('/api/v1/lobbies').query(query).auth(access, { type: 'bearer' }).expect(400);
    assert.equal(response.body.error.code, 'VALIDATION_FAILED');
  }
});

test('Swagger documents safe Lobby DTOs, pagination and Bearer protection', async () => {
  const response = await request(app.getHttpServer()).get('/docs-json').expect(200);
  assert.ok(response.body.paths['/api/v1/lobbies'].get.security);
  const parameters = response.body.paths['/api/v1/lobbies'].get.parameters as {
    name: string; in: string; required: boolean; schema: Record<string, unknown>;
  }[];
  assert.deepEqual(parameters.map((parameter) => parameter.name).sort(), ['after', 'limit']);
  const limit = parameters.find((parameter) => parameter.name === 'limit')!;
  assert.equal(limit.in, 'query');
  assert.equal(limit.required, false);
  assert.equal(limit.schema.type, 'integer');
  assert.equal(limit.schema.minimum, 1);
  assert.equal(limit.schema.maximum, 50);
  assert.equal(limit.schema.default, 20);
  assert.equal(parameters.find((parameter) => parameter.name === 'after')?.schema.type, 'string');
  assert.ok(response.body.paths['/api/v1/lobbies/{id}'].get.responses['404']);
  assert.ok(response.body.components.schemas.LobbyPageResponseDto);
});
