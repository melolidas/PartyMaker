import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { before, after, afterEach, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { LobbyMemberStatus, LobbyStatus, Prisma } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthTokenService } from '../src/auth/auth-token.service';
import { configureApp, configureSwagger } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { LobbiesService } from '../src/lobbies/lobbies.service';
import { interestWords, jaccard, recommendedIds } from '../src/lobbies/lobby-recommendations';
import type { LobbyResponseDto } from '../src/lobbies/dto/lobby-response.dto';

let app: INestApplication, prisma: PrismaService;
const users = Array.from({ length: 4 }, () => randomUUID()), tokens: string[] = [], ids: string[] = [];
const url = '/api/v1/lobbies/recommendations';
const now = new Date('2000-01-01T00:00:00.000Z'), realNow = Date.now;
const word = () => `lex${randomUUID().replaceAll('-', '')}`;
const get = (who = 0) => request(app.getHttpServer()).get(url).auth(tokens[who]!, { type: 'bearer' });
const recommendations = async (who = 0): Promise<LobbyResponseDto[]> => (await get(who).expect(200)).body.items as LobbyResponseDto[];
before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication(); configureApp(app); configureSwagger(app); await app.init();
  prisma = app.get(PrismaService);
  for (const id of users) {
    await prisma.user.create({ data: { id, email: `recommend_${id}@example.test`, handle: `r_${id.replaceAll('-', '').slice(0, 24)}`,
      displayName: 'Isolated recommendations user', passwordHash: 'not-a-login-hash', extroversionScoreX2: 12 } });
    const auth = app.get(AuthTokenService), refresh = auth.createRefreshToken();
    const session = await prisma.authSession.create({ data: { userId: id, tokenHash: refresh.hash, expiresAt: refresh.expiresAt } });
    tokens.push(await auth.signAccessToken(id, session.id));
  }
});
afterEach(async () => { Date.now = realNow; await prisma?.lobby.deleteMany({ where: { id: { in: ids } } }); ids.length = 0; });
after(async () => { await prisma?.user.deleteMany({ where: { id: { in: users } } }); await app?.close(); });
async function lobby(title: string, options: { status?: LobbyStatus; startsAt?: Date; organizer?: number; description?: string; id?: string } = {}) {
  Date.now = () => now.getTime(); // Fixed server clock; only isolated fixtures precede existing real events.
  const id = options.id ?? randomUUID(); ids.push(id);
  await prisma.lobby.create({ data: { id, title, description: options.description ?? title,
    startsAt: options.startsAt ?? new Date('2001-01-01T00:00:00.000Z'), status: options.status ?? 'PUBLISHED',
    organizerId: users[options.organizer ?? 2]!, timeZone: 'Asia/Bishkek', capacity: 2, isOnline: true,
    members: { create: { userId: users[options.organizer ?? 2]!, role: 'ORGANIZER', status: 'JOINED' } },
  } });
  return id;
}
async function member(id: string, who = 0, status: LobbyMemberStatus = 'JOINED', joinedAt = now) {
  await prisma.lobbyMember.create({ data: { lobbyId: id, userId: users[who]!, status, joinedAt } });
}
async function source(title: string, who = 0) {
  const id = await lobby(title, { startsAt: new Date('1999-01-01T00:00:00.000Z') }); await member(id, who); return id;
}

test('recommendations require Bearer, reject every query/body override, expose only safe nullable-category DTO', async () => {
  await request(app.getHttpServer()).get(url).expect(401);
  for (const query of ['userId=x', 'scope=mine', 'limit=5', 'after=x', 'q=x', 'q[]=x', 'q[x]=y']) {
    assert.equal((await get().query(query).expect(400)).body.error.code, 'VALIDATION_FAILED');
  }
  for (const body of [{ userId: users[1] }, { limit: 1 }, []]) assert.equal((await get().send(body).expect(400)).body.error.code, 'VALIDATION_FAILED');
  const text = word(); await source(text); const id = await lobby(text);
  const rows = await recommendations(); assert.deepEqual(rows.map(row => row.id), [id]);
  assert.deepEqual(Object.keys(rows[0]!).sort(), ['id', 'title', 'description', 'category', 'startsAt', 'timeZone', 'isOnline', 'venueName',
    'capacity', 'joinedCount', 'isJoined', 'membershipStatus', 'isOrganizer', 'groupExtroversionLevel'].sort());
  assert.equal(rows[0]!.category, null); assert.equal(rows[0]!.joinedCount, 1); assert.equal(rows[0]!.groupExtroversionLevel, 6);
  assert.equal(rows[0]!.membershipStatus, null); assert.equal(rows[0]!.isOrganizer, false);
  const docs = (await request(app.getHttpServer()).get('/docs-json').expect(200)).body;
  assert.ok(docs.paths[url].get.security); assert.ok(docs.paths[url].get.responses['400']);
  assert.equal(docs.components.schemas.LobbyRecommendationsResponseDto.properties.items.maxItems, 5);
});

test('choices personalize each account; cold start, stopwords and unrelated candidates return no invented results', async () => {
  const a = word(), b = word(); await source(a); await source(b, 1);
  const ca = await lobby(a), cb = await lobby(b); await lobby(word());
  assert.deepEqual((await recommendations()).map(row => row.id), [ca]);
  assert.deepEqual((await recommendations(1)).map(row => row.id), [cb]);
  assert.deepEqual(await recommendations(3), []);
  await source('И это THE and', 3); assert.deepEqual(await recommendations(3), []);
});

test('sources filter statuses, completed start boundary, membership and canonical organizer before the latest 50', async () => {
  const allowed: string[] = [];
  for (const status of ['PUBLISHED', 'COMPLETED', 'DRAFT', 'CANCELLED'] as const) {
    for (const startsAt of [new Date(now.getTime() - 1), now, new Date(now.getTime() + 1)]) {
      const text = word(), id = await lobby(text, { status, startsAt }); await member(id);
      const candidate = await lobby(text);
      if (status === 'PUBLISHED' || (status === 'COMPLETED' && startsAt <= now)) allowed.push(candidate);
    }
  }
  for (const status of ['LEFT', 'REMOVED', null] as const) {
    const text = word(), id = await lobby(text, { startsAt: now }); if (status) await member(id, 0, status);
    await lobby(text);
  }
  const own = word(); await lobby(own, { organizer: 0, startsAt: now }); await lobby(own);
  assert.deepEqual((await recommendations()).map(row => row.id).sort(), allowed.sort());
});

test('latest 50 choices order by joinedAt then lobbyId, not event time; excluded newer rows do not consume the limit', async () => {
  const obsolete = word(), recent = word();
  const first = await lobby(obsolete, { id: '00000000-0000-4000-8000-000000000001', startsAt: now }); await member(first);
  for (let i = 0; i < 50; i++) { const id = await lobby(recent, { startsAt: now }); await member(id); }
  const excluded = await lobby(obsolete, { status: 'CANCELLED', startsAt: now }); await member(excluded, 0, 'JOINED', new Date(now.getTime() + 1));
  const candidate = await lobby(recent); await lobby(obsolete);
  assert.deepEqual((await recommendations()).map(row => row.id), [candidate]);
  // A truly newer joinedAt beats the lobbyId tie-break, even for an older event.
  await prisma.lobbyMember.update({ where: { lobbyId_userId: { lobbyId: first, userId: users[0]! } }, data: { joinedAt: new Date(now.getTime() + 2) } });
  assert.equal((await recommendations()).length, 2);
});

test('candidate eligibility excludes own/any membership, past/equal/nonpublished and full groups, counting all JOINED only', async () => {
  const text = word(); await source(text);
  for (const status of ['JOINED', 'LEFT', 'REMOVED'] as const) { const id = await lobby(text); await member(id, 0, status); }
  await lobby(text, { organizer: 0 });
  for (const status of ['DRAFT', 'CANCELLED', 'COMPLETED'] as const) await lobby(text, { status });
  await lobby(text, { startsAt: now }); await lobby(text, { startsAt: new Date(now.getTime() - 1) });
  const full = await lobby(text); await member(full, 1);
  const free = await lobby(text); await member(free, 1, 'LEFT'); await member(free, 3, 'REMOVED');
  const rows = await recommendations(); assert.deepEqual(rows.map(row => row.id), [free]); assert.equal(rows[0]!.joinedCount, 1);
});

test('full candidates are filtered BEFORE the nearest 200 limit; candidate bound and stable score/time/id ordering', async () => {
  const text = word(); await source(text);
  const fullIds = Array.from({ length: 201 }, () => randomUUID()); ids.push(...fullIds);
  await prisma.lobby.createMany({ data: fullIds.map(id => ({ id, organizerId: users[2]!, title: text, description: text, startsAt: new Date('2000-02-01'), capacity: 2 })) });
  await prisma.lobbyMember.createMany({ data: fullIds.flatMap(lobbyId => [2, 3].map(who => ({ lobbyId, userId: users[who]!, status: 'JOINED' as const }))) });
  const free = await lobby(text); assert.deepEqual((await recommendations()).map(row => row.id), [free]);
  const equal: string[] = [free]; for (let i = 0; i < 6; i++) equal.push(await lobby(text));
  assert.deepEqual((await recommendations()).map(row => row.id), equal.sort().slice(0, 5));
  const lower = await lobby(text, { description: 'extra', startsAt: new Date('2000-03-01') });
  assert.equal((await recommendations()).some(row => row.id === lower), false, 'score takes priority over start');
  // 200 eligible nearer nonmatches consume the bounded sample; there is no random fallback.
  const nearest = Array.from({ length: 200 }, () => randomUUID()); ids.push(...nearest);
  await prisma.lobby.createMany({ data: nearest.map(id => ({ id, organizerId: users[2]!, title: word(), description: 'the and', startsAt: new Date('2000-02-02'), capacity: 2 })) });
  assert.deepEqual(await recommendations(), []);
});

test('lexical normalization uses sets, NFKC, RU/EN, ё and stopwords; max Jaccard not combined interests', () => {
  assert.deepEqual([...interestWords('Ёлка ЕЛКА е\u0308лка и THE ＣＨＥＳＳ chess')], ['елка', 'chess']);
  assert.equal(jaccard(interestWords(''), interestWords('chess')), 0);
  assert.equal(jaccard(interestWords('шахматы CHESS chess'), interestWords('Chess шахматы')), 1);
  assert.equal(jaccard(interestWords('шахматы'), interestWords('chess')), 0);
  const candidate = (id: string, title: string) => ({ id, title, description: '', startsAt: now });
  assert.deepEqual(recommendedIds([{ title: 'chess', description: '' }, { title: 'hiking', description: '' }],
    [candidate('b', 'chess hiking'), candidate('a', 'chess chess chess'), candidate('c', '')]), ['a', 'b']);
});

test('legacy category never affects similarity; join/leave/cancel/edit changes next recommendations without changing ordinary catalog/history', async () => {
  const text = word(), seedChoice = await source(text), id = await lobby(text, { startsAt: new Date('2200-01-01') });
  const original = await recommendations();
  await prisma.lobby.update({ where: { id: seedChoice }, data: { category: 'SPORT' } });
  await prisma.lobby.update({ where: { id }, data: { category: 'FOOD' } });
  assert.deepEqual((await recommendations()).map(row => row.id), original.map(row => row.id));
  const action = (method: 'post' | 'patch', suffix: string, who = 0, body = {}) => request(app.getHttpServer())[method](`/api/v1/lobbies/${id}${suffix}`).auth(tokens[who]!, { type: 'bearer' }).send(body);
  await action('post', '/join').expect(200); assert.deepEqual(await recommendations(), []);
  await action('post', '/leave').expect(200); assert.deepEqual(await recommendations(), []);
  await action('post', '/join').expect(200); // ordinary LEFT rejoin remains permitted
  const editable = await lobby(text);
  await request(app.getHttpServer()).patch(`/api/v1/lobbies/${editable}`).auth(tokens[2]!, { type: 'bearer' }).send({ title: word(), description: word() }).expect(200);
  assert.deepEqual(await recommendations(), []);
  const cancellable = await lobby(text);
  assert.deepEqual((await recommendations()).map(row => row.id), [cancellable]);
  await request(app.getHttpServer()).post(`/api/v1/lobbies/${cancellable}/cancel`).auth(tokens[2]!, { type: 'bearer' }).expect(200);
  assert.deepEqual(await recommendations(), []);
});

test('source, candidate eligibility and safe projection share one RepeatableRead snapshot across concurrent edits', async () => {
  const text = word(), choice = await source(text), candidate = await lobby(text);
  const proxy = new Proxy(prisma, { get(target, key) {
    if (key !== '$transaction') return Reflect.get(target, key);
    return (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: string }) => {
      assert.equal(options.isolationLevel, 'RepeatableRead');
      return prisma.$transaction(async tx => run(new Proxy(tx, { get(inner, property) {
        if (property === 'lobbyMember') return new Proxy(inner.lobbyMember, { get(model, method) {
          if (method !== 'findMany') return Reflect.get(model, method);
          return async (args: Prisma.LobbyMemberFindManyArgs) => {
            const result = await inner.lobbyMember.findMany(args);
            await prisma.lobby.update({ where: { id: choice }, data: { status: 'CANCELLED' } });
            await prisma.lobby.update({ where: { id: candidate }, data: { title: word(), status: 'CANCELLED' } });
            return result;
          };
        } });
        return Reflect.get(inner, property);
      } })), { isolationLevel: 'RepeatableRead' });
    };
  } });
  const result = await new LobbiesService(proxy).recommendations(users[0]!);
  assert.deepEqual(result.items.map(row => row.id), [candidate]); assert.equal(result.items[0]!.title, text);
  assert.deepEqual(await recommendations(), []);
});
