const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { LobbyFeedStore, formatLobbyStartsAt } = require('../.expo/lobby-tests/features/home/lobbyFeed.js');
const { createTranslator } = require('../.expo/lobby-tests/i18n/translations.js');
const { ApiClient } = require('../.expo/lobby-tests/api/client.js');
const { ApiClientError } = require('../.expo/lobby-tests/api/errors.js');

const lobby = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'demo.pizza', description: 'My own description <not markup>',
  category: 'FOOD', startsAt: '2030-01-01T00:00:00.000Z', timeZone: 'Asia/Bishkek',
  isOnline: false, venueName: 'Actual venue', capacity: 8, joinedCount: 2, isJoined: false, groupExtroversionLevel: null,
};
const page = (items = [], nextCursor = null) => ({ items, nextCursor });
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); }

// Runs actual component handlers/effects with a minimal React/native host.
// No HTTP or component logic is copied into the harness.
function host(auth) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const at = cursor++;
      if (!slots[at]) slots[at] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[at].value, (value) => { slots[at].value = typeof value === 'function' ? value(slots[at].value) : value; }];
    },
    useMemo(factory, deps) {
      const at = cursor++;
      if (!slots[at] || !same(slots[at].deps, deps)) slots[at] = { deps, value: factory() };
      return slots[at].value;
    },
    useEffect(effect, deps) {
      const at = cursor++;
      if (!slots[at] || !same(slots[at].deps, deps)) {
        const cleanup = slots[at]?.cleanup;
        slots[at] = { deps };
        effects.push(() => { cleanup?.(); slots[at].cleanup = effect(); });
      }
    },
    useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
  };
  const jsx = (type, props) => ({ type, props });
  function load(file, extra = {}) {
    const exports = {};
    const native = Object.fromEntries(['View','Text','Pressable','ActivityIndicator','ScrollView','Modal'].map(v => [v,v]));
    const mocks = {
      react,
      'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
      'react-native': { ...native, StyleSheet: { create: v => v } },
      '@expo/vector-icons': { Feather: 'Feather' },
      '../../auth/AuthProvider': { useAuth: () => auth },
      '../../i18n/LocalizationProvider': { useI18n: () => ({ t: createTranslator('ru'), language: 'ru' }) },
      '../../theme': { colors: {}, radius: {} },
      '../../api/errors': { ApiClientError },
      './lobbyFeed': { LobbyFeedStore, formatLobbyStartsAt, emptyLobbyFeed: require('../.expo/lobby-tests/features/home/lobbyFeed.js').emptyLobbyFeed },
      './LiveLobbyCard': { LiveLobbyCard: 'LiveLobbyCard', LiveLobbyMetadata: 'LiveLobbyMetadata', LobbyCategoryPlaceholder: 'LobbyCategoryPlaceholder' },
      './LobbyCountdown': { LobbyCountdown: 'LobbyCountdown' },
      '../profile/ExtroversionGauge': { ExtroversionGauge: 'ExtroversionGauge' },
      ...extra,
    };
    const code = ts.transpileModule(readFileSync(path.join(__dirname, '..', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInNewContext(code, { exports, require: name => { assert.ok(name in mocks, name); return mocks[name]; } });
    return exports;
  }
  return {
    load,
    render(component, props) { cursor = 0; effects = []; const tree = component(props); effects.forEach(effect => effect()); return tree; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function texts(tree) {
  if (Array.isArray(tree)) return tree.map(texts).join(' ');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree && typeof tree === 'object' ? texts(tree.props?.children) : '';
}
const byId = (tree, id) => nodes(tree).find(n => n.props?.testID === id);
const button = (tree, label) => nodes(tree).find(n => n.props?.accessibilityRole === 'button' && texts(n) === label);

test('actual feed renders loading, empty, error and retry with no demo fallback', async () => {
  let pending = deferred();
  const auth = { user: { id: 'A' }, status: 'authenticated', lobbyApi: { listLobbies: () => pending.promise } };
  const h = host(auth);
  const { LiveLobbyFeed } = h.load('src/features/home/LiveLobbyFeed.tsx');
  const render = () => h.render(LiveLobbyFeed, { onSelect() {} });
  assert.ok(byId(render(), 'lobbies-loading'));
  pending.resolve(page()); await flush();
  assert.ok(byId(render(), 'lobbies-empty'));
  pending = deferred();
  button(render(), 'Обновить').props.onPress();
  assert.ok(byId(render(), 'lobbies-loading'));
  pending.reject(new Error('offline')); await flush();
  assert.ok(byId(render(), 'lobbies-error'));
  assert.equal(nodes(render()).filter(n => n.type === 'LiveLobbyCard').length, 0);
  pending = deferred();
  button(render(), 'Попробовать снова').props.onPress();
  assert.ok(byId(render(), 'lobbies-loading'));
  pending.resolve(page([lobby])); await flush();
  assert.equal(nodes(render()).find(n => n.type === 'LiveLobbyCard').props.lobby, lobby);
  h.unmount();
});

test('pagination coalesces loading, retains cursor after error and deduplicates subsequent pages', async () => {
  const pending = deferred(); const calls = [];
  let next = pending.promise;
  const store = new LobbyFeedStore(async after => { calls.push(after); return after ? next : page([lobby], 'cursor-2'); });
  store.setAccount('A'); await flush();
  const first = store.loadMore(); const duplicate = store.loadMore();
  assert.equal(store.getSnapshot().loadingMore, true);
  pending.reject(new Error('offline')); await Promise.all([first, duplicate]);
  assert.equal(calls.length, 2);
  assert.equal(store.getSnapshot().nextCursor, 'cursor-2');
  assert.equal(store.getSnapshot().items.length, 1);
  next = Promise.resolve(page([lobby, { ...lobby, id: 'B' }]));
  await store.loadMore();
  assert.deepEqual(store.getSnapshot().items.map(item => item.id), [lobby.id, 'B']);
  assert.equal(store.getSnapshot().nextCursor, null);
  assert.equal(store.getSnapshot().error, null);
});

test('late success or failure after logout/account switch cannot return old cards', async () => {
  for (const reject of [false, true]) {
    const a = deferred(); const b = deferred(); let requests = 0;
    const store = new LobbyFeedStore(() => ++requests === 1 ? a.promise : b.promise);
    store.setAccount('A'); store.setAccount(null);
    assert.equal(store.getSnapshot().items.length, 0);
    store.setAccount('B'); b.resolve(page([{ ...lobby, title: 'B only' }])); await flush();
    if (reject) a.reject(new Error('late A')); else a.resolve(page([lobby]));
    await flush();
    assert.equal(store.getSnapshot().account, 'B');
    assert.equal(store.getSnapshot().items[0].title, 'B only');
    assert.equal(store.getSnapshot().error, null);
  }
});

test('late next page cannot overwrite a refreshed or logged-out feed', async () => {
  const old = deferred(); let n = 0;
  const store = new LobbyFeedStore(after => after ? old.promise : Promise.resolve(page([{ ...lobby, title: String(++n) }], 'next')));
  store.setAccount('A'); await flush();
  const more = store.loadMore(); await store.reload();
  old.resolve(page([{ ...lobby, id: 'old-page' }])); await more;
  assert.equal(store.getSnapshot().items[0].title, '2');
  assert.equal(store.getSnapshot().items.length, 1);
  store.setAccount(null);
  assert.equal(store.getSnapshot().items.length, 0);
});

test('actual feed hides previous-account data on the first render of an account switch', async () => {
  let pending = Promise.resolve(page([lobby]));
  const auth = { user: { id: 'A' }, status: 'authenticated', lobbyApi: { listLobbies: () => pending } };
  const h = host(auth); const { LiveLobbyFeed } = h.load('src/features/home/LiveLobbyFeed.tsx');
  const render = () => h.render(LiveLobbyFeed, { onSelect() {} });
  render(); await flush(); assert.equal(nodes(render()).filter(n => n.type === 'LiveLobbyCard').length, 1);
  pending = deferred().promise; auth.user = { id: 'B' };
  assert.equal(nodes(render()).filter(n => n.type === 'LiveLobbyCard').length, 0);
  auth.status = 'unauthenticated'; auth.user = null;
  assert.equal(nodes(render()).filter(n => n.type === 'LiveLobbyCard').length, 0);
  h.unmount();
});

test('real strings stay literal, dates use event timezone and countdown takes the absolute instant', () => {
  assert.match(formatLobbyStartsAt(lobby, 'en'), /06:00.*Asia\/Bishkek/);
  assert.match(formatLobbyStartsAt({ ...lobby, timeZone: 'UTC' }, 'en'), /00:00.*UTC/);
  assert.equal(formatLobbyStartsAt({ ...lobby, timeZone: 'Invalid/Zone' }, 'en'), null);
  assert.equal(formatLobbyStartsAt({ ...lobby, startsAt: 'bad' }, 'en'), null);
  const h = host({}); const components = h.load('src/features/home/LiveLobbyCard.tsx');
  let clicked = false;
  const card = h.render(components.LiveLobbyCard, { lobby, onPress: () => { clicked = true; } });
  assert.match(texts(card), /demo\.pizza/);
  assert.equal(nodes(card).filter(n => n.type === 'ExtroversionGauge').length, 0);
  card.props.onPress(); assert.equal(clicked, true);
  const metadata = h.render(components.LiveLobbyMetadata, { lobby });
  assert.equal(nodes(metadata).find(n => n.type === 'LobbyCountdown').props.startsAt, Date.parse(lobby.startsAt));
  assert.match(texts(metadata), /2.*8/);
  assert.doesNotMatch(texts(metadata), /км|km/);
});

test('actual details load by id, preserve user description and expose no working join/chat action', async () => {
  const pending = deferred(); let selected;
  const auth = { user: { id: 'A' }, lobbyApi: { getLobby: id => { selected = id; return pending.promise; } } };
  const h = host(auth); const { LiveLobbyDetails } = h.load('src/features/home/LiveLobbyDetails.tsx');
  const render = () => h.render(LiveLobbyDetails, { id: lobby.id, onClose() {} });
  assert.ok(byId(render(), 'lobby-details-loading')); assert.equal(selected, lobby.id);
  pending.resolve(lobby); await flush();
  const tree = render();
  assert.equal(texts(byId(tree, 'live-lobby-description')), lobby.description);
  for (const label of ['Вступить — недоступно', 'Чат — недоступен']) {
    const action = button(tree, label); assert.equal(action.props.disabled, true); assert.equal(action.props.onPress, undefined);
  }
  h.unmount();
});

test('details ignore late results after account switch and can retry a failed request', async () => {
  const a = deferred(); let response = a.promise;
  const auth = { user: { id: 'A' }, lobbyApi: { getLobby: () => response } };
  const h = host(auth); const { LiveLobbyDetails } = h.load('src/features/home/LiveLobbyDetails.tsx');
  const render = () => h.render(LiveLobbyDetails, { id: lobby.id, onClose() {} });
  render();
  auth.user = { id: 'B' }; response = Promise.reject(new Error('offline')); render(); await flush();
  a.resolve(lobby); await flush();
  assert.ok(byId(render(), 'lobby-details-error'));
  assert.equal(byId(render(), 'live-lobby-description'), undefined);
  response = Promise.resolve({ ...lobby, description: 'B only' });
  button(render(), 'Попробовать снова').props.onPress(); render(); await flush();
  assert.equal(texts(byId(render(), 'live-lobby-description')), 'B only');
  h.unmount();
});

test('real feed/details never import demo joining, chat storage or conversations', () => {
  for (const file of ['LiveLobbyFeed.tsx', 'LiveLobbyCard.tsx', 'LiveLobbyDetails.tsx', 'lobbyFeed.ts']) {
    const source = readFileSync(path.join(__dirname, '../src/features/home', file), 'utf8');
    assert.doesNotMatch(source, /demoLobbies|joinDemoLobby|MockChatProvider|mockConversation|titleKey|startsAfterMs/);
  }
  const home = readFileSync(path.join(__dirname, '../src/screens/HomeScreen.tsx'), 'utf8');
  assert.match(home, /LiveLobbyFeed onSelect=\{setSelectedLobbyId\}/);
  assert.match(home, /LiveLobbyDetails key=\{selectedLobbyId\} id=\{selectedLobbyId\}/);
  assert.match(home, /lobbies\.demo/);
});

test('Lobby requests use existing Bearer transport, one refresh retry, and invalidate late responses', async () => {
  const late = deferred(); const events = []; let token = null; let expire = true;
  const profile = { id: 'A' };
  const pair = n => ({ user: profile, accessToken: 'access-'+n, refreshToken: 'refresh-'+n });
  const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
  const client = new ApiClient({ baseUrl: () => 'http://api.test/api/v1', refreshTokenStorage: {
    async get() { return token; }, async set(value) { token = value; }, async clear() { token = null; },
  }, fetchImpl: async (url, options) => {
    events.push({ url, authorization: options.headers.Authorization });
    if (url.endsWith('/auth/login')) return response(pair(1));
    if (url.endsWith('/auth/refresh')) return response(pair(2));
    if (url.endsWith('/auth/logout')) return new Response(null, { status: 204 });
    if (url.includes('/lobbies?')) {
      if (expire) { expire = false; return response({ error: { code: 'INVALID_ACCESS_TOKEN', message: 'expired' } }, 401); }
      return response(page([lobby]));
    }
    return late.promise;
  } });
  await client.login({ email: 'test@example.test', password: 'test-only' });
  assert.deepEqual(await client.listLobbies(), page([lobby]));
  assert.equal(events.filter(event => event.url.endsWith('/auth/refresh')).length, 1);
  assert.equal(events.at(-1).authorization, 'Bearer access-2');
  const details = client.getLobby(lobby.id); const rejected = assert.rejects(details, error => error.code === 'INVALID_REFRESH_TOKEN');
  await client.logout(); late.resolve(response(lobby)); await rejected;
  assert.equal(token, null);
});
