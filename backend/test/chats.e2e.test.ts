import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { LobbyStatus, LobbyMemberStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthTokenService } from '../src/auth/auth-token.service';
import { configureApp, configureSwagger } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import type { ChatPageDto } from '../src/chats/chat.dto';

let app: INestApplication, prisma: PrismaService;
const users = [randomUUID(), randomUUID(), randomUUID()], tokens: string[] = [], fixtures: string[] = [];
const stamp = '2026-01-01T00:00:00.000Z';
before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication(); configureApp(app); configureSwagger(app); await app.init(); await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService);
  for (const id of users) {
    await prisma.user.create({ data: { id, email: `inbox_${id}@example.test`, handle: `ib_${id.replaceAll('-', '').slice(0, 24)}`, displayName: 'Inbox author', passwordHash: 'fixture-only' } });
    const service = app.get(AuthTokenService), material = service.createRefreshToken();
    const session = await prisma.authSession.create({ data: { userId: id, tokenHash: material.hash, expiresAt: material.expiresAt } });
    tokens.push(await service.signAccessToken(id, session.id));
  }
});
after(async () => {
  if (prisma) { await prisma.lobby.deleteMany({ where: { id: { in: fixtures } } }); await prisma.user.deleteMany({ where: { id: { in: users } } }); }
  await app?.close();
});
async function lobby(member: LobbyMemberStatus | null = 'JOINED', status: LobbyStatus = 'PUBLISHED', past = false, createdAt = stamp) {
  const id = randomUUID(); fixtures.push(id);
  await prisma.lobby.create({ data: { id, organizerId: users[0]!, title: 'Inbox fixture', description: 'Isolated', category: 'GAMING',
    isOnline: true, capacity: 4, startsAt: past ? '2000-01-01T00:00:00.000Z' : '2200-01-01T00:00:00.000Z', timeZone: 'UTC', status, createdAt,
    members: { create: [{ userId: users[0]!, role: 'ORGANIZER', status: 'JOINED' }, ...(member ? [{ userId: users[1]!, status: member }] : [])] },
  } }); return id;
}
const get = (user = 1) => request(app.getHttpServer()).get('/api/v1/chats').auth(tokens[user]!, { type: 'bearer' });
const body = async (user = 1, query: object = {}): Promise<ChatPageDto> => (await get(user).query(query).expect(200)).body as ChatPageDto;
const msg = (id: string, text = 'text', createdAt = stamp, deletedAt: Date | null = null, messageId = randomUUID()) =>
  prisma.lobbyMessage.create({ data: { id: messageId, lobbyId: id, authorId: users[0]!, body: text, createdAt, deletedAt } });

test('inbox requires Bearer; only own JOINED PUBLISHED, including past, never organizerId alone', async () => {
  await request(app.getHttpServer()).get('/api/v1/chats').expect(401);
  const visible = [await lobby(), await lobby('JOINED','PUBLISHED',true)];
  const hidden = [await lobby(null),await lobby('LEFT'),await lobby('REMOVED'),await lobby('JOINED','DRAFT'),await lobby('JOINED','COMPLETED'),await lobby('JOINED','CANCELLED')];
  const rows = (await body()).items.map(row => row.lobby.id);
  assert.deepEqual(rows.sort(), visible.sort()); assert.ok(hidden.every(id => !rows.includes(id)));
  assert.deepEqual(await body(2), { items: [], nextCursor: null });
  await prisma.lobbyMember.delete({ where: { lobbyId_userId: { lobbyId: visible[0]!, userId: users[0]! } } });
  assert.ok(!(await body(0)).items.some(row => row.lobby.id === visible[0]));
  const mine = (await request(app.getHttpServer()).get('/api/v1/lobbies?scope=mine').auth(tokens[1]!, { type: 'bearer' }).expect(200)).body;
  assert.equal(mine.items.length, 1); // existing upcoming-only contract is unchanged
});
test('empty chat uses Lobby.createdAt; deleted-only history also has null lastMessage', async () => {
  const id = await lobby(); await msg(id,'deleted','2030-01-01T00:00:00.000Z',new Date());
  const chat = (await body()).items.find(row => row.lobby.id === id)!;
  assert.equal(chat.lastMessage, null); assert.equal(chat.activityAt, stamp);
  assert.deepEqual(Object.keys(chat.lobby).sort(), ['id','title','category'].sort());
});
test('latest nondeleted message uses createdAt/id DESC and returns a bounded plain Unicode preview only', async () => {
  const id = await lobby(), ids = [randomUUID(),randomUUID()].sort();
  const text = '🎉'.repeat(159) + 'Я' + '<script>not markup</script>';
  await msg(id,'older',stamp,null,ids[0]); await msg(id,text,stamp,null,ids[1]);
  await msg(id,'deleted latest','2031-01-01T00:00:00.000Z',new Date());
  const chat = (await body()).items.find(row => row.lobby.id === id)!;
  assert.equal(chat.lastMessage?.id, ids[1]); assert.equal(chat.lastMessage?.preview, '🎉'.repeat(159)+'Я');
  assert.equal(Array.from(chat.lastMessage!.preview).length, 160); assert.equal(chat.activityAt, stamp);
  assert.deepEqual(Object.keys(chat).sort(), ['lobby','lastMessage','activityAt'].sort());
  assert.deepEqual(Object.keys(chat.lastMessage!).sort(), ['id','preview','createdAt','author'].sort());
  assert.deepEqual(Object.keys(chat.lastMessage!.author).sort(), ['id','displayName'].sort());
  assert.doesNotMatch(JSON.stringify(chat), /passwordHash|tokenHash|email|refreshToken|storageKey|handle|unread|body/);
  const short = await lobby(); await msg(short,'<b>plain</b>');
  assert.equal((await body()).items.find(row=>row.lobby.id===short)?.lastMessage?.preview,'<b>plain</b>');
});
test('access/last-message ordering precedes page limit and stable equal-time cursor pages do not duplicate', async () => {
  // Foreign high-activity rows must not consume the first page.
  for (let i=0;i<5;i++) await msg(await lobby(null),'hidden','2099-01-01T00:00:00.000Z');
  for (let i=0;i<6;i++) await msg(await lobby(),'visible','2040-01-01T00:00:00.000Z');
  const all = (await body(1,{limit:50})).items;
  const seen: string[]=[]; let after: string|null=null;
  do {
    const result: ChatPageDto=await body(1,{limit:2,...(after?{after}:{})});
    seen.push(...result.items.map(row=>row.lobby.id)); after=result.nextCursor;
  } while(after);
  assert.deepEqual(seen,all.map(row=>row.lobby.id)); assert.equal(new Set(seen).size,seen.length);
  const sorted=[...all].sort((a,b)=>b.activityAt.localeCompare(a.activityAt)||b.lobby.id.localeCompare(a.lobby.id));
  assert.deepEqual(all,sorted); assert.equal(all[0]!.activityAt,'2040-01-01T00:00:00.000Z');
  const cursor = Buffer.from(JSON.stringify({activityAt:'9999-01-01T00:00:00.000Z',lobbyId:randomUUID()})).toString('base64url');
  assert.deepEqual(await body(2,{after:cursor}), {items:[],nextCursor:null});
});
test('inbox validates limit, cursor, unknown fields, arrays and extended ISO years', async () => {
  const cursor=(activityAt: string)=>Buffer.from(JSON.stringify({activityAt,lobbyId:randomUUID()})).toString('base64url');
  for(const query of ['limit=0','limit=51','limit=1.2','limit=a','limit=2&limit=3','limit[x]=2','after=','after=bad','after[x]=x',
    'scope=mine','userId=x','organizerId=x',`after=${cursor('+275760-09-13T00:00:00.000Z')}`,`after=${cursor('2026-02-30T00:00:00.000Z')}`]) {
    assert.equal((await get().query(query).expect(400)).body.error.code,'VALIDATION_FAILED');
  }
  await get().query({limit:1}).expect(200); await get().query({limit:50}).expect(200);
});
test('sending updates computed activityAt/order; leaving removes chat without changing other users', async () => {
  const id=await lobby('JOINED','PUBLISHED',false,'2000-01-01T00:00:00.000Z');
  const clientMessageId=randomUUID();
  const sent=(await request(app.getHttpServer()).post(`/api/v1/lobbies/${id}/messages`).auth(tokens[1]!,{type:'bearer'}).send({clientMessageId,body:'new inbox preview'}).expect(201)).body;
  const chat=(await body()).items.find(row=>row.lobby.id===id)!;
  assert.equal(chat.activityAt,sent.createdAt); assert.equal(chat.lastMessage?.id,clientMessageId);
  assert.equal(chat.lastMessage?.author.id,users[1]);
  const rows=(await body()).items;
  assert.ok(rows.findIndex(row=>row.lobby.id===id) < rows.findIndex(row=>row.activityAt===stamp));
  await request(app.getHttpServer()).post(`/api/v1/lobbies/${id}/leave`).auth(tokens[1]!,{type:'bearer'}).expect(200);
  assert.ok(!(await body()).items.some(row=>row.lobby.id===id));
  assert.ok((await body(0,{limit:50})).items.some(row=>row.lobby.id===id));
});
test('Swagger documents inbox DTO, pagination, Bearer and non-frozen pages',async()=>{
  const docs=(await request(app.getHttpServer()).get('/docs-json').expect(200)).body;
  const route=docs.paths['/api/v1/chats'].get;
  assert.ok(route.security); for(const status of ['200','400','401']) assert.ok(route.responses[status]);
  assert.match(route.description,/not a frozen snapshot/);
  assert.ok(route.parameters.some((p:{name:string})=>p.name==='after'));
  assert.equal(docs.components.schemas.ChatLastMessageDto.properties.preview.maxLength,160);
});
