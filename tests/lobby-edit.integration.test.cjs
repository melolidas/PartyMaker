// Real frontend store + ApiClient over HTTP to the normal Nest application and
// the existing database from backend/.env. Only this test's responses are dropped.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes, randomUUID } = require('node:crypto');
const path = require('node:path');
const { ApiClient } = require('../.expo/lobby-tests/api/client.js');
const { EditLobbyFormStore } = require('../.expo/lobby-tests/features/home/editLobbyForm.js');
const { getLobbyInvalidation } = require('../.expo/lobby-tests/api/lobbyInvalidation.js');

process.chdir(path.join(__dirname, '../backend'));
require('../backend/node_modules/reflect-metadata');
const { Test } = require('../backend/node_modules/@nestjs/testing');
const { AppModule } = require('../backend/dist/app.module.js');
const { configureApp } = require('../backend/dist/bootstrap.js');
const { PrismaService } = require('../backend/dist/prisma/prisma.service.js');

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function waitForRead(store) {
  if (!store.getSnapshot().checking) return Promise.resolve();
  return new Promise(resolve => {
    const unsubscribe = store.subscribe(() => { if (!store.getSnapshot().checking) { unsubscribe(); resolve(); } });
  });
}
function clientAt(baseUrl, fetchImpl = fetch) {
  // Web's session is memory-only. No credentials or DB configuration are logged.
  let token = null;
  return new ApiClient({ baseUrl: () => baseUrl, fetchImpl,
    refreshTokenStorage: { async get() { return token; }, async set(value) { token = value; }, async clear() { token = null; } } });
}

test('real committed PATCH with lost response: edited retry restores original intent and preserves unrelated data', { timeout: 45000 }, async () => {
  let app, prisma; const users = [], lobbies = [];
  try {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    const [identity] = await prisma.$queryRaw`SELECT current_database() AS database, inet_server_port() AS port,
      current_setting('data_directory') AS directory`;
    assert.ok(identity.database && identity.port && identity.directory);
    console.log('Existing configured PostgreSQL:', identity); // No connection URL/secrets.
    const baseUrl = `${await app.getUrl()}/api/v1`;
    const owner = clientAt(baseUrl), member = clientAt(baseUrl);
    const password = `Fixture-${randomBytes(24).toString('hex')}`;
    const email = `retry_${randomUUID()}@example.test`;
    for (const [client, userEmail] of [[owner, email], [member, `retry_${randomUUID()}@example.test`]]) {
      const auth = await client.register({ email: userEmail, password, handle: `r_${randomUUID().replaceAll('-', '').slice(0, 24)}`, displayName: 'Retry integration fixture' });
      users.push({ id: auth.user.id, email: userEmail });
    }
    const read = id => prisma.lobby.findUniqueOrThrow({ where: { id }, include: {
      members: { orderBy: { userId: 'asc' } }, messages: { orderBy: { id: 'asc' } },
    } });

    for (const multiple of [false, true]) {
      const original = await owner.createLobby({ title: 'Original title', description: 'Original description', category: 'FOOD',
        capacity: 4, isOnline: true, venueName: null, startsAt: '2200-07-01T12:34:56.789Z', timeZone: 'America/New_York' });
      lobbies.push(original.id);
      await member.joinLobby(original.id);
      await member.sendLobbyMessage(original.id, { clientMessageId: randomUUID(), body: 'Preserve the conversation' });
      const before = await read(original.id), patches = [], receipts = [], retryGate = deferred(), retryCommitted = deferred();
      let droppedRecord;
      const client = clientAt(baseUrl, async (url, options) => {
        const response = await fetch(url, options);
        if (options.method !== 'PATCH' || !url.endsWith(`/lobbies/${original.id}`) || response.status !== 200) return response;
        patches.push(JSON.parse(options.body));
        if (patches.length === 1) {
          // Consume the SUCCESSFUL server response, then verify the committed DB
          // row before injecting a network failure at this client's transport.
          await response.arrayBuffer(); droppedRecord = await read(original.id);
          throw new TypeError('Controlled loss after the committed PATCH');
        }
        retryCommitted.resolve(); await retryGate.promise; return response;
      });
      await client.login({ email, password });
      const store = new EditLobbyFormStore(client, dto => receipts.push(dto));
      const unsubscribe = getLobbyInvalidation(client).subscribe(store.invalidate);
      try {
        store.setContext(users[0].id, original.id); await waitForRead(store);
        assert.equal(store.getSnapshot().base.title, original.title);
        store.update({ title: 'New title', ...(multiple ? { description: 'New description' } : {}) });
        await store.submit(); await waitForRead(store);
        assert.equal(droppedRecord.title, 'New title');
        assert.equal(droppedRecord.description, multiple ? 'New description' : original.description);
        assert.equal(store.getSnapshot().error, 'edit.unconfirmed'); assert.equal(store.getSnapshot().saved, false);
        assert.equal(receipts.length, 0); assert.equal(patches.length, 1);
        // A different authenticated client changes fields this draft never touched.
        await owner.updateLobby(original.id, { category: 'SPORT', capacity: 5 });
        await store.check(true);
        assert.equal(store.getSnapshot().checked.title, 'New title'); assert.equal(store.getSnapshot().fields.title, 'New title');
        assert.equal(store.getSnapshot().fields.capacity, '4'); assert.equal(receipts.length, 0);
        store.update({ title: original.title });
        const retry = store.submit(); await store.submit(); await retryCommitted.promise;
        assert.equal(receipts.length, 0); assert.equal(store.getSnapshot().saved, false);
        assert.deepEqual(patches[1], { title: original.title, ...(multiple ? { description: 'New description' } : {}) });
        assert.equal((await read(original.id)).title, original.title); // Already committed, not yet acknowledged.
        retryGate.resolve(); await retry;
        assert.equal(receipts.length, 1); assert.equal(store.getSnapshot().saved, true);
        assert.equal(receipts[0].title, original.title); assert.equal(receipts[0].category, 'SPORT'); assert.equal(receipts[0].capacity, 5);
        assert.equal(store.getSnapshot().fields.title, original.title);
        assert.equal(store.getSnapshot().fields.description, multiple ? 'New description' : original.description);
        const after = await read(original.id);
        assert.equal(after.description, multiple ? 'New description' : original.description);
        assert.deepEqual({ ...after, title: before.title, description: before.description, category: before.category,
          capacity: before.capacity, updatedAt: before.updatedAt }, before);
        assert.equal((await member.getLobby(original.id)).title, original.title);
        assert.equal(patches.length, 2);
      } finally { retryGate.resolve(); unsubscribe(); store.setContext(null, original.id); }
    }
  } finally {
    if (prisma) {
      // Known returned IDs only; verify ownership/identity before removing fixtures.
      for (const id of lobbies) {
        assert.equal((await prisma.lobby.findUniqueOrThrow({ where: { id } })).organizerId, users[0].id);
        await prisma.lobby.delete({ where: { id } });
      }
      for (const user of users) {
        assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email, user.email);
        await prisma.user.delete({ where: { id: user.id } });
      }
      assert.equal(await prisma.lobby.count({ where: { id: { in: lobbies } } }), 0);
      assert.equal(await prisma.user.count({ where: { id: { in: users.map(user => user.id) } } }), 0);
      console.log('Removed only the two isolated lobbies and their fixture users, memberships and messages.');
    }
    await app?.close();
  }
});
