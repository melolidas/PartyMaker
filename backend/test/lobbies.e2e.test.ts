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
import { LobbiesService } from '../src/lobbies/lobbies.service';
import type { CreateLobbyRequestDto } from '../src/lobbies/dto/create-lobby-request.dto';

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

test('mine uses the Bearer membership and preserves whole-group statistics and the safe DTO', async () => {
  const own = await request(app.getHttpServer()).get('/api/v1/lobbies').query({ scope: 'mine' }).auth(access, { type: 'bearer' }).expect(200);
  const dto = (own.body as LobbyPageResponseDto).items.find((item) => item.id === sorted[0]);
  assert.ok(dto);
  assert.equal(dto.joinedCount, 2);
  assert.equal(dto.groupExtroversionLevel, 1.5);
  assert.equal(dto.isJoined, true);
  assert.deepEqual(Object.keys(dto).sort(), ['id', 'title', 'description', 'category', 'startsAt', 'timeZone', 'isOnline', 'venueName', 'capacity', 'joinedCount', 'isJoined', 'membershipStatus', 'isOrganizer', 'groupExtroversionLevel'].sort());
  assert.doesNotMatch(JSON.stringify(own.body), /passwordHash|tokenHash|refreshToken|storageKey|@example\.test/);
  assert.ok(!(own.body as LobbyPageResponseDto).items.some((item) => item.id === sorted[1]), 'organizerId alone is not membership');

  const left = await request(app.getHttpServer()).get('/api/v1/lobbies').query({ scope: 'mine' }).auth(leftAccess, { type: 'bearer' }).expect(200);
  assert.deepEqual(left.body, { items: [], nextCursor: null });
  const tokens = app.get(AuthTokenService);
  const material = tokens.createRefreshToken();
  const session = await prisma.authSession.create({ data: { userId: users[3]!, tokenHash: material.hash, expiresAt: material.expiresAt } });
  const removedAccess = await tokens.signAccessToken(users[3]!, session.id);
  const removed = await request(app.getHttpServer()).get('/api/v1/lobbies').query({ scope: 'mine' }).auth(removedAccess, { type: 'bearer' }).expect(200);
  assert.deepEqual(removed.body, { items: [], nextCursor: null });
});

test('mine excludes past, draft, cancelled and completed events even with JOINED memberships', async () => {
  await prisma.lobbyMember.createMany({ data: ids.slice(3).map((lobbyId) => ({ lobbyId, userId: users[0]!, status: 'JOINED' as const })) });
  const response = await request(app.getHttpServer()).get('/api/v1/lobbies').query({ scope: 'mine', limit: 50 }).auth(access, { type: 'bearer' }).expect(200);
  const rows = (response.body as LobbyPageResponseDto).items;
  assert.ok(rows.length > 0);
  assert.ok(rows.every((item) => !ids.slice(3).some((id) => item.id === id) && Date.parse(item.startsAt) > Date.now()));
});

test('created organizer appears in mine through exactly one JOINED membership, not in another user list', async () => {
  const created = await post(createInput()).expect(201);
  const own = await request(app.getHttpServer()).get('/api/v1/lobbies').query({ scope: 'mine', limit: 50 }).auth(access, { type: 'bearer' }).expect(200);
  assert.deepEqual((own.body as LobbyPageResponseDto).items.find((item) => item.id === created.body.id), created.body);
  const foreign = await request(app.getHttpServer()).get('/api/v1/lobbies').query({ scope: 'mine' }).auth(leftAccess, { type: 'bearer' }).expect(200);
  assert.ok(!(foreign.body as LobbyPageResponseDto).items.some((item) => item.id === created.body.id));
  assert.equal(await prisma.lobbyMember.count({ where: { lobbyId: created.body.id as string, role: 'ORGANIZER', status: 'JOINED' } }), 1);
});

test('mine has stable tuple pages at equal startsAt, independently of the first all page', async () => {
  const personalIds = [randomUUID(), randomUUID(), randomUUID()].sort();
  for (const id of personalIds) await prisma.lobby.create({ data: {
    id, organizerId: users[0]!, title: 'Isolated personal pagination', description: 'Membership, not ownership',
    category: 'SPORT', startsAt: '2400-01-01T12:00:00.000Z', timeZone: 'UTC', capacity: 6,
    status: 'PUBLISHED', isOnline: true,
    members: { create: { userId: users[2]!, status: 'JOINED', role: 'MEMBER' } },
  } });
  const general = await request(app.getHttpServer()).get('/api/v1/lobbies').query({ scope: 'all', limit: 1, after: cursorBefore }).auth(leftAccess, { type: 'bearer' }).expect(200);
  assert.equal(general.body.items[0].id, sorted[0]);
  assert.equal(general.body.items[0].isJoined, false);
  const seen: string[] = [];
  let after: string | null = null;
  for (let page = 0; page < 3; page += 1) {
    const response = await request(app.getHttpServer()).get('/api/v1/lobbies')
      .query({ scope: 'mine', limit: 1, ...(after ? { after } : {}) }).auth(leftAccess, { type: 'bearer' }).expect(200);
    const result = response.body as LobbyPageResponseDto;
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.isJoined, true);
    seen.push(result.items[0]!.id);
    after = result.nextCursor;
    assert.equal(after === null, page === 2);
  }
  assert.deepEqual(seen, personalIds);
});

test('invalid scope and attempts to choose a different user or organizer are rejected', async () => {
  for (const query of [{ scope: 'invalid' }, { scope: '' }, { scope: 'MINE' }, { scope: ['all', 'mine'] },
    { scope: 'mine', userId: users[2] }, { scope: 'mine', organizerId: users[2] }]) {
    const response = await request(app.getHttpServer()).get('/api/v1/lobbies').query(query).auth(access, { type: 'bearer' }).expect(400);
    assert.equal(response.body.error.code, 'VALIDATION_FAILED');
  }
});

test('explicit all and omitted scope preserve the identical catalog contract', async () => {
  const implicit = await request(app.getHttpServer()).get('/api/v1/lobbies').query({ after: cursorBefore }).auth(access, { type: 'bearer' }).expect(200);
  const explicit = await request(app.getHttpServer()).get('/api/v1/lobbies').query({ scope: 'all', after: cursorBefore }).auth(access, { type: 'bearer' }).expect(200);
  assert.deepEqual(explicit.body, implicit.body);
});

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
    await prisma.lobby.deleteMany({ where: { OR: [{ id: { in: ids } }, { organizerId: { in: users } }] } });
    await prisma.mediaAsset.deleteMany({ where: { id: mediaId } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  await app?.close();
});

test('both Lobby endpoints and mine scope require Bearer authentication', async () => {
  for (const path of ['/api/v1/lobbies', '/api/v1/lobbies?scope=mine', `/api/v1/lobbies/${ids[0]}`]) {
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
    assert.deepEqual(Object.keys(dto).sort(), ['id', 'title', 'description', 'category', 'startsAt', 'timeZone', 'isOnline', 'venueName', 'capacity', 'joinedCount', 'isJoined', 'membershipStatus', 'isOrganizer', 'groupExtroversionLevel'].sort());
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
  assert.deepEqual(parameters.map((parameter) => parameter.name).sort(), ['after', 'limit', 'q', 'scope']);
  assert.deepEqual(parameters.find((parameter) => parameter.name === 'scope')?.schema.enum, ['all', 'mine']);
  assert.equal(parameters.find((parameter) => parameter.name === 'scope')?.schema.default, 'all');
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
  assert.ok(response.body.paths['/api/v1/lobbies'].post.security);
  assert.ok(response.body.paths['/api/v1/lobbies'].post.responses['201']);
  assert.ok(response.body.components.schemas.CreateLobbyRequestDto.required.includes('venueName'));
  assert.ok(!response.body.components.schemas.CreateLobbyRequestDto.required.includes('category'));
  for (const name of ['CreateLobbyRequestDto', 'LobbyResponseDto', 'ChatLobbyDto', 'LobbyHistoryItemDto']) {
    assert.equal(response.body.components.schemas[name].properties.category.nullable, true);
    assert.deepEqual(response.body.components.schemas[name].properties.category.enum, ['DRINKS', 'GAMING', 'FOOD', 'SPORT', 'MOVIES', 'OUTDOORS']);
  }
});

const createInput = (): CreateLobbyRequestDto => ({
  title: `Create ${randomUUID().slice(0, 12)}`, description: 'A real user description.',
  category: 'FOOD', startsAt: '2201-01-01T13:00:00.000Z', timeZone: 'Asia/Bishkek',
  capacity: 6, isOnline: false, venueName: 'Test venue',
});
const post = (input: unknown) => request(app.getHttpServer()).post('/api/v1/lobbies').auth(access, { type: 'bearer' }).send(input as object);

test('unsupported cursor years return VALIDATION_FAILED before Prisma and preserve normal tuple pages', async () => {
  const forbiddenPrisma = new LobbiesService({ lobby: { findMany: () => assert.fail('Invalid cursor reached Prisma') } } as unknown as PrismaService);
  for (const startsAt of ['+275760-09-13T00:00:00.000Z', '+010000-01-01T00:00:00.000Z', '-000001-01-01T00:00:00.000Z', '0000-01-01T00:00:00.000Z', '2030-02-30T00:00:00.000Z']) {
    const after = Buffer.from(JSON.stringify({ startsAt, id: '00000000-0000-4000-8000-000000000000' })).toString('base64url');
    const response = await request(app.getHttpServer()).get('/api/v1/lobbies').query({ after }).auth(access, { type: 'bearer' }).expect(400);
    assert.equal(response.body.error.code, 'VALIDATION_FAILED');
    await assert.rejects(forbiddenPrisma.list({ limit: 20, after, scope: 'all' }, users[0]!), { status: 400 });
  }
});

test('POST requires Bearer authentication', async () => {
  const response = await request(app.getHttpServer()).post('/api/v1/lobbies').send(createInput()).expect(401);
  assert.equal(response.body.error.code, 'INVALID_ACCESS_TOKEN');
});

test('creation trims fields, publishes a safe DTO and creates exactly one ORGANIZER/JOINED membership', async () => {
  const input = createInput();
  const response = await post({ ...input, title: `  ${input.title}  `, description: '  User text  ', venueName: '  Test venue  ' }).expect(201);
  const dto = response.body as LobbyResponseDto;
  assert.equal(dto.title, input.title); assert.equal(dto.description, 'User text'); assert.equal(dto.venueName, 'Test venue');
  assert.equal(dto.joinedCount, 1); assert.equal(dto.isJoined, true); assert.equal(dto.groupExtroversionLevel, 1);
  assert.deepEqual(Object.keys(dto).sort(), ['id', 'title', 'description', 'category', 'startsAt', 'timeZone', 'isOnline', 'venueName', 'capacity', 'joinedCount', 'isJoined', 'membershipStatus', 'isOrganizer', 'groupExtroversionLevel'].sort());
  assert.doesNotMatch(JSON.stringify(dto), /passwordHash|tokenHash|refreshToken|storageKey|@example\.test/);
  const row = await prisma.lobby.findUniqueOrThrow({ where: { id: dto.id }, include: { members: true } });
  assert.equal(row.organizerId, users[0]); assert.equal(row.status, 'PUBLISHED'); assert.equal(row.minParticipants, 2);
  assert.equal(row.members.length, 1); assert.equal(row.members[0]?.userId, users[0]);
  assert.equal(row.members[0]?.role, 'ORGANIZER'); assert.equal(row.members[0]?.status, 'JOINED');
  const details = await request(app.getHttpServer()).get(`/api/v1/lobbies/${dto.id}`).auth(access, { type: 'bearer' }).expect(200);
  assert.deepEqual(details.body, dto);
  const after = Buffer.from(JSON.stringify({ startsAt: '2201-01-01T12:59:59.999Z', id: randomUUID() })).toString('base64url');
  const catalog = await request(app.getHttpServer()).get('/api/v1/lobbies').query({ after }).auth(access, { type: 'bearer' }).expect(200);
  assert.ok((catalog.body as LobbyPageResponseDto).items.some(item => item.id === dto.id));
});

test('nested membership failure rolls back the lobby insert in PostgreSQL', async () => {
  const input = createInput(); let reachedNestedWrite = false;
  const failing = prisma.$extends({ query: { lobby: { create: async ({ args, query }) => {
    assert.ok(args.data.members?.create, 'Production create must include membership in the atomic write');
    reachedNestedWrite = true;
    // Force a real FK failure in the child write, while the organizer FK is valid.
    return query({ ...args, data: { ...args.data, members: { create: { userId: randomUUID(), role: 'ORGANIZER', status: 'JOINED' } } } });
  } } } });
  await assert.rejects(new LobbiesService(failing as unknown as PrismaService).create(input, users[0]!), { code: 'P2003' });
  assert.equal(reachedNestedWrite, true);
  assert.equal(await prisma.lobby.count({ where: { organizerId: users[0], title: input.title } }), 0);
});

test('creation rejects empty/long/non-string fields, invalid category and out-of-range integer capacity', async () => {
  for (const invalid of [
    { title: '' }, { title: '   ' }, { title: 'x'.repeat(41) }, { title: null }, { title: 5 },
    { description: '' }, { description: ' \n ' }, { description: 'x'.repeat(201) }, { description: null },
    ...['pizza', '', 'food', 1, false, [], {}].map(category => ({ category })), { capacity: 1 }, { capacity: 0 }, { capacity: -2 },
    { capacity: 2.5 }, { capacity: 2147483648 }, { capacity: '6' }, { capacity: null },
  ]) {
    const response = await post({ ...createInput(), ...invalid }).expect(400);
    assert.equal(response.body.error.code, 'VALIDATION_FAILED');
  }
  await post({ ...createInput(), title: '😀'.repeat(40), description: 'x'.repeat(200), capacity: 2147483647 }).expect(201);
});

test('creation rejects past/invalid/extended instants and non-IANA zones, accepts explicit offsets', async () => {
  for (const invalid of [
    { startsAt: '2000-01-01T00:00:00.000Z' }, { startsAt: 'tomorrow' }, { startsAt: null },
    { startsAt: '2030-02-30T00:00:00.000Z' }, { startsAt: '2030-01-01T24:00:00.000Z' },
    { startsAt: '2030-01-01T12:00:00' }, { startsAt: '2030-01-01' }, { startsAt: '+275760-09-13T00:00:00.000Z' },
    { timeZone: 'Mars/Olympus' }, { timeZone: '+06:00' }, { timeZone: '' }, { timeZone: null },
  ]) {
    const response = await post({ ...createInput(), ...invalid }).expect(400);
    assert.equal(response.body.error.code, 'VALIDATION_FAILED');
  }
  const response = await post({ ...createInput(), startsAt: '2201-01-01T19:00:00+06:00', timeZone: 'Europe/Berlin' }).expect(201);
  assert.equal(response.body.startsAt, '2201-01-01T13:00:00.000Z');
});

test('venueName is required, null online and trimmed nonempty offline; isOnline is strictly boolean', async () => {
  for (const invalid of [
    { venueName: null }, { venueName: '' }, { venueName: '  ' }, { venueName: 'x'.repeat(141) }, { venueName: 5 },
    { isOnline: 'true', venueName: null }, { isOnline: 0 }, { isOnline: null },
    { isOnline: true, venueName: 'Test venue' }, { isOnline: true, venueName: '' },
    { isOnline: true, venueName: undefined }, { venueName: undefined },
  ]) {
    const response = await post({ ...createInput(), ...invalid }).expect(400);
    assert.equal(response.body.error.code, 'VALIDATION_FAILED');
  }
  const online = await post({ ...createInput(), isOnline: true, venueName: null, capacity: 2 }).expect(201);
  assert.equal(online.body.venueName, null); assert.equal(online.body.joinedCount, 1);
});

test('clients cannot supply organizer, status, members or other internal fields', async () => {
  for (const invalid of [
    { organizerId: users[2] }, { status: 'DRAFT' }, { members: [{ userId: users[2] }] },
    { minParticipants: 4 }, { id: randomUUID() }, { joinedCount: 5 }, { media: [] }, { address: 'Not supported' },
  ]) {
    const response = await post({ ...createInput(), ...invalid }).expect(400);
    assert.equal(response.body.error.code, 'VALIDATION_FAILED');
  }
  const missing = createInput() as Partial<CreateLobbyRequestDto>;
  delete missing.title;
  await post(missing).expect(400);
});

test('creation stores omitted and explicit null categories without a default, while preserving legacy enum values', async () => {
  const legacyBefore = await prisma.lobby.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' }, select: { id: true, category: true } });
  for (const category of [undefined, null, 'DRINKS', 'GAMING', 'FOOD', 'SPORT', 'MOVIES', 'OUTDOORS'] as const) {
    const input = createInput(); delete input.category;
    const response = await post({ ...input, ...(category === undefined ? {} : { category }) }).expect(201);
    const dto = response.body as LobbyResponseDto;
    assert.equal(dto.category, category ?? null);
    const stored = await prisma.lobby.findUniqueOrThrow({ where: { id: dto.id }, include: { members: true } });
    assert.equal(stored.category, category ?? null);
    assert.equal(stored.organizerId, users[0]); assert.equal(stored.status, 'PUBLISHED');
    assert.equal(stored.members.length, 1); assert.equal(stored.members[0]!.status, 'JOINED');
    assert.equal(stored.members[0]!.role, 'ORGANIZER'); assert.equal(stored.members[0]!.userId, users[0]);
  }
  assert.deepEqual(await prisma.lobby.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' }, select: { id: true, category: true } }), legacyBefore);
});

test('uncategorized lobbies round-trip through catalog, mine, search, details, inbox, editing and own history', async () => {
  const input = createInput(); delete input.category;
  const dto = (await post({ ...input, startsAt: '9000-01-01T12:00:00.000Z' }).expect(201)).body as LobbyResponseDto;
  const get = (path: string) => request(app.getHttpServer()).get(`/api/v1/${path}`).auth(access, { type: 'bearer' });
  assert.deepEqual((await get(`lobbies/${dto.id}`).expect(200)).body, dto);
  const after = Buffer.from(JSON.stringify({ startsAt: '9000-01-01T11:59:59.999Z', id: randomUUID() })).toString('base64url');
  for (const scope of ['all', 'mine']) {
    const rows = (await get('lobbies').query({ scope, after, limit: 50 }).expect(200)).body.items as LobbyResponseDto[];
    assert.deepEqual(rows.find(row => row.id === dto.id), dto);
    const searched = (await get('lobbies').query({ scope, q: dto.title }).expect(200)).body.items as LobbyResponseDto[];
    assert.deepEqual(searched.find(row => row.id === dto.id), dto);
  }
  const inbox = (await get('chats').query({ limit: 50 }).expect(200)).body.items as { lobby: { id: string; title: string; category: string | null } }[];
  assert.deepEqual(inbox.find(row => row.lobby.id === dto.id)?.lobby, { id: dto.id, title: dto.title, category: null });
  const changed = await request(app.getHttpServer()).patch(`/api/v1/lobbies/${dto.id}`).auth(access, { type: 'bearer' }).send({ description: 'Edited without a category' }).expect(200);
  assert.equal(changed.body.category, null); assert.equal(changed.body.description, 'Edited without a category');
  const beforeRejected = await prisma.lobby.findUniqueOrThrow({ where: { id: dto.id } });
  const rejected = await request(app.getHttpServer()).patch(`/api/v1/lobbies/${dto.id}`).auth(access, { type: 'bearer' }).send({ category: null }).expect(400);
  assert.equal(rejected.body.error.code, 'VALIDATION_FAILED');
  assert.deepEqual(await prisma.lobby.findUniqueOrThrow({ where: { id: dto.id } }), beforeRejected);
  // Change only this returned fixture's schedule/status to exercise existing history policy.
  await prisma.lobby.update({ where: { id: dto.id }, data: { startsAt: '2001-01-01T12:00:00.000Z', status: 'COMPLETED' } });
  const history = (await get('users/me/lobby-history').expect(200)).body.items as { id: string; category: string | null }[];
  const historical = history.find(row => row.id === dto.id);
  assert.ok(historical); assert.equal(historical.category, null);
  assert.deepEqual(Object.keys(historical).sort(), ['category', 'description', 'id', 'isOnline', 'isOrganizer', 'startsAt', 'timeZone', 'title', 'venueName']);
  for (const suffix of ['', '/messages', '/members']) await get(`lobbies/${dto.id}${suffix}`).expect(404);
});
