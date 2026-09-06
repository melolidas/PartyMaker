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
const { getLobbyInvalidation } = require('../.expo/lobby-tests/api/lobbyInvalidation.js');
const detailsLogic = require('../.expo/lobby-tests/features/home/lobbyDetails.js');
const { LobbyDetailsStore, membershipAction } = detailsLogic;
const searchLogic = require('../.expo/lobby-tests/features/search/lobbySearch.js');
const createForm = require('../.expo/lobby-tests/features/home/createLobbyForm.js');
const { CreateLobbyFormStore, validateLobbyForm, bishkekDateTimeToInstant } = createForm;
const chatLogic = require('../.expo/lobby-tests/features/chats/liveLobbyChat.js');
const { LiveLobbyChatStore } = chatLogic;
const inboxLogic = require('../.expo/lobby-tests/features/chats/liveChatInbox.js');
const scrollLogic = require('../.expo/lobby-tests/features/chats/liveChatScroll.js');
const membersLogic = require('../.expo/lobby-tests/features/home/lobbyMembers.js');
const editLogic = require('../.expo/lobby-tests/features/home/editLobbyForm.js');

const lobby = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'demo.pizza', description: 'My own description <not markup>',
  category: 'FOOD', startsAt: '2030-01-01T00:00:00.000Z', timeZone: 'Asia/Bishkek',
  isOnline: false, venueName: 'Actual venue', capacity: 8, joinedCount: 2, isJoined: false, groupExtroversionLevel: null,
  membershipStatus: null, isOrganizer: false,
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
    useContext(context) { return context.value; },
    useRef(value) { return react.useMemo(() => ({ current: value }), []); },
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
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
  };
  const jsx = (type, props) => ({ type, props });
  function load(file, extra = {}, expose = '') {
    const exports = {};
    const native = Object.fromEntries(['View','Text','Pressable','ActivityIndicator','ScrollView','FlatList','Modal','TextInput','KeyboardAvoidingView'].map(v => [v,v]));
    const mocks = {
      react,
      'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
      'react-native': { ...native, Keyboard: { dismiss() {} }, StyleSheet: { create: v => v }, Platform: { OS: 'web', select: v => v.web }, BackHandler: { addEventListener: () => ({ remove() {} }) } },
      '@expo/vector-icons': { Feather: 'Feather' },
      '../../auth/AuthProvider': { useAuth: () => auth },
      '../../i18n/LocalizationProvider': { useI18n: () => ({ t: createTranslator('ru'), language: 'ru' }) },
      '../../theme': { colors: {}, radius: {} },
      '../../api/errors': { ApiClientError },
      '../../api/lobbyInvalidation': { getLobbyInvalidation },
      './lobbyDetails': detailsLogic,
      '../chats/LiveLobbyChatScreen': { LiveLobbyChatScreen: 'LiveLobbyChatScreen' },
      './LiveLobbyMembersScreen': { LiveLobbyMembersScreen: 'LiveLobbyMembersScreen' },
      './EditLobbyScreen': { EditLobbyScreen: 'EditLobbyScreen' },
      './editLobbyForm': editLogic,
      './createLobbyForm': createForm,
      './lobbyMembers': membersLogic,
      '../profile/AvatarImage': { AvatarImage: 'AvatarImage' },
      './liveLobbyChat': chatLogic,
      './liveChatInbox': inboxLogic,
      './liveChatScroll': scrollLogic,
      'react-native-gesture-handler': { GestureDetector: 'GestureDetector', GestureHandlerRootView: 'GestureHandlerRootView' },
      '../../components/Screen': { Screen: 'Screen' },
      '../home/LiveLobbyCard': { LobbyCategoryPlaceholder: 'LobbyCategoryPlaceholder' },
      '../../navigation/NavScrollContext': { NavScrollContext: { Provider: 'NavScrollContext.Provider' } },
      './SwipeBackPage': { SwipeBackPage: 'SwipeBackPage' },
      './LiveChatsScreen': { LiveChatsScreen: 'LiveChatsScreen' },
      './LiveLobbyChatScreen': { LiveLobbyChatScreen: 'LiveLobbyChatScreen' },
      'expo-modules-core': { uuid: { v4: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } },
      './HomeExperienceProvider': { useHomeClock: () => Date.now() },
      '../navigation/NavScrollContext': { NavScrollContext: { value() {} } },
      './lobbyFeed': { LobbyFeedStore, formatLobbyStartsAt, emptyLobbyFeed: require('../.expo/lobby-tests/features/home/lobbyFeed.js').emptyLobbyFeed },
      './LiveLobbyCard': { LiveLobbyCard: 'LiveLobbyCard', LiveLobbyMetadata: 'LiveLobbyMetadata', LobbyCategoryPlaceholder: 'LobbyCategoryPlaceholder' },
      './LobbyCountdown': { LobbyCountdown: 'LobbyCountdown' },
      '../profile/ExtroversionGauge': { ExtroversionGauge: 'ExtroversionGauge' },
      ...extra,
    };
    const code = ts.transpileModule(readFileSync(path.join(__dirname, '..', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInNewContext(code + (expose ? `\nexports.${expose} = ${expose};` : ''), { exports, require: name => { assert.ok(name in mocks, name); return mocks[name]; } });
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
const member = (id = 'A', organizer = false) => ({ user: { id, displayName: `Real <${id}>`, handle: `handle_${id}`, avatar: null }, isOrganizer: organizer, joinedAt: '2026-01-01T00:00:00.000Z' });
function membersHost(api = {}) {
  const auth = { user: { id: 'A' }, lobbyApi: { listLobbyMembers: async () => page(), ...api } };
  let backs = 0, lost = 0, attempt = 0;
  const h = host(auth);
  const { LiveLobbyMembersScreen } = h.load('src/features/home/LiveLobbyMembersScreen.tsx', {
    'expo-modules-core': { uuid: { v4: () => `00000000-0000-4000-8000-${String(++attempt).padStart(12, '0')}` } },
  });
  const props = { lobbyId: lobby.id, onBack() { backs++; }, onAccessLost() { lost++; } };
  const render = () => h.render(LiveLobbyMembersScreen, props);
  const list = () => byId(render(), 'members-list');
  return { h, auth, props, render, list, rows: () => list().props.data, result: () => ({ backs, lost }) };
}

test('members actual screen loads, renders empty/error/retry and plain names, organizer/You badges without demo or total', async () => {
  let next = deferred(); const c = membersHost({ listLobbyMembers: () => next.promise });
  c.render(); assert.ok(byId(c.render(), 'members-loading')); assert.deepEqual(c.rows(), []);
  next.resolve(page()); await flush(); assert.ok(byId(c.render(), 'members-empty'));
  next = deferred(); byId(c.render(), 'members-refresh').props.onPress(); next.reject(Error('offline')); await flush();
  assert.ok(byId(c.render(), 'members-error')); assert.deepEqual(c.rows(), []);
  next = deferred(); byId(c.render(), 'members-retry').props.onPress(); next.resolve(page([member('A', true), member('B')])); await flush();
  assert.equal(c.rows().length, 2);
  const row = c.list().props.renderItem({ item: c.rows()[0] });
  assert.match(texts(row), /Real <A>/); assert.match(texts(row), /@\s*handle_A/);
  assert.match(texts(row), /Организатор/); assert.match(texts(row), /Вы/);
  const second = c.list().props.renderItem({ item: c.rows()[1] }); assert.doesNotMatch(texts(second), /Организатор|Вы/);
  assert.equal(nodes(row).find(n => n.type === 'AvatarImage').props.avatar, null);
  assert.doesNotMatch(texts(c.render()), /демо|всего|найдено/i); c.h.unmount();
});

test('members page errors retain rows/cursor; retry is single-flight, deduplicates and Refresh replaces the page', async () => {
  let next = Promise.resolve(page([member('A')], 'cursor')), calls = [];
  const c = membersHost({ listLobbyMembers: (id, after) => { calls.push({ id, after }); return next; } });
  c.render(); await flush(); const oldRevision = c.list().props.renderItem({ item: c.rows()[0] }).props.children[0].props.reloadKey;
  const pending = deferred(); next = pending.promise;
  const more = byId(c.list().props.ListFooterComponent, 'members-more').props.onPress; more(); more();
  assert.equal(calls.length, 2); assert.equal(calls[1].after, 'cursor'); pending.reject(Error('offline')); await flush();
  assert.deepEqual(c.rows().map(row => row.user.id), ['A']); assert.match(texts(byId(c.render(), 'members-error')), /следующую страницу/);
  next = Promise.resolve(page([member('A'), member('B')], 'next')); byId(c.render(), 'members-retry').props.onPress(); await flush();
  assert.equal(calls[2].after, 'cursor'); assert.deepEqual(c.rows().map(row => row.user.id), ['A', 'B']);
  next = Promise.resolve(page([member('B')])); byId(c.render(), 'members-refresh').props.onPress();
  assert.deepEqual(c.rows(), []); await flush(); assert.deepEqual(c.rows().map(row => row.user.id), ['B']);
  assert.equal(calls.at(-1).after, undefined); assert.equal(c.list().props.ListFooterComponent, null);
  const image = nodes(c.list().props.renderItem({ item: c.rows()[0] })).find(n => n.type === 'AvatarImage');
  assert.notEqual(image.props.reloadKey, oldRevision); assert.match(image.props.reloadKey, /^[0-9a-f-]{36}$/);
  assert.ok(!image.props.reloadKey.includes(lobby.id)); assert.equal(c.auth.user.avatar, undefined); c.h.unmount();
});

test('members 403/404 on initial, Refresh and Load more clear rows/cursor and notify access loss without reload loops', async () => {
  for (const statusCode of [403, 404]) for (const phase of ['initial', 'refresh', 'page']) {
    let denied = phase === 'initial', calls = 0;
    const c = membersHost({ listLobbyMembers: async () => { calls++; if (denied) throw new ApiClientError({ statusCode, code: 'denied', message: 'denied' }); return page([member()], 'next'); } });
    c.render(); await flush();
    if (phase !== 'initial') {
      assert.equal(c.rows().length, 1); denied = true;
      if (phase === 'page') byId(c.list().props.ListFooterComponent, 'members-more').props.onPress();
      else byId(c.render(), 'members-refresh').props.onPress();
      await flush();
    }
    assert.deepEqual(c.rows(), []); assert.equal(c.list().props.ListFooterComponent, null);
    assert.match(texts(byId(c.render(), 'members-error')), /больше недоступен/);
    for (let i = 0; i < 4; i++) { c.render(); await flush(); }
    assert.equal(c.result().lost, 1); assert.equal(calls, phase === 'initial' ? 1 : 2); c.h.unmount();
  }
});

test('members shared invalidation hides page immediately, checks access and discards older pagination', async () => {
  const old = deferred(); let calls = 0, denied = false;
  const c = membersHost({ listLobbyMembers: async (_id, after) => {
    calls++; if (after) return old.promise;
    if (denied) throw new ApiClientError({ statusCode: 403, code: 'LOBBY_MEMBERS_FORBIDDEN', message: 'left' });
    return page([member()], 'next');
  } });
  c.render(); await flush(); byId(c.list().props.ListFooterComponent, 'members-more').props.onPress();
  denied = true; getLobbyInvalidation(c.auth.lobbyApi).invalidate(); assert.deepEqual(c.rows(), []);
  await flush(); c.render(); old.resolve(page([member('old')], 'old-cursor')); await flush();
  assert.deepEqual(c.rows(), []); assert.equal(c.list().props.ListFooterComponent, null); assert.equal(c.result().lost, 1); assert.equal(calls, 3);
  c.h.unmount();
});

test('members stale reads after new Refresh, account/lobby change, logout, back and unmount never return old rows', async () => {
  for (const transition of ['refresh', 'account', 'lobby', 'logout', 'back', 'unmount']) {
    const old = deferred(); let calls = 0;
    const c = membersHost({ listLobbyMembers: () => ++calls === 1 ? old.promise : Promise.resolve(page([member('new')])) });
    c.render();
    if (transition === 'refresh') getLobbyInvalidation(c.auth.lobbyApi).invalidate();
    if (transition === 'account') { c.auth.user = { id: 'B' }; c.render(); }
    if (transition === 'lobby') { c.props.lobbyId = 'different'; c.render(); }
    if (transition === 'logout') { c.auth.user = null; c.render(); }
    if (transition === 'back') byId(c.render(), 'members-back').props.onPress();
    if (transition === 'unmount') c.h.unmount();
    old.resolve(page([member('old')], 'old-cursor')); await flush();
    assert.deepEqual(c.rows().map(row => row.user.id), ['refresh', 'account', 'lobby'].includes(transition) ? ['new'] : []);
    c.h.unmount();
  }
  // Two reloads finish in reverse order; neither the old success nor error changes current data.
  for (const reject of [false, true]) {
    const first = deferred(), second = deferred(); let calls = 0;
    const store = new membersLogic.LobbyMembersStore(() => ++calls === 1 ? first.promise : second.promise);
    store.setContext('A', lobby.id); const newer = store.reload(); second.resolve(page([member('new')])); await newer;
    if (reject) first.reject(new ApiClientError({ statusCode: 404, code: 'LOBBY_NOT_FOUND', message: 'old' }));
    else first.resolve(page([member('old')]));
    await flush(); assert.deepEqual(store.getSnapshot().items.map(row => row.user.id), ['new']); assert.equal(store.getSnapshot().error, null);
  }
});

test('actual details -> members -> Back/system Back stays in one Modal and preserves chat/cancel paths', async () => {
  const c = cancelHost(); c.render(); await flush();
  for (const system of [false, true]) {
    byId(c.render(), 'members-open').props.onPress();
    const screen = nodes(c.render()).find(n => n.type === 'LiveLobbyMembersScreen'); assert.equal(screen.props.lobbyId, lobby.id);
    assert.equal(nodes(c.render()).filter(n => n.type === 'Modal').length, 1);
    if (system) nodes(c.render()).find(n => n.type === 'Modal').props.onRequestClose(); else screen.props.onBack();
    await flush(); assert.equal(nodes(c.render()).find(n => n.type === 'LiveLobbyMembersScreen'), undefined);
    assert.equal(texts(byId(c.render(), 'live-lobby-description')), lobby.description);
  }
  byId(c.render(), 'live-chat-open').props.onPress(); nodes(c.render()).find(n => n.type === 'LiveLobbyChatScreen').props.onBack(); await flush();
  byId(c.render(), 'cancel-open').props.onPress(); assert.ok(byId(c.render(), 'cancel-confirmation')); byId(c.render(), 'cancel-decline').props.onPress();
  assert.deepEqual(c.result(), { closes: 0, notices: 0 });
  byId(c.render(), 'members-open').props.onPress();
  c.auth.lobbyApi.getLobby = async () => ({ ...lobby, membershipStatus: 'LEFT' });
  nodes(c.render()).find(n => n.type === 'LiveLobbyMembersScreen').props.onAccessLost(); await flush();
  nodes(c.render()).find(n => n.type === 'Modal').props.onRequestClose(); await flush();
  assert.equal(byId(c.render(), 'members-open').props.disabled, true); assert.ok(byId(c.render(), 'members-join-first')); c.h.unmount();
});

test('members transport uses current Bearer and encoded lobby/cursor with bounded auth refresh', async () => {
  const calls = []; let refreshes = 0;
  const client = creationClient(async (url, options) => {
    if (url.endsWith('/auth/login')) return authReply(1);
    if (url.endsWith('/auth/refresh')) { refreshes++; return authReply(2); }
    calls.push({ url, options });
    if (calls.length === 1) return new Response(JSON.stringify({ error: { code: 'INVALID_ACCESS_TOKEN', message: 'expired' } }), { status: 401 });
    return new Response(JSON.stringify(page([member()])));
  });
  await client.login({ email: 'a@example.test', password: 'test-only' });
  assert.equal((await client.listLobbyMembers(lobby.id, 'a/b+?=')).items[0].user.id, 'A');
  assert.equal(refreshes, 1); assert.equal(calls.length, 2);
  for (const call of calls) { const url = new URL(call.url); assert.equal(url.pathname, `/api/v1/lobbies/${lobby.id}/members`); assert.equal(url.searchParams.get('after'), 'a/b+?='); assert.equal(url.searchParams.get('limit'), '20'); }
  assert.equal(new Headers(calls[1].options.headers).get('Authorization'), 'Bearer access-2');
});
const button = (tree, label) => nodes(tree).find(n => n.props?.accessibilityRole === 'button' && texts(n) === label);

const cancelledReceipt = () => ({ id: lobby.id, status: 'CANCELLED' });
const editableLobby = () => ({ ...lobby, isOrganizer: true, isJoined: true, membershipStatus: 'JOINED', groupExtroversionLevel: 5.5,
  startsAt: '2200-07-01T12:34:56.789Z', timeZone: 'America/New_York' });
function editHost(api = {}) {
  const auth = { user: { id: 'A' }, lobbyApi: { getLobby: async id => ({ ...editableLobby(), id }), updateLobby: async (_id, input) => ({ ...editableLobby(), ...input }), ...api } };
  let backs = 0, lost = 0, now = Date.now(); const saved = [];
  const h = host(auth), { EditLobbyScreen } = h.load('src/features/home/EditLobbyScreen.tsx', { './HomeExperienceProvider': { useHomeClock: () => now } });
  const props = { lobbyId: lobby.id, onBack() { backs++; }, onAccessLost() { lost++; }, onSaved(value) { saved.push(value); } };
  return { h, auth, props, saved, result: () => ({ backs, lost }), clock(value) { now = value; }, render: () => h.render(EditLobbyScreen, props) };
}

test('editor loads API values once, fixes original zone/seconds and keeps unsaved draft through background invalidation', async () => {
  let server = editableLobby(); const c = editHost({ getLobby: async () => server });
  c.render(); assert.ok(byId(c.render(), 'edit-loading')); await flush();
  assert.equal(byId(c.render(), 'edit-title').props.value, server.title);
  assert.match(texts(byId(c.render(), 'edit-schedule')), /America\/New_York/); assert.match(texts(byId(c.render(), 'edit-schedule')), /56/);
  assert.equal(byId(c.render(), 'create-date'), undefined); assert.equal(byId(c.render(), 'create-time'), undefined);
  byId(c.render(), 'edit-title').props.onChangeText('Unsaved draft');
  server = { ...server, title: 'External title', capacity: 9 }; getLobbyInvalidation(c.auth.lobbyApi).invalidate(); await flush();
  assert.equal(byId(c.render(), 'edit-title').props.value, 'Unsaved draft'); assert.equal(byId(c.render(), 'edit-capacity').props.value, '8');
  byId(c.render(), 'edit-check').props.onPress(); await flush(); assert.match(texts(byId(c.render(), 'edit-checked')), /External title/);
  assert.equal(byId(c.render(), 'edit-title').props.value, 'Unsaved draft'); assert.deepEqual(c.saved, []); c.h.unmount();
});

test('editor normalizes and submits only changed fields, including complete venue pairs; no empty PATCH', async () => {
  const calls = []; const c = editHost({ updateLobby: async (id, input) => { calls.push({ id, input }); return { ...editableLobby(), ...input }; } });
  c.render(); await flush(); byId(c.render(), 'edit-submit').props.onPress(); await flush(); assert.equal(calls.length, 0);
  assert.match(texts(byId(c.render(), 'edit-error')), /Нет изменений/);
  byId(c.render(), 'edit-title').props.onChangeText('  Changed  '); byId(c.render(), 'edit-online').props.onPress();
  byId(c.render(), 'edit-capacity').props.onChangeText('3'); byId(c.render(), 'edit-submit').props.onPress(); await flush();
  assert.deepEqual(calls, [{ id: lobby.id, input: { title: 'Changed', capacity: 3, isOnline: true, venueName: null } }]);
  assert.equal(c.saved.length, 1); assert.equal(c.saved[0].startsAt, editableLobby().startsAt); assert.equal(c.saved[0].timeZone, 'America/New_York'); c.h.unmount();
  const base = editableLobby(), fields = { title: base.title, description: base.description, category: base.category, capacity: String(base.capacity), isOnline: false, venueName: ' New cafe ' };
  assert.deepEqual(editLogic.changedLobbyFields(base, fields), { isOnline: false, venueName: 'New cafe' });
  assert.deepEqual(editLogic.changedLobbyFields(base, { ...fields, venueName: base.venueName }), {});
});

test('editor shared field validation rejects invalid text/capacity/venue and keeps inputs', async () => {
  for (const [field, value, expected] of [['title',' ','create.error.title'], ['description','x'.repeat(201),'create.error.description'],
    ['capacity','1','create.error.capacity'], ['capacity','2.1','create.error.capacity'], ['venue',' ','create.error.venue']]) {
    let writes = 0; const c = editHost({ updateLobby: async () => { writes++; return editableLobby(); } }); c.render(); await flush();
    byId(c.render(), `edit-${field}`).props.onChangeText(value); byId(c.render(), 'edit-submit').props.onPress(); await flush();
    assert.equal(writes, 0); assert.equal(texts(byId(c.render(), 'edit-error')), createTranslator('ru')(expected));
    assert.equal(byId(c.render(), `edit-${field}`).props.value, value); c.h.unmount();
  }
});

test('editor synchronously locks duplicate submit; unconfirmed save + GET is not success and explicit retry keeps patch', async () => {
  const pending = deferred(); let writes = 0, server = editableLobby(); const payloads = [];
  const c = editHost({ getLobby: async () => server, updateLobby: async (_id, patch) => { payloads.push(patch); if (++writes === 1) return pending.promise; return { ...server, ...patch }; } });
  c.render(); await flush(); byId(c.render(), 'edit-title').props.onChangeText('Draft');
  const submit = byId(c.render(), 'edit-submit').props.onPress; submit(); submit(); assert.equal(writes, 1);
  assert.equal(byId(c.render(), 'edit-title').props.editable, false); assert.equal(byId(c.render(), 'edit-check').props.disabled, true);
  server = { ...server, title: 'Draft' }; pending.reject(Error('lost after commit')); await flush();
  assert.equal(c.saved.length, 0); assert.match(texts(byId(c.render(), 'edit-error')), /Сохранение не подтверждено/);
  byId(c.render(), 'edit-check').props.onPress(); await flush();
  assert.match(texts(byId(c.render(), 'edit-checked')), /не подтверждает/); assert.equal(c.saved.length, 0);
  assert.equal(byId(c.render(), 'edit-title').props.value, 'Draft'); assert.equal(writes, 1);
  byId(c.render(), 'edit-submit').props.onPress(); await flush(); assert.equal(c.saved.length, 1);
  assert.deepEqual(payloads, [{ title: 'Draft' }, { title: 'Draft' }]); c.h.unmount();
});

test('editor invalid receipts never confirm, business errors preserve draft, GET404 blocks without success or reload loops', async () => {
  for (const reply of [null, { id: lobby.id }, { ...editableLobby(), id: 'wrong' }, { ...editableLobby(), email: 'private' }, { ...editableLobby(), category: ['FOOD'] }]) {
    const c = editHost({ updateLobby: async () => reply }); c.render(); await flush(); byId(c.render(), 'edit-title').props.onChangeText('Draft');
    byId(c.render(), 'edit-submit').props.onPress(); await flush(); assert.equal(c.saved.length, 0); assert.match(texts(byId(c.render(), 'edit-error')), /не подтверждено/); c.h.unmount();
  }
  for (const code of ['LOBBY_CAPACITY_BELOW_JOINED', 'LOBBY_CAPACITY_BELOW_MIN_PARTICIPANTS']) {
    const c = editHost({ updateLobby: async () => { throw new ApiClientError({ statusCode: 409, code, message: code }); } });
    c.render(); await flush(); byId(c.render(), 'edit-capacity').props.onChangeText('2'); byId(c.render(), 'edit-submit').props.onPress(); await flush();
    assert.match(texts(byId(c.render(), 'edit-error')), /Вместимость/); assert.equal(byId(c.render(), 'edit-capacity').props.value, '2'); c.h.unmount();
  }
  let reads = 0; const c = editHost({ getLobby: async () => { if (++reads > 1) throw new ApiClientError({ statusCode: 404, code: 'LOBBY_NOT_FOUND', message: 'hidden' }); return editableLobby(); }, updateLobby: async () => { throw Error('unconfirmed'); } });
  c.render(); await flush(); byId(c.render(), 'edit-title').props.onChangeText('Draft'); byId(c.render(), 'edit-submit').props.onPress(); await flush();
  byId(c.render(), 'edit-check').props.onPress(); await flush();
  for (let i = 0; i < 3; i++) { c.render(); await flush(); }
  assert.equal(c.saved.length, 0); assert.equal(c.result().lost, 1); assert.equal(reads, 2);
  assert.ok(byId(c.render(), 'edit-unavailable')); assert.equal(byId(c.render(), 'edit-submit').props.disabled, true);
  assert.equal(byId(c.render(), 'edit-title').props.value, 'Draft'); c.h.unmount();
});

test('invalidation during uncertain PATCH is coalesced into one access check after settlement, preserving draft', async () => {
  const pending = deferred(); let reads = 0;
  const c = editHost({ getLobby: async () => {
    if (++reads > 1) throw new ApiClientError({ statusCode: 404, code: 'LOBBY_NOT_FOUND', message: 'cancelled' });
    return editableLobby();
  }, updateLobby: () => pending.promise });
  c.render(); await flush(); byId(c.render(), 'edit-title').props.onChangeText('Keep this draft'); byId(c.render(), 'edit-submit').props.onPress();
  for (let i = 0; i < 3; i++) getLobbyInvalidation(c.auth.lobbyApi).invalidate();
  assert.equal(reads, 1); pending.reject(Error('lost result')); await flush(); c.render();
  assert.equal(reads, 2); assert.equal(byId(c.render(), 'edit-title').props.value, 'Keep this draft');
  assert.equal(byId(c.render(), 'edit-submit').props.disabled, true); assert.equal(c.result().lost, 1); assert.equal(c.saved.length, 0);
  for (let i = 0; i < 3; i++) { c.render(); await flush(); } assert.equal(reads, 2); c.h.unmount();
});

test('editor late GET/PATCH after close/account/logout/lobby/unmount never updates new draft or calls success', async () => {
  for (const operation of ['read', 'patch']) for (const transition of ['back','account','logout','lobby','unmount']) {
    const pending = deferred(); let reads = 0;
    const c = editHost({ getLobby: async id => operation === 'read' && ++reads === 1 ? pending.promise : { ...editableLobby(), id }, updateLobby: () => pending.promise });
    c.render(); await flush();
    if (operation === 'patch') { byId(c.render(), 'edit-title').props.onChangeText('Old draft'); byId(c.render(), 'edit-submit').props.onPress(); }
    if (transition === 'back') byId(c.render(), 'edit-back').props.onPress();
    if (transition === 'account') { c.auth.user = { id: 'B' }; c.render(); }
    if (transition === 'logout') { c.auth.user = null; c.render(); }
    if (transition === 'lobby') { c.props.lobbyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; c.render(); }
    if (transition === 'unmount') c.h.unmount();
    pending.resolve({ ...editableLobby(), title: 'Old reply' }); await flush(); assert.equal(c.saved.length, 0);
    assert.notEqual(byId(c.render(), 'edit-title')?.props.value, 'Old reply'); c.h.unmount();
  }
});

test('editor clock blocks open inputs/save at startsAt; initial errors allow retry and never send on Back', async () => {
  let fail = true, writes = 0; const c = editHost({ getLobby: async () => { if (fail) throw Error('offline'); return editableLobby(); }, updateLobby: async () => { writes++; return editableLobby(); } });
  c.render(); await flush(); assert.ok(byId(c.render(), 'edit-check-error')); fail = false; byId(c.render(), 'edit-check').props.onPress(); await flush();
  byId(c.render(), 'edit-title').props.onChangeText('Unsaved'); c.clock(Date.parse(editableLobby().startsAt));
  assert.equal(byId(c.render(), 'edit-submit').props.disabled, true); assert.equal(byId(c.render(), 'edit-title').props.editable, false);
  assert.ok(byId(c.render(), 'edit-unavailable')); byId(c.render(), 'edit-back').props.onPress(); assert.equal(c.result().backs, 1); assert.equal(writes, 0); c.h.unmount();
});

test('actual details edit route uses one Modal, Back cancels, confirmed DTO replaces old GET, and nonorganizer has no action', async () => {
  const c = cancelHost({ getLobby: async () => editableLobby() }); c.render(); await flush();
  for (const system of [false, true]) {
    byId(c.render(), 'edit-open').props.onPress(); const editor = nodes(c.render()).find(n => n.type === 'EditLobbyScreen');
    assert.equal(editor.props.lobbyId, lobby.id); assert.equal(nodes(c.render()).filter(n => n.type === 'Modal').length, 1);
    if (system) nodes(c.render()).find(n => n.type === 'Modal').props.onRequestClose(); else editor.props.onBack();
    await flush(); assert.equal(nodes(c.render()).find(n => n.type === 'EditLobbyScreen'), undefined);
    editor.props.onSaved({ ...editableLobby(), title: 'Late after Back' });
    assert.equal(byId(c.render(), 'edit-saved'), undefined); assert.doesNotMatch(texts(c.render()), /Late after Back/);
  }
  byId(c.render(), 'edit-open').props.onPress(); const old = deferred(); c.auth.lobbyApi.getLobby = () => old.promise;
  getLobbyInvalidation(c.auth.lobbyApi).invalidate();
  nodes(c.render()).find(n => n.type === 'EditLobbyScreen').props.onSaved({ ...editableLobby(), title: 'Updated details' });
  old.resolve(editableLobby()); await flush(); assert.match(texts(c.render()), /Updated details/); assert.ok(byId(c.render(), 'edit-saved'));
  assert.ok(byId(c.render(), 'live-chat-open')); assert.ok(byId(c.render(), 'members-open')); assert.ok(byId(c.render(), 'cancel-open')); c.h.unmount();
  const other = cancelHost({ getLobby: async () => ({ ...editableLobby(), isOrganizer: false }) }); other.render(); await flush(); assert.equal(byId(other.render(), 'edit-open'), undefined); other.h.unmount();
});

test('PATCH transport uses only explicit auth retry, validates safe DTO and never invalidates another session', async () => {
  for (const outcome of ['success', 'network', '5xx', 'invalid']) {
    let writes = 0, refreshes = 0, invalidations = 0; const bodies = [];
    const client = creationClient(async (url, options) => {
      if (url.endsWith('/auth/login')) return authReply(1);
      if (url.endsWith('/auth/refresh')) { refreshes++; return authReply(2); }
      bodies.push(JSON.parse(options.body)); assert.equal(options.method, 'PATCH');
      if (++writes === 1) return new Response(JSON.stringify({ error: { code: 'INVALID_ACCESS_TOKEN', message: 'expired' } }), { status: 401 });
      if (outcome === 'network') throw Error('lost');
      return new Response(JSON.stringify(outcome === 'invalid' ? { id: lobby.id } : outcome === '5xx' ? { error: { code: 'HTTP_503', message: 'uncertain' } } : { ...editableLobby(), title: 'New' }), { status: outcome === '5xx' ? 503 : 200 });
    });
    await client.login({ email: 'a@example.test', password: 'test-only' }); getLobbyInvalidation(client).subscribe(() => invalidations++);
    if (outcome === 'success') assert.equal((await client.updateLobby(lobby.id, { title: 'New' })).title, 'New');
    else await assert.rejects(client.updateLobby(lobby.id, { title: 'New' }));
    assert.equal(writes, 2); assert.equal(refreshes, 1); assert.equal(invalidations, 1); assert.deepEqual(bodies, [{ title: 'New' }, { title: 'New' }]);
  }
  const pending = deferred(); let logins = 0, invalidations = 0;
  const client = creationClient(async url => url.endsWith('/auth/login') ? authReply(++logins, String(logins)) : pending.promise);
  await client.login({ email: 'a@example.test', password: 'test-only' }); getLobbyInvalidation(client).subscribe(() => invalidations++);
  const old = client.updateLobby(lobby.id, { title: 'Old account' }); const rejected = assert.rejects(old, error => error.code === 'INVALID_REFRESH_TOKEN');
  await flush(); await client.login({ email: 'b@example.test', password: 'test-only' }); pending.resolve(new Response(JSON.stringify(editableLobby()))); await rejected; assert.equal(invalidations, 0);
});

test('confirmed edit refreshes all/mine/full mine/search/inbox and rejects every old page', async () => {
  let edited = false; const late = deferred();
  const client = creationClient(async (url, options) => {
    if (url.endsWith('/auth/login')) return authReply(1);
    if (options.method === 'PATCH') { edited = true; return new Response(JSON.stringify({ ...editableLobby(), title: 'New title' })); }
    if (new URL(url).searchParams.has('after')) return late.promise;
    const row = { ...editableLobby(), title: edited ? 'New title' : 'Old title' };
    return new Response(JSON.stringify(page(url.includes('/chats') ? [{ ...chatRow(lobby.id), lobby: { id: row.id, title: row.title, category: row.category } }] : edited && new URL(url).searchParams.get('q') ? [] : [row], edited ? null : 'old')));
  });
  await client.login({ email: 'a@example.test', password: 'test-only' });
  const feeds = ['all','mine','mine'].map(scope => new LobbyFeedStore(after => client.listLobbies(after, scope)));
  const search = new searchLogic.LobbySearchStore((_q, after) => client.listLobbies(after, 'all', 'Old title'));
  const inbox = new inboxLogic.LiveChatInboxStore(after => client.listChats(after));
  const stores = [...feeds, search, inbox], channel = getLobbyInvalidation(client);
  for (const store of stores) { store.setAccount('A'); channel.subscribe(store === inbox ? store.invalidate : store.reload); }
  await flush(); const oldPages = stores.map(store => store.loadMore()); await client.updateLobby(lobby.id, { title: 'New title' }); await flush();
  late.resolve(new Response(JSON.stringify(page([editableLobby()])))); await Promise.all(oldPages); await flush();
  for (const feed of feeds) assert.equal(feed.getSnapshot().items[0].title, 'New title');
  assert.deepEqual(search.getSnapshot().items, []); assert.equal(inbox.getSnapshot().items[0].lobby.title, 'New title');
});
function cancelHost(api = {}, extra = {}) {
  let now = Date.now(), closes = 0, notices = 0;
  const auth = { user: { id: 'A' }, lobbyApi: { getLobby: async () => ({ ...lobby, isOrganizer: true, isJoined: true, membershipStatus: 'JOINED' }), ...api } };
  const h = host(auth), { LiveLobbyDetails } = h.load('src/features/home/LiveLobbyDetails.tsx', { './HomeExperienceProvider': { useHomeClock: () => now }, ...extra });
  const props = { id: lobby.id, onClose() { closes++; }, onCancelled() { notices++; } };
  return { h, auth, props, render: () => h.render(LiveLobbyDetails, props), clock: n => { now = n; }, result: () => ({ closes, notices }) };
}

test('cancel belongs only to organizer, confirms in the same Modal and declining never sends POST', async () => {
  let calls = 0;
  const c = cancelHost({ cancelLobby: async () => { calls++; return cancelledReceipt(); } });
  c.render(); await flush(); byId(c.render(), 'cancel-open').props.onPress();
  assert.equal(nodes(c.render()).filter(n => n.type === 'Modal').length, 1);
  assert.match(texts(c.render()), /demo.pizza/); assert.match(texts(c.render()), /Восстановление.*не предусмотрено/);
  assert.equal(calls, 0); byId(c.render(), 'cancel-decline').props.onPress();
  assert.equal(byId(c.render(), 'cancel-confirmation'), undefined); assert.equal(calls, 0);
  c.clock(Date.parse(lobby.startsAt)); assert.equal(byId(c.render(), 'cancel-open').props.disabled, true); assert.ok(byId(c.render(), 'cancel-started'));
  c.h.unmount();
  const other = cancelHost({ getLobby: async () => ({ ...lobby, isJoined: true, membershipStatus: 'JOINED' }) });
  other.render(); await flush(); assert.equal(byId(other.render(), 'cancel-open'), undefined); other.h.unmount();
});

test('cancel double presses lock synchronously, block old membership handler and notify/close only on exact receipt', async () => {
  const pending = deferred(); let calls = 0, joins = 0;
  const c = cancelHost({ cancelLobby: () => { calls++; return pending.promise; }, joinLobby: async () => { joins++; return lobby; } });
  c.render(); await flush(); const oldMembership = byId(c.render(), 'membership-action').props.onPress;
  byId(c.render(), 'cancel-open').props.onPress(); const confirm = byId(c.render(), 'cancel-confirm').props.onPress;
  confirm(); confirm(); oldMembership(); assert.equal(calls, 1); assert.equal(joins, 0); assert.ok(byId(c.render(), 'cancel-busy'));
  assert.deepEqual(c.result(), { closes: 0, notices: 0 }); pending.resolve(cancelledReceipt()); await flush(); c.render(); c.render();
  assert.deepEqual(c.result(), { closes: 1, notices: 1 }); assert.equal(byId(c.render(), 'cancel-open'), undefined); c.h.unmount();
});

test('lost cancel response plus GET404 is not success; same-target retry remains available after startsAt and confirms POST200', async () => {
  for (const failure of ['network', '5xx', 'wrong-id', 'wrong-status']) {
    const c = cancelHost(); let calls = 0;
    c.auth.lobbyApi.cancelLobby = async id => {
      assert.equal(id, lobby.id); calls++;
      if (calls > 1) return cancelledReceipt();
      if (failure === 'wrong-id') return { id: 'other', status: 'CANCELLED' };
      if (failure === 'wrong-status') return { id, status: 'PUBLISHED' };
      throw new ApiClientError({ statusCode: failure === '5xx' ? 503 : 0, code: failure === '5xx' ? 'HTTP_503' : 'NETWORK_ERROR', message: 'lost' });
    };
    c.render(); await flush(); byId(c.render(), 'cancel-open').props.onPress();
    c.auth.lobbyApi.getLobby = async () => { throw new ApiClientError({ statusCode: 404, code: 'LOBBY_NOT_FOUND', message: 'missing' }); };
    byId(c.render(), 'cancel-confirm').props.onPress(); await flush();
    assert.ok(byId(c.render(), 'lobby-details-error')); assert.ok(byId(c.render(), 'cancel-error'));
    assert.equal(byId(c.render(), 'live-lobby-description'), undefined); assert.deepEqual(c.result(), { closes: 0, notices: 0 });
    c.clock(Date.parse(lobby.startsAt) + 1);
    const retry = byId(c.render(), 'cancel-confirm'); assert.equal(retry.props.disabled, false); assert.equal(texts(retry), 'Повторить отмену');
    retry.props.onPress(); await flush(); c.render(); assert.deepEqual(c.result(), { closes: 1, notices: 1 }); assert.equal(calls, 2); c.h.unmount();
  }
});

test('pending cancel survives stalled verification and old GETs; retry does not wait for GET or restore its DTO', async () => {
  const late = deferred(); let calls = 0;
  const api = { getLobby: async () => ({ ...lobby, isOrganizer: true }), cancelLobby: async () => { if (++calls === 1) throw Error('lost'); return cancelledReceipt(); } };
  const store = new LobbyDetailsStore(api); store.setContext('A', lobby.id); await flush(); store.requestCancel();
  api.getLobby = () => late.promise; await store.confirmCancel(); assert.equal(store.getSnapshot().loading, true);
  await store.confirmCancel(); assert.equal(store.getSnapshot().cancelled, true);
  late.resolve(lobby); await flush(); assert.equal(store.getSnapshot().lobby, null); assert.equal(store.getSnapshot().cancelled, true);
});

test('late cancel success/rejection after account/logout/lobby/unmount never closes or notifies a newer context', async () => {
  for (const transition of ['account', 'logout', 'lobby', 'unmount']) for (const fail of [false, true]) {
    const late = deferred(); const c = cancelHost({ cancelLobby: () => late.promise });
    c.render(); await flush(); byId(c.render(), 'cancel-open').props.onPress(); byId(c.render(), 'cancel-confirm').props.onPress();
    if (transition === 'account') c.auth.user = { id: 'B' };
    if (transition === 'logout') c.auth.user = null;
    if (transition === 'lobby') c.props.id = 'new-lobby';
    if (transition === 'unmount') c.h.unmount(); else assert.equal(byId(c.render(), 'cancel-confirmation'), undefined);
    if (fail) late.reject(Error('old')); else late.resolve(cancelledReceipt()); await flush();
    if (transition !== 'unmount') c.render(); assert.deepEqual(c.result(), { closes: 0, notices: 0 }); c.h.unmount();
  }
});

test('cancel error codes have RU/EN reasons and crossing startsAt disables an unsubmitted confirmation', async () => {
  for (const [code, key] of [['LOBBY_STARTED','cancel.started'], ['LOBBY_ORGANIZER_REQUIRED','cancel.organizerRequired'], ['LOBBY_NOT_FOUND','cancel.notFound']]) {
    const c = cancelHost({ cancelLobby: async () => { throw new ApiClientError({ statusCode: 409, code, message: code }); } });
    c.render(); await flush(); byId(c.render(), 'cancel-open').props.onPress(); byId(c.render(), 'cancel-confirm').props.onPress(); await flush();
    assert.equal(texts(byId(c.render(), 'cancel-error')), createTranslator('ru')(key)); assert.notEqual(createTranslator('en')(key), createTranslator('ru')(key)); c.h.unmount();
  }
  const c = cancelHost(); c.render(); await flush(); byId(c.render(), 'cancel-open').props.onPress(); c.clock(Date.parse(lobby.startsAt));
  assert.equal(byId(c.render(), 'cancel-confirm').props.disabled, true); assert.ok(byId(c.render(), 'cancel-started')); c.h.unmount();
});

test('cancel transport is bounded, validates receipt and invalidates only current session on success/uncertainty', async () => {
  for (const mode of ['success', 'auth-retry', 'network', '5xx', 'invalid', 'wrong-id']) {
    let calls = 0, rotations = 0, invalidations = 0;
    const client = creationClient(async (url, options) => {
      if (url.endsWith('/auth/login')) return authReply(1);
      if (url.endsWith('/auth/refresh')) { rotations++; return authReply(2); }
      calls++; assert.ok(url.endsWith(`/lobbies/${lobby.id}/cancel`)); assert.equal(options.method, 'POST'); assert.equal(options.body, undefined);
      if (mode === 'auth-retry' && calls === 1) return new Response(JSON.stringify({ error: { code: 'INVALID_ACCESS_TOKEN', message: 'expired' } }), { status: 401 });
      if (mode === 'network') throw Error('offline');
      if (mode === '5xx') return new Response('{}', { status: 503 });
      return new Response(JSON.stringify(mode === 'invalid' ? {} : mode === 'wrong-id' ? { id: 'other', status: 'CANCELLED' } : cancelledReceipt()));
    });
    await client.login({ email: 'a@example.test', password: 'test-only' }); getLobbyInvalidation(client).subscribe(() => { invalidations++; });
    if (mode === 'success' || mode === 'auth-retry') assert.deepEqual(await client.cancelLobby(lobby.id), cancelledReceipt());
    else await assert.rejects(client.cancelLobby(lobby.id));
    assert.equal(calls, mode === 'auth-retry' ? 2 : 1); assert.equal(rotations, mode === 'auth-retry' ? 1 : 0); assert.equal(invalidations, 1);
  }
  const late = deferred(); let logins = 0, invalidations = 0;
  const client = creationClient(async url => url.endsWith('/auth/login') ? authReply(++logins) : late.promise);
  await client.login({ email: 'a@example.test', password: 'test-only' }); getLobbyInvalidation(client).subscribe(() => { invalidations++; });
  const call = client.cancelLobby(lobby.id); const rejected = assert.rejects(call, e => e.code === 'INVALID_REFRESH_TOKEN');
  await client.login({ email: 'b@example.test', password: 'test-only' }); late.resolve(new Response(JSON.stringify(cancelledReceipt()))); await rejected;
  assert.equal(invalidations, 0);
});

test('cancel invalidation updates all independent feeds/search/inbox/chat and rejects every old page', async () => {
  let cancelled = false; const late = deferred();
  const client = creationClient(async (url, options) => {
    if (url.endsWith('/auth/login')) return authReply(1);
    if (options.method === 'POST') { cancelled = true; return new Response(JSON.stringify(cancelledReceipt())); }
    if (new URL(url).searchParams.has('after') || new URL(url).searchParams.has('before')) return late.promise;
    if (url.includes('/messages')) return new Response(JSON.stringify(cancelled ? { error: { code: 'LOBBY_NOT_FOUND', message: 'unavailable' } } : page([message()], 'old')), { status: cancelled ? 404 : 200 });
    return new Response(JSON.stringify(page(cancelled ? [] : url.includes('/chats') ? [chatRow(lobby.id)] : [lobby], cancelled ? null : 'old')));
  });
  await client.login({ email: 'a@example.test', password: 'test-only' });
  const feeds = ['all','mine','mine'].map(scope => new LobbyFeedStore(after => client.listLobbies(after, scope)));
  const search = new searchLogic.LobbySearchStore((q, after) => client.listLobbies(after, 'all', q));
  const inbox = new inboxLogic.LiveChatInboxStore(after => client.listChats(after));
  const chat = new LiveLobbyChatStore(client, () => 'send-id');
  const stores = [...feeds, search, inbox]; const channel = getLobbyInvalidation(client);
  for (const store of stores) { store.setAccount('A'); channel.subscribe(store === inbox ? store.invalidate : store.reload); }
  chat.setContext('A', lobby.id); channel.subscribe(chat.invalidate); await flush();
  const oldPages = [...stores.map(store => store.loadMore()), chat.loadOlder()];
  await client.cancelLobby(lobby.id); await flush();
  late.resolve(new Response(JSON.stringify(page([lobby])))); await Promise.all(oldPages); await flush();
  for (const store of stores) assert.deepEqual(store.getSnapshot().items, []);
  assert.deepEqual(chat.getSnapshot().items, []); assert.equal(chat.getSnapshot().blocked, true);
});

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

test('actual details load by id, preserve user description and require JOINED for chat', async () => {
  const pending = deferred(); let selected;
  const auth = { user: { id: 'A' }, lobbyApi: { getLobby: id => { selected = id; return pending.promise; } } };
  const h = host(auth); const { LiveLobbyDetails } = h.load('src/features/home/LiveLobbyDetails.tsx');
  const render = () => h.render(LiveLobbyDetails, { id: lobby.id, onClose() {} });
  assert.ok(byId(render(), 'lobby-details-loading')); assert.equal(selected, lobby.id);
  pending.resolve(lobby); await flush();
  const tree = render();
  assert.equal(texts(byId(tree, 'live-lobby-description')), lobby.description);
  assert.equal(texts(byId(tree,'membership-action')), 'Вступить в лобби');
  assert.equal(byId(tree,'membership-action').props.disabled, false);
  for (const label of ['Чат доступен только вступившим участникам']) {
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
  assert.doesNotMatch(home, /lobbies\.demo/);
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

const draft = () => ({ title: '  My new lobby  ', description: '  User text  ', category: 'FOOD',
  date: '2201-01-01', time: '19:00', capacity: '6', isOnline: false, venueName: '  Actual venue  ' });

test('Bishkek date conversion is explicit, supports leap days and rejects normalized/impossible dates', () => {
  assert.equal(bishkekDateTimeToInstant('2032-02-29', '00:30'), '2032-02-28T18:30:00.000Z');
  for (const [date, time] of [['2030-02-29','12:00'], ['2030-04-31','12:00'], ['2030-13-01','12:00'],
    ['2030-01-01','24:00'], ['2030-01-01','12:60'], ['2030-1-01','01:00'], ['0000-01-01','12:00'], ['+275760-09-13','00:00']]) {
    assert.equal(bishkekDateTimeToInstant(date, time), null);
  }
});

test('conversion is independent of the host timezone in separate Node processes', () => {
  const { spawnSync } = require('node:child_process');
  const modulePath = require.resolve('../.expo/lobby-tests/features/home/createLobbyForm.js');
  for (const TZ of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
    const result = spawnSync(process.execPath, ['-e', `process.stdout.write(require(${JSON.stringify(modulePath)}).bishkekDateTimeToInstant('2201-01-01','19:00'))`], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.equal(result.status, 0); assert.equal(result.stdout, '2201-01-01T13:00:00.000Z');
  }
});

test('form validates trimmed strings, time, capacity, category and conditional venue before POST', () => {
  const expected = { title: 'My new lobby', description: 'User text', category: 'FOOD', startsAt: '2201-01-01T13:00:00.000Z', timeZone: 'Asia/Bishkek', capacity: 6, isOnline: false, venueName: 'Actual venue' };
  assert.deepEqual(validateLobbyForm(draft()), expected);
  assert.equal(validateLobbyForm({ ...draft(), isOnline: true, venueName: '' }).venueName, null);
  for (const [change, key] of [
    [{title:'  '}, 'title'], [{title:'x'.repeat(41)}, 'title'], [{description:'\n'}, 'description'], [{description:'x'.repeat(201)}, 'description'],
    [{category:'invalid'}, 'category'], [{date:'2000-01-01'}, 'schedule'], [{date:'2201-02-30'}, 'schedule'],
    ...['1','2.5','2147483648','2e2','', '-2'].map(capacity => [{capacity}, 'capacity']),
    [{venueName:'  '}, 'venue'], [{venueName:'x'.repeat(141)}, 'venue'],
  ]) assert.equal(validateLobbyForm({ ...draft(), ...change }), 'create.error.' + key);
});

test('double submit is synchronously locked, and success remains locked until navigation', async () => {
  const pending = deferred(); const submitted = []; const created = [];
  const store = new CreateLobbyFormStore(input => { submitted.push(input); return pending.promise; }, id => created.push(id));
  store.setAccount('A'); store.update(draft());
  const first = store.submit(); await store.submit();
  assert.equal(submitted.length, 1); assert.equal(store.getSnapshot().submitting, true);
  pending.resolve(lobby); await first; await store.submit();
  assert.deepEqual(created, [lobby.id]); assert.equal(submitted.length, 1);
});

test('an ambiguous POST error retains every field and warns about possible creation without automatic retry', async () => {
  let count = 0;
  const store = new CreateLobbyFormStore(async () => { count++; throw new ApiClientError({code:'NETWORK_ERROR', statusCode:0, message:'offline'}); }, () => assert.fail('unexpected navigation'));
  store.setAccount('A'); store.update(draft()); await store.submit(); await flush();
  assert.deepEqual(store.getSnapshot().fields, draft());
  assert.equal(store.getSnapshot().error, 'create.error.unconfirmed');
  assert.equal(store.getSnapshot().submitting, false); assert.equal(count, 1);
  await store.submit(); assert.equal(count, 2, 'Only an explicit second submit can send again');
});

test('late creation success/failure after logout or account switch cannot navigate or alter the new draft', async () => {
  for (const account of [null, 'B']) for (const fails of [false, true]) {
    const pending = deferred(); const created = [];
    const store = new CreateLobbyFormStore(() => pending.promise, id => created.push(id));
    store.setAccount('A'); store.update(draft()); const inFlight = store.submit();
    store.setAccount(account); if (account) store.update({title:'B draft'});
    fails ? pending.reject(new Error('late failure')) : pending.resolve(lobby);
    await inFlight;
    assert.deepEqual(created, []); assert.equal(store.getSnapshot().error, null);
    assert.equal(store.getSnapshot().fields.title, account ? 'B draft' : '');
  }
});

const screenMocks = auth => ({
  '../auth/AuthProvider': {useAuth: () => auth},
  '../components/Primitives': {IconButton:'IconButton', SectionHeader:'SectionHeader'},
  '../components/Screen': {Screen:'Screen'},
  '../i18n/LocalizationProvider': {useI18n: () => ({t:createTranslator('ru'),language:'ru'})},
  '../theme': {colors:{},radius:{}},
  '../features/home/createLobbyForm': createForm,
});

test('actual Create screen inputs, validation, categories, online toggle, submit lock and retained draft work', async () => {
  let pending = deferred(); const sent = []; const created = [];
  const auth = {status:'authenticated', user:{id:'A'}, lobbyApi:{createLobby: input => {sent.push(input);return pending.promise;}}};
  const h = host(auth); const {CreateLobbyScreen} = h.load('src/screens/CreateLobbyScreen.tsx', screenMocks(auth));
  const props = {onClose(){},onCreated:id=>created.push(id)};
  const render = () => h.render(CreateLobbyScreen, props);
  render(); byId(render(), 'create-submit').props.onPress(); await flush();
  assert.match(texts(byId(render(),'create-error')), /название/); assert.equal(sent.length,0);
  for (const [id,value] of Object.entries({title:'My title',description:'My description',date:'2201-01-01',time:'19:00',capacity:'4',venue:'Venue'})) {
    byId(render(),'create-'+id).props.onChangeText(value);
  }
  byId(render(),'create-category-GAMING').props.onPress();
  byId(render(),'create-online').props.onPress(); assert.equal(byId(render(),'create-venue'),undefined);
  assert.match(texts(byId(render(),'create-timezone')),/Asia\/Bishkek/);
  const submit = byId(render(),'create-submit').props.onPress;
  submit(); submit(); assert.equal(sent.length,1); assert.equal(sent[0].venueName,null); assert.equal(sent[0].category,'GAMING');
  assert.equal(byId(render(),'create-submit').props.disabled,true);
  pending.reject(new Error('lost response')); await flush();
  assert.equal(byId(render(),'create-title').props.value,'My title'); assert.ok(byId(render(),'create-error'));
  pending = deferred(); byId(render(),'create-submit').props.onPress(); pending.resolve(lobby); await flush();
  assert.deepEqual(created,[lobby.id]); h.unmount();
});

test('actual Create screen ignores late callbacks after an account switch or unmount', async () => {
  for (const switchAccount of [true,false]) {
    const pending = deferred(); const created = [];
    const auth = {status:'authenticated',user:{id:'A'},lobbyApi:{createLobby:()=>pending.promise}};
    const h = host(auth); const {CreateLobbyScreen} = h.load('src/screens/CreateLobbyScreen.tsx',screenMocks(auth));
    const props = {onClose(){},onCreated:id=>created.push(id)};
    const render = () => h.render(CreateLobbyScreen,props);
    render();
    for (const [id,value] of Object.entries({title:'A title',description:'A description',date:'2201-01-01',time:'19:00',venue:'Venue'})) byId(render(),'create-'+id).props.onChangeText(value);
    byId(render(),'create-submit').props.onPress();
    if (switchAccount) {auth.user={id:'B'};assert.equal(byId(render(),'create-title').props.value,'');} else h.unmount();
    pending.resolve(lobby); await flush(); assert.deepEqual(created,[]);
    if (switchAccount) {assert.equal(byId(render(),'create-title').props.value,'');h.unmount();}
  }
});

test('actual App creation callback navigates Home, reloads both scopes and opens the returned id independently of catalog page', async () => {
  const h = host({});
  const components = Object.fromEntries(['ActivityScreen','AuthScreen','CreateLobbyScreen','HomeScreen','MomentsScreen','ProfileScreen'].map(name => ['./src/screens/'+name, {[name]:name,AuthLoadingScreen:'AuthLoadingScreen'}]));
  const {PartyMaker} = h.load('App.tsx', {
    ...components,
    'react-native-gesture-handler': {GestureHandlerRootView:'Root'},
    './src/auth/AuthProvider': {AuthProvider:'AuthProvider',useAuth:()=>({})},
    './src/components/BottomNav': {BottomNav:'BottomNav'},
    './src/i18n/LocalizationProvider': {LocalizationProvider:'LocalizationProvider'},
    './src/features/home/HomeExperienceProvider': {HomeExperienceProvider:'HomeExperienceProvider'},
    './src/features/chats/MockChatProvider': {MockChatProvider:'MockChatProvider'},
    './src/navigation/NavScrollContext': {NavScrollContext:{Provider:'NavScrollContext'}},
    './src/theme': {colors:{}},
  }, 'PartyMaker');
  const render = () => h.render(PartyMaker,{});
  nodes(render()).find(n=>n.type==='BottomNav').props.onChange('create');
  nodes(render()).find(n=>n.type==='CreateLobbyScreen').props.onCreated(lobby.id);
  const home = nodes(render()).find(n=>n.type==='HomeScreen'); assert.equal(home.props.initialLobbyId,lobby.id);
  const homeHost = host({});
  const {HomeScreen} = homeHost.load('src/screens/HomeScreen.tsx',{
    ...screenMocks({}),
    '@expo-google-fonts/outfit/600SemiBold':{Outfit_600SemiBold:{}},'expo-font':{useFonts:()=>[true]},
    '../assets':{photos:{}},'../components/icons/PartyIcon':{PartyIcon:'PartyIcon'},
    '../features/chats/LiveChatsModal':{LiveChatsModal:'LiveChatsModal'},
    '../features/home/HomeExperienceProvider':{useHomeExperience:()=>({session:{}})},
    '../features/home/LobbyExtroversionIndicator':{LobbyExtroversionIndicator:'LobbyExtroversionIndicator'},
    '../features/home/LobbyCountdown':{LobbyCountdown:'LobbyCountdown'},
    '../features/home/LiveLobbyFeed':{LiveLobbyFeed:'LiveLobbyFeed'},
    '../features/home/LiveLobbyDetails':{LiveLobbyDetails:'LiveLobbyDetails'},
    './PersonalLobbiesScreen':{PersonalLobbiesScreen:'PersonalLobbiesScreen'},
    '../features/home/lobbies':{demoLobbies:[],getJoinedLobbies:()=>[]},
    '../features/search/SearchModal':{SearchModal:'SearchModal'},
  });
  const tree = homeHost.render(HomeScreen,home.props);
  assert.equal(nodes(tree).find(n=>n.type==='LiveLobbyDetails').props.id,lobby.id);
  assert.ok(nodes(tree).find(n=>n.type==='LiveLobbyFeed'),'Fresh feed mounted; no synthetic insertion/reordering');
  const calls = [];
  for (const feed of nodes(tree).filter(n=>n.type==='LiveLobbyFeed')) {
    const feedHost = host({status:'authenticated', user:{id:'A'}, lobbyApi:{listLobbies:async (after,scope)=>{calls.push({after,scope});return page([lobby]);}}});
    const {LiveLobbyFeed} = feedHost.load('src/features/home/LiveLobbyFeed.tsx');
    feedHost.render(LiveLobbyFeed,feed.props); await flush();
    assert.equal(nodes(feedHost.render(LiveLobbyFeed,feed.props)).find(n=>n.type==='LiveLobbyCard').props.lobby.id,lobby.id);
    feedHost.unmount();
  }
  assert.deepEqual(calls,[{after:undefined,scope:'all'},{after:undefined,scope:'mine'}]);
  assert.equal(nodes(render()).find(n=>n.type==='HomeScreen').props.initialLobbyId,null,'Navigation intent consumed, not reopened on later visits');
  homeHost.unmount();h.unmount();
});

function creationClient(handler) {
  let token = null;
  return new ApiClient({baseUrl:()=> 'http://api.test/api/v1',refreshTokenStorage:{async get(){return token;},async set(v){token=v;},async clear(){token=null;}},fetchImpl:handler});
}
const authReply = (n, userId = 'A') => new Response(JSON.stringify({user:{id:userId},accessToken:'access-'+n,refreshToken:'refresh-'+n}));

const message = (id = 'm1', body = 'Real text <b>not HTML</b>', extra = {}) => ({
  id, lobbyId: lobby.id, body, createdAt: '2026-01-01T12:00:00.000Z', author: { id: 'A', displayName: 'Автор', handle: 'author' }, ...extra,
});
const chatError = statusCode => new ApiClientError({ statusCode, code: statusCode === 403 ? 'LOBBY_CHAT_FORBIDDEN' : 'LOBBY_NOT_FOUND', message: 'denied' });
function chatHost(api) {
  const auth = { user: { id: 'A' }, lobbyApi: api }, h = host(auth);
  const { LiveLobbyChatScreen } = h.load('src/features/chats/LiveLobbyChatScreen.tsx');
  const props = { lobbyId: lobby.id, title: lobby.title, onBack() {}, onAccessLost() {} };
  return { auth, h, props, render: () => h.render(LiveLobbyChatScreen, props) };
}
// Inverted data is newest first; return visual chronological order to assertions.
const history = tree => [...byId(tree, 'live-chat-history').props.data].reverse();

const chatRow = (id='chat-a', preview=null) => ({ lobby:{id,title:'Real lobby '+id,category:'SPORT'},activityAt:'2026-01-01T00:00:00.000Z',
  lastMessage: preview===null ? null : {id:'message-'+id,preview,createdAt:'2026-01-01T00:00:00.000Z',author:{id:'A',displayName:'Real author'}} });
function mountInbox(api, onClose=()=>{}) {
  const auth={user:{id:'A'},lobbyApi:api}, h=host(auth), screenHost=host(auth);
  const {LiveChatsModal}=h.load('src/features/chats/LiveChatsModal.tsx');
  const {LiveChatsScreen}=screenHost.load('src/features/chats/LiveChatsScreen.tsx');
  const modal=()=>h.render(LiveChatsModal,{onClose});
  const listProps=()=>nodes(modal()).find(n=>n.type==='SwipeBackPage'&&n.props.name==='chats').props.children(onClose,{}).props;
  const screen=()=>screenHost.render(LiveChatsScreen,listProps());
  const rows=()=>byId(screen(),'inbox-list').props.data;
  const rowButton=(id)=>byId(screen(),'inbox-list').props.renderItem({item:rows().find(row=>row.lobby.id===id)});
  const conversation=()=>{
    const swipe=nodes(modal()).find(n=>n.type==='SwipeBackPage'&&n.props.name==='conversation');
    return swipe ? nodes(swipe.props.children(swipe.props.onClose,{})).find(n=>n.type==='LiveLobbyChatScreen') : null;
  };
  return {auth,h,modal,screen,rows,rowButton,conversation};
}
test('real inbox renders loading/empty/error/retry and safe literal rows without demo/unread/group counters',async()=>{
  let result=deferred(); const c=mountInbox({listChats:()=>result.promise});
  assert.ok(byId(c.screen(),'inbox-loading')); result.reject(Error('offline'));await flush();
  assert.ok(byId(c.screen(),'inbox-error'));assert.deepEqual(c.rows(),[]);
  result=deferred();byId(c.screen(),'inbox-retry').props.onPress();result.resolve(page());await flush();
  assert.ok(byId(c.screen(),'inbox-empty'));
  result=deferred();byId(c.screen(),'inbox-refresh').props.onPress();result.resolve(page([chatRow(),chatRow('b','<b>plain 🎉</b>')]));await flush();
  assert.match(texts(c.rowButton('chat-a')),/Сообщений пока нет/);
  assert.match(texts(c.rowButton('b')),/Real author: <b>plain 🎉<\/b>/);
  assert.doesNotMatch(texts(c.screen()),/демо|непрочитан|активные|неактивные/i);
  assert.equal(nodes(c.rowButton('b')).some(n=>n.type==='Image'||n.type==='ChatStatusDot'),false);
  assert.equal(nodes(c.rowButton('b')).find(n=>n.type==='LobbyCategoryPlaceholder').props.category,'SPORT');c.h.unmount();
});
test('inbox pagination coalesces presses, keeps rows/cursor on failure, retries and deduplicates by lobbyId',async()=>{
  let next=deferred();const calls=[];
  const c=mountInbox({listChats:async after=>{calls.push(after);return after?next.promise:page([chatRow()],'cursor');}});
  c.screen();await flush();const more=()=>byId(byId(c.screen(),'inbox-list').props.ListFooterComponent,'inbox-more');
  const press=more().props.onPress;press();press();assert.equal(calls.length,2);assert.equal(more().props.disabled,true);
  next.reject(Error('offline'));await flush();assert.equal(c.rows().length,1);assert.ok(more());
  next=deferred();byId(c.screen(),'inbox-retry').props.onPress();next.resolve(page([chatRow(),chatRow('b')]));await flush();
  assert.deepEqual(c.rows().map(r=>r.lobby.id),['chat-a','b']);assert.deepEqual(calls,[undefined,'cursor','cursor']);c.h.unmount();
});
test('Home airplane -> real inbox -> conversation -> inbox -> Home, all in one Modal with correct back source',async()=>{
  const h=host({}),{HomeScreen}=h.load('src/screens/HomeScreen.tsx',{
    ...personalScreenMocks({}),'@expo-google-fonts/outfit/600SemiBold':{Outfit_600SemiBold:{}},'expo-font':{useFonts:()=>[true]},
    '../components/icons/PartyIcon':{PartyIcon:'PartyIcon'},'../features/chats/LiveChatsModal':{LiveChatsModal:'LiveChatsModal'},
    '../features/search/SearchModal':{SearchModal:'SearchModal'},'./PersonalLobbiesScreen':{PersonalLobbiesScreen:'PersonalLobbiesScreen'},
  });
  const home=()=>h.render(HomeScreen,{}); assert.equal(byId(home(),'open-chats').props.accessibilityLabel,'Открыть чаты');
  byId(home(),'open-chats').props.onPress();const route=nodes(home()).find(n=>n.type==='LiveChatsModal');assert.ok(route);
  const c=mountInbox({listChats:async()=>page([chatRow()])},route.props.onClose);c.screen();await flush();
  c.rowButton('chat-a').props.onPress();assert.equal(nodes(c.modal()).filter(n=>n.type==='Modal').length,1);
  const chat=c.conversation();assert.equal(chat.props.lobbyId,'chat-a');assert.equal(chat.props.backLabel,'К чатам');
  assert.equal(nodes(c.modal()).find(n=>n.type==='SwipeBackPage'&&n.props.name==='chats').props.active,false);
  const conversationSwipe=nodes(c.modal()).find(n=>n.type==='SwipeBackPage'&&n.props.name==='conversation');assert.equal(conversationSwipe.props.edgeOnly,true);
  chat.props.onBack();await flush();assert.equal(c.conversation(),null);byId(c.screen(),'inbox-back').props.onPress();
  assert.equal(nodes(home()).find(n=>n.type==='LiveChatsModal'),undefined);c.h.unmount();h.unmount();
});
test('sending refetches inbox preview/order without global invalidation or disturbing a pending conversation',async()=>{
  const send=deferred();let saved=false,reads=0;
  const api={listChats:async()=>{reads++;return page(saved?[chatRow('b','saved'),chatRow()]:[chatRow(),chatRow('b')]);},
    listLobbyMessages:async()=>page(),sendLobbyMessage:async(_id,input)=>{await send.promise;saved=true;return message(input.clientMessageId,input.body);}};
  const c=mountInbox(api);c.screen();await flush();c.rowButton('b').props.onPress();
  const child=host(c.auth),{LiveLobbyChatScreen}=child.load('src/features/chats/LiveLobbyChatScreen.tsx');
  const chat=()=>child.render(LiveLobbyChatScreen,c.conversation().props);chat();await flush();
  byId(chat(),'live-chat-draft').props.onChangeText('saved');byId(chat(),'live-chat-send').props.onPress();
  // An independent inbox Refresh while send is pending must not invalidate chat state.
  const initialReads=reads; c.conversation().props.onSent();await flush();assert.equal(reads,initialReads+1);assert.ok(byId(chat(),'live-chat-sending'));
  send.resolve();await flush();assert.equal(history(chat()).length,1);assert.deepEqual(c.rows().map(r=>r.lobby.id),['b','chat-a']);
  assert.equal(c.rows()[0].lastMessage.preview,'saved');c.conversation().props.onBack();await flush();assert.ok(reads>=initialReads+3);
  child.unmount();c.h.unmount();
});
test('membership invalidation and access loss remove unavailable inbox rows; late pages cannot resurrect them',async()=>{
  const late=deferred();let joined=true;
  const api={listChats:async after=>after?late.promise:page(joined?[chatRow()]:[],joined?'page':null)};
  const c=mountInbox(api);c.screen();await flush();
  byId(byId(c.screen(),'inbox-list').props.ListFooterComponent,'inbox-more').props.onPress();
  c.rowButton('chat-a').props.onPress();joined=false;c.conversation().props.onAccessLost();
  assert.deepEqual(c.rows(),[]);await flush();late.resolve(page([chatRow()]));await flush();assert.deepEqual(c.rows(),[]);
  assert.ok(c.conversation(),'Denied conversation stays visible with its own return/error UI');
  c.conversation().props.onBack();await flush();joined=true;getLobbyInvalidation(api).invalidate();await flush();assert.equal(c.rows().length,1);
  joined=false;getLobbyInvalidation(api).invalidate();assert.deepEqual(c.rows(),[]);await flush();assert.deepEqual(c.rows(),[]);c.h.unmount();
});
test('inbox drops late reload/page success or failure after newer reload, account/logout or unmount',async()=>{
  for(const operation of ['read','page'])for(const transition of ['reload','account','logout','unmount'])for(const fail of [false,true]){
    const late=deferred();let calls=0;
    const api={listChats:async()=>++calls===1?page([chatRow()],'cursor'):calls===2?late.promise:page([chatRow('new')])};
    const c=mountInbox(api);c.screen();await flush();
    if(operation==='read')byId(c.screen(),'inbox-refresh').props.onPress();
    else byId(byId(c.screen(),'inbox-list').props.ListFooterComponent,'inbox-more').props.onPress();
    if(transition==='account'){c.auth.user={id:'B'};assert.deepEqual(c.rows(),[]);}
    if(transition==='logout'){c.auth.user=null;assert.deepEqual(c.rows(),[]);}
    if(transition==='reload')getLobbyInvalidation(api).invalidate();
    if(transition==='unmount')c.h.unmount();
    await flush();if(fail)late.reject(Error('late'));else late.resolve(page([chatRow('old')]));await flush();
    if(transition!=='unmount'){assert.ok(!c.rows().some(r=>r.lobby.id==='old'));assert.equal(byId(c.screen(),'inbox-error'),undefined);}
    c.h.unmount();
  }
});
test('ApiClient inbox uses distinct authenticated route, encodes cursor and never substitutes mine',async()=>{
  const requests=[];const client=creationClient(async(url,options)=>{
    if(url.endsWith('/auth/login'))return authReply(1);requests.push({url:new URL(url),options});return new Response(JSON.stringify(page([chatRow()])));
  });
  await client.login({email:'test@example.test',password:'test-only'});await client.listChats('a/b+=');
  assert.equal(requests[0].url.pathname,'/api/v1/chats');assert.equal(requests[0].url.searchParams.get('limit'),'20');
  assert.equal(requests[0].url.searchParams.get('after'),'a/b+=');assert.equal(requests[0].url.searchParams.has('scope'),false);
  assert.equal(requests[0].options.headers.Authorization,'Bearer access-1');
});
test('actual long conversation starts at latest, reveals confirmed send, anchors older pages and does not jump on refresh',async()=>{
  const messages=Array.from({length:60},(_,i)=>message(String(i).padStart(3,'0'),'Long message '+i));
  let latest=page(messages.slice(30).reverse(),'older'); const sent=deferred();
  const c=chatHost({listLobbyMessages:async(_id,before)=>before?page(messages.slice(0,30).reverse()):latest,sendLobbyMessage:()=>sent.promise});
  const offsets=[];const list=()=>{const props=byId(c.render(),'live-chat-history').props;props.ref.current={scrollToOffset:({offset})=>offsets.push(offset)};return props;};
  list();await flush();assert.equal(list().inverted,true);assert.equal(list().data[0].id,'059');
  list().onLayout();list().onContentSizeChange(400,3600);assert.equal(offsets.at(-1),0);
  list().onScrollBeginDrag();list().onScroll({nativeEvent:{contentOffset:{y:2200}}});
  byId(list().ListFooterComponent,'live-chat-older').props.onPress();await flush();assert.equal(list().data.length,60);
  const before=offsets.length;list().onContentSizeChange(400,7200);assert.equal(offsets.length,before,'Appending older inverted rows leaves the exact reading offset unchanged');
  latest=page([message('060','external')],null);byId(c.render(),'live-chat-refresh').props.onPress();await flush();
  assert.equal(list().data.length,61,'Refresh retains loaded older history');list().onContentSizeChange(400,7320);
  assert.equal(offsets.at(-1),2320,'Compensate only new messages at the newest end, not jump to zero');
  byId(c.render(),'live-chat-draft').props.onChangeText('my confirmed message');byId(c.render(),'live-chat-send').props.onPress();
  assert.equal(offsets.at(-1),2320,'Pending send is not a delivered message');sent.resolve(message('061','my confirmed message'));await flush();
  list().onContentSizeChange(400,7440);assert.equal(offsets.at(-1),0);assert.equal(list().data[0].id,'061');c.h.unmount();
});

test('actual live chat loading/empty/error/retry and manual refresh contain no mock delivery', async () => {
  let response = deferred(), calls = 0;
  const c = chatHost({ listLobbyMessages: () => { calls++; return response.promise; } });
  assert.ok(byId(c.render(), 'live-chat-loading'));
  assert.deepEqual(history(c.render()), []);
  response.reject(new Error('offline')); await flush();
  assert.ok(byId(c.render(), 'live-chat-error')); assert.deepEqual(history(c.render()), []);
  response = deferred(); byId(c.render(), 'live-chat-retry').props.onPress();
  response.resolve(page()); await flush(); assert.ok(byId(c.render(), 'live-chat-empty'));
  response = deferred(); byId(c.render(), 'live-chat-refresh').props.onPress();
  response.resolve(page([message()])); await flush();
  assert.equal(history(c.render()).length, 1); assert.equal(calls, 3);
  const bubble = byId(c.render(), 'live-chat-history').props.renderItem({ item: message() });
  assert.equal(texts(byId(bubble, 'live-chat-message-body')), message().body);
  assert.match(texts(bubble), /Автор\s+· @\s*author/); assert.doesNotMatch(texts(bubble), /delivered|доставлено/i);
  c.h.unmount();
});
test('actual chat paginates before cursor, coalesces clicks and preserves history on page failure', async () => {
  const calls = []; let pending = deferred();
  const c = chatHost({ listLobbyMessages: async (id, before) => { calls.push([id, before]); return before ? pending.promise : page([message('m3'),message('m2')], 'older'); } });
  c.render(); await flush(); assert.deepEqual(history(c.render()).map(m => m.id), ['m2','m3']);
  const older = () => byId(byId(c.render(), 'live-chat-history').props.ListFooterComponent, 'live-chat-older');
  older().props.onPress(); older().props.onPress(); assert.equal(older().props.disabled, true);
  pending.reject(new Error('offline')); await flush();
  assert.deepEqual(history(c.render()).map(m => m.id), ['m2','m3']);
  pending = deferred(); byId(c.render(), 'live-chat-retry').props.onPress();
  pending.resolve(page([message('m2'),message('m1')])); await flush();
  assert.deepEqual(history(c.render()).map(m => m.id), ['m1','m2','m3']);
  assert.deepEqual(calls, [[lobby.id,undefined],[lobby.id,'older'],[lobby.id,'older']]); c.h.unmount();
});
test('actual send is single-flight; uncertain retry uses original UUID/body and preserves newer draft', async () => {
  let pending = deferred(); const calls = [];
  const c = chatHost({ listLobbyMessages: async () => page(), sendLobbyMessage: async (id, input) => { calls.push({ id, ...input }); return pending.promise; } });
  c.render(); await flush();
  byId(c.render(), 'live-chat-draft').props.onChangeText('  First text  ');
  const send = byId(c.render(), 'live-chat-send').props.onPress; send(); send();
  assert.equal(calls.length, 1); assert.ok(byId(c.render(), 'live-chat-sending')); assert.deepEqual(history(c.render()), []);
  pending.reject(new Error('lost response')); await flush();
  assert.equal(byId(c.render(), 'live-chat-draft').props.value, '  First text  ');
  assert.ok(byId(c.render(), 'live-chat-send-error'));
  byId(c.render(), 'live-chat-draft').props.onChangeText('New text typed later');
  pending = deferred(); const retry = byId(c.render(), 'live-chat-send-retry').props.onPress; retry(); retry();
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]); assert.equal(calls[1].body, 'First text');
  pending.resolve(message(calls[0].clientMessageId, 'First text')); await flush();
  assert.equal(history(c.render()).length, 1); assert.equal(byId(c.render(), 'live-chat-draft').props.value, 'New text typed later');
  assert.equal(byId(c.render(), 'live-chat-send').props.disabled, false); c.h.unmount();
});
test('valid send clears only unchanged draft; validation and UUID failure never issue POST', async () => {
  let calls = 0, ids = 0;
  const store = new LiveLobbyChatStore({ listLobbyMessages: async () => page(), sendLobbyMessage: async (_id, input) => { calls++; return message(input.clientMessageId, input.body); } }, () => { ids++; return 'uuid'; });
  store.setContext('A', lobby.id); await flush();
  for (const body of ['', '  ', 'x'.repeat(2001), 'a\u0000b']) { store.setDraft(body); await store.send(); assert.equal(store.getSnapshot().sendError, 'liveChat.invalidBody'); }
  assert.equal(calls, 0); assert.equal(ids, 0);
  assert.equal(chatLogic.validMessageBody('🎉'.repeat(2000)), true);
  store.setDraft(' valid '); await store.send(); assert.equal(store.getSnapshot().draft, ''); assert.equal(calls, 1);
  const broken = new LiveLobbyChatStore({ listLobbyMessages: async () => page(), sendLobbyMessage: () => { throw Error('must not send'); } }, () => { throw Error('uuid unavailable'); });
  broken.setContext('A', lobby.id); await flush(); broken.setDraft('draft'); await broken.send();
  assert.equal(broken.getSnapshot().sendError, 'liveChat.idError'); assert.equal(broken.getSnapshot().draft, 'draft');
});
test('old latest/page GET after confirmed send cannot remove it, and repeated server IDs deduplicate', async () => {
  for (const older of [false, true]) {
    const read = deferred(); let initial = true;
    const store = new LiveLobbyChatStore({
      listLobbyMessages: async () => { if (initial) { initial = false; return page([message('m1')], 'cursor'); } return read.promise; },
      sendLobbyMessage: async (_id, input) => message(input.clientMessageId, input.body),
    }, () => 'm3');
    store.setContext('A', lobby.id); await flush(); store.setDraft('confirmed');
    // Start send first, keep its response pending in the microtask queue, then capture an old GET.
    const sent = store.send(); const reading = older ? store.loadOlder() : store.reload(); await sent;
    assert.ok(store.getSnapshot().items.some(m => m.id === 'm3'));
    read.resolve(page([message('m1'), message('m1')])); await reading;
    assert.deepEqual(store.getSnapshot().items.map(m => m.id), ['m1','m3']);
  }
});
test('late chat GET/page/send cannot change account, lobby, logged-out or unmounted context', async () => {
  for (const operation of ['read','page','send']) for (const transition of ['account','lobby','logout','unmount']) {
    const late = deferred(); let calls = 0;
    const c = chatHost({ listLobbyMessages: async () => {
      if (++calls === 1) return page([message()], 'older');
      if (operation !== 'send' && calls === 2) return late.promise;
      return page();
    }, sendLobbyMessage: () => late.promise });
    c.render(); await flush();
    if (operation === 'read') byId(c.render(), 'live-chat-refresh').props.onPress();
    if (operation === 'page') byId(byId(c.render(), 'live-chat-history').props.ListFooterComponent, 'live-chat-older').props.onPress();
    if (operation === 'send') { byId(c.render(), 'live-chat-draft').props.onChangeText('late'); byId(c.render(), 'live-chat-send').props.onPress(); }
    if (transition === 'account') c.auth.user = { id: 'B' };
    if (transition === 'lobby') c.props.lobbyId = 'other';
    if (transition === 'logout') c.auth.user = null;
    if (transition === 'unmount') c.h.unmount();
    else assert.deepEqual(history(c.render()), []); // first render already hides the old context
    late.resolve(operation === 'send' ? message('late', 'late') : page([message('late', 'Private old context')])); await flush();
    if (transition !== 'unmount') assert.ok(!history(c.render()).some(m => m.id === 'late' || m.id === 'm1'));
    c.h.unmount();
  }
});
test('403/404 on read or send clears history, locks composer, notifies details once and ignores older replies', async () => {
  for (const status of [403,404]) for (const operation of ['read','send']) {
    let rejectAccess = false, notifications = 0;
    const c = chatHost({ listLobbyMessages: async () => { if (rejectAccess) throw chatError(status); return page([message()]); }, sendLobbyMessage: async () => { throw chatError(status); } });
    c.props.onAccessLost = () => { notifications++; }; c.render(); await flush();
    if (operation === 'read') { rejectAccess = true; byId(c.render(), 'live-chat-refresh').props.onPress(); }
    else { byId(c.render(), 'live-chat-draft').props.onChangeText('denied'); byId(c.render(), 'live-chat-send').props.onPress(); }
    await flush(); assert.deepEqual(history(c.render()), []); assert.equal(notifications, 1);
    assert.equal(byId(c.render(), 'live-chat-send'), undefined); assert.equal(byId(c.render(), 'live-chat-retry'), undefined);
    assert.ok(byId(c.render(), 'live-chat-error')); c.h.unmount();
  }
  const oldRead = deferred(), send = deferred(); let first = true;
  const store = new LiveLobbyChatStore({ listLobbyMessages: async () => { if (first) { first = false; return page(); } return oldRead.promise; }, sendLobbyMessage: () => send.promise }, () => 'm');
  store.setContext('A', lobby.id); await flush(); store.setDraft('draft'); const sending = store.send(); const read = store.reload();
  send.reject(chatError(403)); await sending; oldRead.resolve(page([message()])); await read;
  assert.deepEqual(store.getSnapshot().items, []); assert.equal(store.getSnapshot().blocked, true);
});
test('membership invalidation immediately hides chat, rechecks access and invalidates old page/send', async () => {
  const oldPage = deferred(), oldSend = deferred(); let reads = 0;
  const c = chatHost({ listLobbyMessages: async (_id, before) => { if (before) return oldPage.promise; if (++reads > 1) throw chatError(403); return page([message()], 'older'); }, sendLobbyMessage: () => oldSend.promise });
  c.render(); await flush(); byId(c.render(), 'live-chat-draft').props.onChangeText('old'); byId(c.render(), 'live-chat-send').props.onPress();
  byId(byId(c.render(), 'live-chat-history').props.ListFooterComponent, 'live-chat-older').props.onPress();
  getLobbyInvalidation(c.auth.lobbyApi).invalidate(); assert.deepEqual(history(c.render()), []);
  await flush(); oldPage.resolve(page([message('old')])); oldSend.resolve(message('old-send')); await flush();
  assert.deepEqual(history(c.render()), []); assert.ok(byId(c.render(), 'live-chat-error')); c.h.unmount();
});
test('actual details -> live chat -> same details uses one Modal and updates access after denial', async () => {
  let joined = true, reads = 0, closes = 0;
  const auth = { user: { id: 'A' }, lobbyApi: { getLobby: async id => { reads++; return { ...lobby, id, startsAt: '2000-01-01T00:00:00Z', membershipStatus: joined ? 'JOINED' : 'LEFT' }; } } };
  const h = host(auth), { LiveLobbyDetails } = h.load('src/features/home/LiveLobbyDetails.tsx');
  const render = () => h.render(LiveLobbyDetails, { id: lobby.id, onClose() { closes++; } });
  render(); await flush(); assert.equal(byId(render(), 'live-chat-open').props.disabled, false); // chat remains open after startsAt
  byId(render(), 'live-chat-open').props.onPress();
  const chat = nodes(render()).find(n => n.type === 'LiveLobbyChatScreen');
  assert.equal(chat.props.lobbyId, lobby.id); assert.equal(nodes(render()).filter(n => n.type === 'Modal').length, 1);
  chat.props.onBack(); await flush(); assert.equal(nodes(render()).find(n => n.type === 'LiveLobbyChatScreen'), undefined);
  assert.equal(texts(byId(render(), 'live-lobby-description')), lobby.description); assert.equal(closes, 0);
  byId(render(), 'live-chat-open').props.onPress(); joined = false;
  nodes(render()).find(n => n.type === 'LiveLobbyChatScreen').props.onAccessLost(); await flush();
  nodes(render()).find(n => n.type === 'Modal').props.onRequestClose(); await flush();
  assert.equal(byId(render(), 'live-chat-open').props.disabled, true); assert.ok(reads >= 3); h.unmount();
});
test('message transport encodes cursor, retains Bearer/one auth refresh and never retries uncertain POST', async () => {
  const calls = []; let postCount = 0, refreshes = 0;
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const client = creationClient(async (url, options) => {
    if (url.endsWith('/auth/login')) return authReply(1);
    if (url.endsWith('/auth/refresh')) { refreshes++; return authReply(2); }
    calls.push({ url, options });
    if (options.method === 'GET') return response(page());
    if (++postCount === 1) return response({ error: { code: 'INVALID_ACCESS_TOKEN', message: 'expired' } }, 401);
    if (postCount === 2) return response(message('stable'));
    throw new Error('lost response');
  });
  await client.login({ email: 'a@example.test', password: 'test-only' });
  await client.listLobbyMessages(lobby.id, 'a/b+?=');
  assert.equal(new URL(calls[0].url).searchParams.get('before'), 'a/b+?=');
  assert.equal(new URL(calls[0].url).searchParams.get('limit'), '30');
  const payload = { clientMessageId: 'stable', body: 'original' };
  await client.sendLobbyMessage(lobby.id, payload); assert.equal(refreshes, 1);
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer access-2');
  assert.deepEqual(calls.at(-1).options.body, calls.at(-2).options.body);
  await assert.rejects(client.sendLobbyMessage(lobby.id, payload), e => e.code === 'NETWORK_ERROR'); assert.equal(postCount, 3);
});
test('message transport and chat store reject stale session responses after explicit account switch', async () => {
  const late = deferred(); let logins = 0;
  const client = creationClient(async url => url.endsWith('/auth/login') ? authReply(++logins, logins === 1 ? 'A' : 'B') : late.promise);
  await client.login({ email: 'a@example.test', password: 'test-only' });
  const pending = client.sendLobbyMessage(lobby.id, { clientMessageId: 'old', body: 'old' });
  const rejected = assert.rejects(pending, e => e.code === 'INVALID_REFRESH_TOKEN');
  await client.login({ email: 'b@example.test', password: 'test-only' }); late.resolve(new Response(JSON.stringify(message('old')))); await rejected;
});
test('message conflict is localized and explicit discard keeps draft without pretending delivery', async () => {
  const c = chatHost({ listLobbyMessages: async () => page(), sendLobbyMessage: async () => { throw new ApiClientError({ statusCode: 409, code: 'MESSAGE_ID_CONFLICT', message: 'conflict' }); } });
  c.render(); await flush(); byId(c.render(), 'live-chat-draft').props.onChangeText('draft'); byId(c.render(), 'live-chat-send').props.onPress(); await flush();
  assert.match(texts(byId(c.render(), 'live-chat-send-error')), /идентификатор/);
  byId(c.render(), 'live-chat-discard-retry').props.onPress();
  assert.equal(byId(c.render(), 'live-chat-draft').props.value, 'draft'); assert.deepEqual(history(c.render()), []);
  assert.equal(byId(c.render(), 'live-chat-send').props.disabled, false); c.h.unmount();
  for (const language of ['ru','en']) {
    const t = createTranslator(language);
    for (const key of ['liveChat.forbidden','liveChat.unconfirmed','liveChat.conflict','liveChat.olderError']) assert.notEqual(t(key), key);
  }
});

test('Home <-> personal transitions expand nav even when the destination cannot scroll', () => {
  let compact=true;const resets=[];
  const h=host({});
  const {HomeScreen}=h.load('src/screens/HomeScreen.tsx',{
    ...personalScreenMocks({}),
    '../navigation/NavScrollContext':{NavScrollContext:{value(value){compact=value;resets.push(value);}}},
    '@expo-google-fonts/outfit/600SemiBold':{Outfit_600SemiBold:{}},'expo-font':{useFonts:()=>[true]},
    '../components/icons/PartyIcon':{PartyIcon:'PartyIcon'},
    '../features/chats/LiveChatsModal':{LiveChatsModal:'LiveChatsModal'},'../features/search/SearchModal':{SearchModal:'SearchModal'},
    './PersonalLobbiesScreen':{PersonalLobbiesScreen:'PersonalLobbiesScreen'},
  });
  const render=()=>h.render(HomeScreen,{});
  nodes(render()).find(n=>n.type==='LiveLobbyFeed'&&n.props.scope==='mine').props.onViewAll();
  assert.equal(compact,false,'Entry expands without a scroll event from the short personal page');
  const personal=render();assert.equal(personal.type,'PersonalLobbiesScreen');
  compact=true;personal.props.onClose();
  assert.equal(compact,false,'Return expands even if Home is empty/short');
  assert.ok(nodes(render()).find(n=>n.type==='LiveLobbyFeed'));assert.deepEqual(resets,[false,false]);h.unmount();
});

const joinedLobby = { ...lobby, isJoined:true, membershipStatus:'JOINED', joinedCount:3, groupExtroversionLevel:5.5 };
test('membership action uses explicit own status/organizer, and all disabled reasons are localized', () => {
  assert.equal(membershipAction(lobby).action,'join');
  assert.equal(membershipAction({...joinedLobby,isOrganizer:false,capacity:3}).action,'leave','JOINED does not imply organizer');
  assert.equal(membershipAction({...lobby,membershipStatus:'LEFT'}).action,'join');
  for(const [change,reason] of [
    [{...joinedLobby,isOrganizer:true},'membership.organizerReason'],
    [{membershipStatus:'REMOVED'},'membership.removed'],
    [{startsAt:'2000-01-01T00:00:00.000Z'},'membership.started'],
    [{capacity:2},'membership.full'],
  ]) {
    const result=membershipAction({...lobby,...change});assert.equal(result.action,null);assert.equal(result.reason,reason);
    for(const language of ['ru','en'])assert.notEqual(createTranslator(language)(reason),reason);
  }
});

test('actual details lock double/opposite clicks, do not optimistically join and then allow leave', async () => {
  const pending=deferred();let server=lobby;let posts=0;
  const auth={user:{id:'A'},lobbyApi:{getLobby:async()=>server,joinLobby:()=>{posts++;return pending.promise;},leaveLobby:async()=>{posts++;return server={...lobby,membershipStatus:'LEFT'};}}};
  const h=host(auth);const {LiveLobbyDetails}=h.load('src/features/home/LiveLobbyDetails.tsx');
  const render=()=>h.render(LiveLobbyDetails,{id:lobby.id,onClose(){}});
  render();await flush();const click=byId(render(),'membership-action').props.onPress;
  click();click();assert.equal(posts,1);
  assert.equal(byId(render(),'membership-action').props.disabled,true);
  assert.equal(nodes(render()).find(n=>n.type==='LiveLobbyMetadata').props.lobby.isJoined,false);
  server=joinedLobby;pending.resolve(server);await flush();
  assert.equal(texts(byId(render(),'membership-action')),'Выйти из лобби');
  assert.equal(nodes(render()).find(n=>n.type==='LiveLobbyMetadata').props.lobby.isJoined,true);
  byId(render(),'membership-action').props.onPress();await flush();
  assert.equal(posts,2);assert.equal(texts(byId(render(),'membership-action')),'Вступить в лобби');h.unmount();
});

test('membership errors and ambiguous outcomes verify with GET, never retry POST or claim success', async () => {
  for(const [code,key] of [['LOBBY_FULL','membership.full'],['LOBBY_STARTED','membership.started'],['LOBBY_MEMBERSHIP_REMOVED','membership.removed'],['LOBBY_ORGANIZER_CANNOT_LEAVE','membership.organizerReason'],['LOBBY_NOT_FOUND','lobbies.notFound'],['NETWORK_ERROR','membership.unconfirmed']]) {
    let reads=0,posts=0,failRead=false;
    const store=new LobbyDetailsStore({getLobby:async()=>{reads++;if(failRead)throw Error('offline');return lobby;},joinLobby:async()=>{posts++;throw new ApiClientError({statusCode:code==='NETWORK_ERROR'?0:409,code,message:'failed'});}});
    store.setContext('A',lobby.id);await flush();failRead=true;
    await store.changeMembership();
    assert.equal(posts,1);assert.equal(reads,2);assert.equal(store.getSnapshot().actionError,key);
    assert.equal(store.getSnapshot().lobby.isJoined,false);assert.ok(store.getSnapshot().error);
    await store.changeMembership();assert.equal(posts,1,'Verification failure keeps actions blocked');
    failRead=false;await store.reload();assert.equal(store.getSnapshot().error,null);assert.equal(store.getSnapshot().actionError,key);
  }
  let reads=0,posts=0;
  const store=new LobbyDetailsStore({getLobby:async()=>++reads===1?lobby:joinedLobby,joinLobby:async()=>{posts++;throw Error('lost successful response');}});
  store.setContext('A',lobby.id);await flush();await store.changeMembership();
  assert.equal(posts,1);assert.equal(store.getSnapshot().lobby.isJoined,true,'Only a confirmed GET exposes the committed join');
  assert.equal(store.getSnapshot().actionError,'membership.unconfirmed');
});

test('membership completion after account switch/logout/unmount cannot alter details', async () => {
  for(const account of [null,'B'])for(const fails of [false,true]){
    const pending=deferred();
    const store=new LobbyDetailsStore({getLobby:async()=>lobby,joinLobby:()=>pending.promise});
    store.setContext('A',lobby.id);await flush();const action=store.changeMembership();
    store.setContext(account,lobby.id);await flush();
    fails?pending.reject(Error('late failure')):pending.resolve(joinedLobby);await action;
    assert.equal(store.getSnapshot().account,account);assert.equal(store.getSnapshot().actionError,null);
    assert.equal(store.getSnapshot().lobby?.isJoined,account?false:undefined);
  }
});

test('actual shared invalidation refreshes search/all/Home mine/full mine/details and rejects old GET/page results', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let server=lobby;let oldReads=false;const pending=[];const listCalls=[];
  const response=value=>new Response(JSON.stringify(value));
  const client=creationClient(async(url)=>{
    if(url.endsWith('/auth/login'))return authReply(1);
    if(url.endsWith('/join')){server=joinedLobby;return response(server);}
    if(url.endsWith('/leave')){server={...lobby,membershipStatus:'LEFT'};return response(server);}
    if(oldReads){const d=deferred();pending.push(d);return d.promise;}
    if(url.includes('/lobbies?')){
      const mine=url.includes('scope=mine');listCalls.push(mine?'mine':'all');
      return response(page(mine&&!server.isJoined?[]:[server],'next'));
    }
    return response(server);
  });
  await client.login({email:'a@example.test',password:'test-only'});
  const auth={status:'authenticated',user:{id:'A'},lobbyApi:client};
  const feeds=['all','mine','mine'].map(scope=>{
    const h=host(auth),{LiveLobbyFeed}=h.load('src/features/home/LiveLobbyFeed.tsx');
    return {h,render:()=>h.render(LiveLobbyFeed,{scope,onSelect(){}})};
  });
  const detailsHost=host(auth),{LiveLobbyDetails}=detailsHost.load('src/features/home/LiveLobbyDetails.tsx');
  const details=()=>detailsHost.render(LiveLobbyDetails,{id:lobby.id,onClose(){}});
  const search = mountSearch(auth);
  feeds.forEach(f=>f.render());details();search.render();await flush();
  byId(search.render(),'search-input').props.onChangeText('demo.pizza');t.mock.timers.tick(300);await flush();
  oldReads=true;
  byId(feeds[0].render(),'lobbies-load-more').props.onPress();
  for(const feed of feeds.slice(1))button(feed.render(),'Обновить').props.onPress();
  byId(details(),'membership-refresh').props.onPress();
  byId(search.render(),'search-more').props.onPress();
  await flush();assert.equal(pending.length,5);
  oldReads=false;await client.joinLobby(lobby.id);await flush();
  for(const feed of feeds)assert.equal(nodes(feed.render()).find(n=>n.type==='LiveLobbyCard').props.lobby.isJoined,true);
  assert.equal(nodes(details()).find(n=>n.type==='LiveLobbyMetadata').props.lobby.joinedCount,3);
  assert.equal(search.rows()[0].isJoined,true);assert.equal(byId(search.render(),'search-input').props.value,'demo.pizza');
  pending[0].resolve(response(page([{...lobby,id:'stale-page'}])));
  pending[1].resolve(response(page()));pending[2].resolve(response(page()));pending[3].resolve(response(lobby));await flush();
  pending[4].resolve(response(page([{...lobby,id:'old-search-page'}])));await flush();
  assert.deepEqual(search.rows().map(l=>l.id),[lobby.id]);assert.equal(search.rows()[0].isJoined,true);
  for(const feed of feeds)assert.deepEqual(nodes(feed.render()).filter(n=>n.type==='LiveLobbyCard').map(n=>n.props.lobby.id),[lobby.id]);
  assert.equal(nodes(details()).find(n=>n.type==='LiveLobbyMetadata').props.lobby.isJoined,true);
  await client.leaveLobby(lobby.id);await flush();
  for(const feed of feeds.slice(1))assert.ok(byId(feed.render(),'mine-lobbies-empty'));
  assert.equal(nodes(feeds[0].render()).find(n=>n.type==='LiveLobbyCard').props.lobby.joinedCount,2);
  assert.equal(nodes(details()).find(n=>n.type==='LiveLobbyMetadata').props.lobby.membershipStatus,'LEFT');
  assert.equal(search.rows()[0].membershipStatus,'LEFT');assert.equal(search.rows()[0].joinedCount,2);
  assert.equal(listCalls.filter(s=>s==='mine').length,6,'Both independent mine stores refreshed on both actions');
  feeds.forEach(f=>f.h.unmount());detailsHost.unmount();search.h.unmount();
});

test('late membership transport response cannot invalidate or mutate another session; POST is bounded', async () => {
  for(const logout of [false,true]){
    let logins=0,invalidations=0;const pending=deferred();
    const client=creationClient(async url=>{
      if(url.endsWith('/auth/login'))return authReply(++logins,logins===1?'A':'B');
      if(url.endsWith('/auth/logout'))return new Response(null,{status:204});
      return pending.promise;
    });
    const unsubscribe=getLobbyInvalidation(client).subscribe(()=>invalidations++);
    await client.login({email:'a@example.test',password:'test-only'});
    const op=client.joinLobby(lobby.id);const rejected=assert.rejects(op,error=>error.code==='INVALID_REFRESH_TOKEN');
    if(logout)await client.logout();else await client.login({email:'b@example.test',password:'test-only'});
    pending.resolve(new Response(JSON.stringify(joinedLobby)));await rejected;assert.equal(invalidations,0);unsubscribe();
  }
  for(const mode of ['401','network']){
    let posts=0,refreshes=0;
    const client=creationClient(async(url,options)=>{
      if(url.endsWith('/auth/login'))return authReply(1);
      if(url.endsWith('/auth/refresh')){refreshes++;return authReply(2);}
      posts++;assert.equal(options.method,'POST');assert.equal(options.body,undefined);
      if(mode==='network')throw Error('offline');
      if(posts===1)return new Response(JSON.stringify({error:{code:'INVALID_ACCESS_TOKEN',message:'expired'}}),{status:401});
      return new Response(JSON.stringify(joinedLobby));
    });
    await client.login({email:'a@example.test',password:'test-only'});
    if(mode==='network'){await assert.rejects(client.joinLobby(lobby.id));assert.equal(posts,1);assert.equal(refreshes,0);}
    else{await client.joinLobby(lobby.id);assert.equal(posts,2);assert.equal(refreshes,1);}
  }
});

test('mine feed loading/empty/create/error/retry never substitutes demo records', async () => {
  let next = deferred(); const calls=[]; let creates=0;
  const h=host({status:'authenticated',user:{id:'A'},lobbyApi:{listLobbies:(after,scope)=>{calls.push({after,scope});return next.promise;}}});
  const {LiveLobbyFeed}=h.load('src/features/home/LiveLobbyFeed.tsx');
  const render=()=>h.render(LiveLobbyFeed,{scope:'mine',onSelect(){},onCreate(){creates++;}});
  assert.ok(byId(render(),'mine-lobbies-loading'));
  next.resolve(page()); await flush();
  assert.match(texts(byId(render(),'mine-lobbies-empty')),/Создайте/);
  assert.equal(texts(byId(render(),'mine-create-lobby')),'Создать лобби');
  byId(render(),'mine-create-lobby').props.onPress(); assert.equal(creates,1);
  next=deferred();button(render(),'Обновить').props.onPress(); next.reject(new Error('offline'));await flush();
  assert.ok(byId(render(),'mine-lobbies-error'));
  assert.equal(nodes(render()).filter(n=>n.type==='LiveLobbyCard').length,0);
  next=deferred();button(render(),'Попробовать снова').props.onPress();
  next.resolve(page([{...lobby,title:'Real personal title',isJoined:true}]));await flush();
  assert.equal(nodes(render()).find(n=>n.type==='LiveLobbyCard').props.lobby.title,'Real personal title');
  assert.ok(calls.every(call=>call.scope==='mine'));h.unmount();
});

test('all and mine have independent loading, errors, refresh and cursors; pagination retry uses mine cursor', async () => {
  const calls=[];const responses={all:deferred(),mine:deferred()};
  const auth={status:'authenticated',user:{id:'A'},lobbyApi:{listLobbies:(after,scope)=>{calls.push({after,scope});return responses[scope].promise;}}};
  const allHost=host(auth),mineHost=host(auth);
  const allFeed=allHost.load('src/features/home/LiveLobbyFeed.tsx').LiveLobbyFeed;
  const mineFeed=mineHost.load('src/features/home/LiveLobbyFeed.tsx').LiveLobbyFeed;
  const all=()=>allHost.render(allFeed,{onSelect(){}});
  const mine=()=>mineHost.render(mineFeed,{scope:'mine',onSelect(){}});
  all();mine();
  responses.all.resolve(page([{...lobby,id:'foreign',isJoined:false}],'all-cursor'));await flush();
  assert.ok(byId(mine(),'mine-lobbies-loading'));
  responses.mine.resolve(page([{...lobby,id:'own',isJoined:true}],'mine-cursor'));await flush();
  responses.mine=deferred();
  const press=byId(mine(),'mine-lobbies-load-more').props.onPress;press();press();
  assert.deepEqual(calls.at(-1),{after:'mine-cursor',scope:'mine'});
  assert.equal(calls.length,3);
  assert.equal(byId(all(),'lobbies-load-more').props.disabled,false);
  responses.mine.reject(new Error('pagination offline'));await flush();
  assert.ok(byId(mine(),'mine-lobbies-error'));assert.equal(byId(all(),'lobbies-error'),undefined);
  responses.mine=deferred();button(mine(),'Попробовать снова').props.onPress();
  responses.mine.resolve(page([{...lobby,id:'own-next',isJoined:true}]));await flush();
  assert.deepEqual(nodes(mine()).filter(n=>n.type==='LiveLobbyCard').map(n=>n.props.lobby.id),['own','own-next']);
  assert.deepEqual(nodes(all()).filter(n=>n.type==='LiveLobbyCard').map(n=>n.props.lobby.id),['foreign']);
  responses.mine=deferred();button(mine(),'Обновить').props.onPress();
  assert.deepEqual(calls.at(-1),{after:undefined,scope:'mine'});
  assert.equal(nodes(mine()).filter(n=>n.type==='LiveLobbyCard').length,0);
  assert.ok(byId(all(),'lobbies-load-more'));
  responses.mine.resolve(page());await flush();allHost.unmount();mineHost.unmount();
});

test('mine drops late reload and page responses after logout/account switch, including the first render', async () => {
  for(const mode of ['reload','page']) for(const account of [null,'B']) {
    let next=Promise.resolve(page([{...lobby,title:'A only'}],'next'));
    const auth={status:'authenticated',user:{id:'A'},lobbyApi:{listLobbies:()=>next}};
    const h=host(auth);const {LiveLobbyFeed}=h.load('src/features/home/LiveLobbyFeed.tsx');
    const render=()=>h.render(LiveLobbyFeed,{scope:'mine',onSelect(){}});
    render();await flush();
    const late=deferred();next=late.promise;
    if(mode==='reload')button(render(),'Обновить').props.onPress();
    else byId(render(),'mine-lobbies-load-more').props.onPress();
    next=Promise.resolve(page([{...lobby,title:'B only'}]));
    auth.user=account?{id:account}:null;auth.status=account?'authenticated':'unauthenticated';
    assert.equal(nodes(render()).filter(n=>n.type==='LiveLobbyCard').length,0);
    await flush();late.resolve(page([{...lobby,title:'Late A'}]));await flush();
    assert.deepEqual(nodes(render()).filter(n=>n.type==='LiveLobbyCard').map(n=>n.props.lobby.title),account?['B only']:[]);
    h.unmount();
  }
});

const personalScreenMocks = auth => ({
  ...screenMocks(auth),
  '../features/home/LiveLobbyFeed':{LiveLobbyFeed:'LiveLobbyFeed'},
  '../features/home/LiveLobbyDetails':{LiveLobbyDetails:'LiveLobbyDetails'},
});

function mountSearch(auth, props = {}) {
  const h = host(auth);
  const { SearchScreen, SearchResult } = h.load('src/screens/SearchScreen.tsx', {
    ...screenMocks(auth),
    '../api/lobbyInvalidation': { getLobbyInvalidation },
    '../features/search/lobbySearch': searchLogic,
    '../features/home/LiveLobbyCard': { LiveLobbyMetadata: 'LiveLobbyMetadata', LobbyCategoryPlaceholder: 'LobbyCategoryPlaceholder' },
    '../features/profile/ExtroversionGauge': { ExtroversionGauge: 'ExtroversionGauge' },
    '../components/icons/PartyIcon': { PartyIcon: 'PartyIcon' },
    'react-native-gesture-handler': { GestureDetector: 'GestureDetector' },
  }, 'SearchResult');
  const render = () => {
    const tree = h.render(SearchScreen, { active: true, onClose() {}, onSelectLobby() {}, scrollGesture: {}, ...props });
    const list = byId(tree, 'search-results').props;
    return [tree, list.ListHeaderComponent, list.data.length ? null : list.ListEmptyComponent, list.ListFooterComponent,
      ...list.data.map(item => SearchResult(list.renderItem({ item }).props))];
  };
  return { h, render, rows: () => byId(render(), 'search-results').props.data };
}

test('details react to the shared clock crossing startsAt, without pressing or issuing another GET', async () => {
  for (const joined of [false, true]) {
    let now = Date.parse(lobby.startsAt) - 1, reads = 0;
    const h = host({ user: { id: 'A' }, lobbyApi: { getLobby: async () => { reads++; return joined ? joinedLobby : lobby; } } });
    const { LiveLobbyDetails } = h.load('src/features/home/LiveLobbyDetails.tsx', { './HomeExperienceProvider': { useHomeClock: () => now } });
    const render = () => h.render(LiveLobbyDetails, { id: lobby.id, onClose() {} });
    render(); await flush(); assert.equal(byId(render(), 'membership-action').props.disabled, false);
    now++; assert.equal(byId(render(), 'membership-action').props.disabled, true);
    assert.equal(texts(byId(render(), 'membership-reason')), createTranslator('ru')('membership.started'));
    assert.equal(reads, 1); h.unmount();
  }
});

test('actual search input debounces 300ms, clears to server catalog, renders loading/empty/error and retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = []; let next = deferred();
  const auth = { status: 'authenticated', user: { id: 'A' }, lobbyApi: { listLobbies: (after, scope, q) => { calls.push({ after, scope, q }); return next.promise; } } };
  let selected;
  const s = mountSearch(auth, { onSelectLobby(id) { selected = id; } });
  assert.ok(byId(s.render(), 'search-loading')); next.resolve(page()); await flush();
  assert.ok(byId(s.render(), 'search-empty')); assert.equal(calls[0].q, '');
  next = deferred(); byId(s.render(), 'search-input').props.onChangeText('  МЯЧ  ');
  assert.equal(s.rows().length, 0); assert.ok(byId(s.render(), 'search-loading'));
  t.mock.timers.tick(299); assert.equal(calls.length, 1);
  t.mock.timers.tick(1); assert.deepEqual(calls.at(-1), { after: undefined, scope: 'all', q: 'МЯЧ' });
  next.reject(Error('offline')); await flush(); assert.ok(byId(s.render(), 'search-error')); assert.equal(s.rows().length, 0);
  next = deferred(); byId(s.render(), 'search-retry').props.onPress(); next.resolve(page([lobby])); await flush();
  assert.equal(s.rows()[0].title, lobby.title); assert.equal(byId(s.render(), 'search-result-count'), undefined);
  byId(s.render(), `search-result-${lobby.id}`).props.onPress(); assert.equal(selected, lobby.id);
  assert.ok(nodes(s.render()).find(n => n.type === 'LobbyCategoryPlaceholder'));
  assert.equal(nodes(s.render()).find(n => n.type === 'LiveLobbyMetadata').props.lobby, lobby);
  assert.doesNotMatch(texts(s.render()), /демо/i);
  byId(s.render(), 'search-clear').props.onPress(); assert.equal(byId(s.render(), 'search-input').props.value, '');
  assert.equal(s.rows().length, 0); t.mock.timers.tick(300); await flush();
  assert.deepEqual(calls.at(-1), { after: undefined, scope: 'all', q: '' }); s.h.unmount();
});

test('search invalidates before debounce, drops reverse-order responses and old pagination, retaining new query', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const s = mountSearch({ status: 'authenticated', user: { id: 'A' }, lobbyApi: { listLobbies: (after, scope, q) => { const d = deferred(); calls.push({ after, q, ...d }); return d.promise; } } });
  s.render(); byId(s.render(), 'search-input').props.onChangeText('A');
  calls[0].resolve(page([lobby])); await flush(); assert.equal(s.rows().length, 0, 'old reply during new debounce');
  t.mock.timers.tick(300); byId(s.render(), 'search-input').props.onChangeText('B'); t.mock.timers.tick(300);
  calls[2].resolve(page([{ ...lobby, title: 'B' }], 'b-page')); await flush();
  calls[1].resolve(page([{ ...lobby, title: 'A' }])); await flush(); assert.equal(s.rows()[0].title, 'B');
  const press = byId(s.render(), 'search-more').props.onPress; press(); press();
  assert.equal(calls.length, 4); assert.equal(calls[3].after, 'b-page'); assert.equal(calls[3].q, 'B');
  byId(s.render(), 'search-input').props.onChangeText('C');
  calls[3].resolve(page([{ ...lobby, id: 'old-page' }])); await flush(); assert.equal(s.rows().length, 0);
  t.mock.timers.tick(300); assert.equal(calls[4].after, undefined); assert.equal(calls[4].q, 'C');
  s.h.unmount(); calls[4].resolve(page()); await flush();
});

test('search next-page error preserves cards and cursor; explicit retry keeps q and coalesces page loads', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let next = Promise.resolve(page([lobby], 'next')); const calls = [];
  const s = mountSearch({ status: 'authenticated', user: { id: 'A' }, lobbyApi: { listLobbies: (after, scope, q) => { calls.push({ after, q }); return next; } } });
  s.render(); byId(s.render(), 'search-input').props.onChangeText('food'); t.mock.timers.tick(300); await flush();
  next = Promise.reject(Error('page offline')); byId(s.render(), 'search-more').props.onPress(); await flush();
  assert.equal(s.rows().length, 1); assert.ok(byId(s.render(), 'search-error'));
  const pending = deferred(); next = pending.promise; const retry = byId(s.render(), 'search-retry').props.onPress; retry(); retry();
  assert.deepEqual(calls.at(-1), { after: 'next', q: 'food' }); assert.equal(calls.length, 4);
  pending.resolve(page([{ ...lobby, id: 'two' }])); await flush(); assert.equal(s.rows().length, 2);
  assert.equal(byId(s.render(), 'search-error'), undefined); assert.equal(byId(s.render(), 'search-more'), undefined); s.h.unmount();
});

test('actual search closes, logs out and switches accounts without late reads or debounce returning old cards', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const mode of ['close', 'unmount', 'logout', 'switch', 'recovery']) {
    const late = deferred(); let next = late.promise, closes = 0;
    const auth = { status: 'authenticated', user: { id: 'A' }, lobbyApi: { listLobbies: () => next } };
    const s = mountSearch(auth, { onClose() { closes++; } }); s.render();
    if (mode === 'close') byId(s.render(), 'search-back').props.onPress();
    else if (mode === 'unmount') s.h.unmount();
    else {
      auth.user = mode === 'switch' ? { id: 'B' } : null; auth.storageRecoveryRequired = mode === 'recovery';
      next = Promise.resolve(page([{ ...lobby, title: 'B only' }]));
      assert.equal(s.rows().length, 0); await flush();
    }
    late.resolve(page([{ ...lobby, title: 'Late A' }])); await flush();
    if (mode !== 'unmount') assert.deepEqual(s.rows().map(l => l.title), mode === 'switch' ? ['B only'] : []);
    assert.equal(closes, mode === 'close' ? 1 : 0); s.h.unmount();
  }
  let calls = 0;
  const s = mountSearch({ status: 'authenticated', user: { id: 'A' }, lobbyApi: { listLobbies: async () => { calls++; return page(); } } });
  s.render(); byId(s.render(), 'search-input').props.onChangeText('never sent'); s.h.unmount();
  t.mock.timers.tick(300); await flush(); assert.equal(calls, 1);
});

test('actual SearchModal opens LiveLobbyDetails by real id, preserves SearchScreen on return and swipe wiring', () => {
  const h = host({}); let dismissed = 0, closed = 0;
  const { SearchModal } = h.load('src/features/search/SearchModal.tsx', {
    '../../navigation/NavScrollContext': { NavScrollContext: { Provider: 'NavProvider' } },
    '../../screens/SearchScreen': { SearchScreen: 'SearchScreen' },
    '../chats/SwipeBackPage': { SwipeBackPage: 'SwipeBackPage' },
    '../home/LiveLobbyDetails': { LiveLobbyDetails: 'LiveLobbyDetails' },
    'react-native-gesture-handler': { GestureHandlerRootView: 'GestureHandlerRootView' },
  });
  const render = () => h.render(SearchModal, { onClose() { closed++; } });
  const swipe = () => nodes(render()).find(n => n.type === 'SwipeBackPage');
  const back = () => { dismissed++; };
  swipe().props.onBackReady(back);
  const screen = swipe().props.children(back, 'native-gesture');
  assert.equal(screen.props.scrollGesture, 'native-gesture'); screen.props.onSelectLobby(lobby.id);
  assert.equal(swipe().props.active, false);
  const details = nodes(render()).find(n => n.type === 'LiveLobbyDetails'); assert.equal(details.props.id, lobby.id);
  details.props.onClose(); assert.equal(swipe().props.active, true);
  assert.equal(nodes(render()).find(n => n.type === 'LiveLobbyDetails'), undefined);
  render().props.onRequestClose(); assert.equal(dismissed, 1); swipe().props.onClose(); assert.equal(closed, 1); h.unmount();
});

test('ApiClient encodes literal search q and keeps scope/cursor and Bearer in the existing protected path', async () => {
  const requests = [];
  const client = creationClient(async (url, options) => { if (url.endsWith('/auth/login')) return authReply(1); requests.push({ url: new URL(url), options }); return new Response(JSON.stringify(page())); });
  await client.login({ email: 'a@example.test', password: 'test-only' });
  await client.listLobbies('opaque+/=?', 'mine', '  Мяч 50%_\\ & cafe  ');
  const { url, options } = requests[0];
  assert.equal(url.searchParams.get('q'), 'Мяч 50%_\\ & cafe'); assert.equal(url.searchParams.get('after'), 'opaque+/=?');
  assert.equal(url.searchParams.get('scope'), 'mine'); assert.ok(new Headers(options.headers).get('Authorization'));
});

test('Home View all opens real personal route and personal cards open LiveLobbyDetails, never a conversation', () => {
  const h=host({});
  const {HomeScreen}=h.load('src/screens/HomeScreen.tsx',{
    ...personalScreenMocks({}),
    '@expo-google-fonts/outfit/600SemiBold':{Outfit_600SemiBold:{}},'expo-font':{useFonts:()=>[true]},
    '../components/icons/PartyIcon':{PartyIcon:'PartyIcon'},
    '../features/chats/LiveChatsModal':{LiveChatsModal:'LiveChatsModal'},
    '../features/search/SearchModal':{SearchModal:'SearchModal'},
    './PersonalLobbiesScreen':{PersonalLobbiesScreen:'PersonalLobbiesScreen'},
  });
  let creates=0;const render=()=>h.render(HomeScreen,{onCreate(){creates++;}});
  const mine=nodes(render()).find(n=>n.type==='LiveLobbyFeed'&&n.props.scope==='mine');
  assert.equal(mine.props.compact,true);
  mine.props.onSelect(lobby.id);
  assert.equal(nodes(render()).find(n=>n.type==='LiveLobbyDetails').props.id,lobby.id);
  assert.equal(nodes(render()).find(n=>n.type==='ChatsModal'),undefined);
  nodes(render()).find(n=>n.type==='LiveLobbyDetails').props.onClose();
  mine.props.onViewAll();
  const route=render();assert.equal(route.type,'PersonalLobbiesScreen');
  const fullHost=host({});const {PersonalLobbiesScreen}=fullHost.load('src/screens/PersonalLobbiesScreen.tsx',personalScreenMocks({}));
  const full=()=>fullHost.render(PersonalLobbiesScreen,route.props);
  const feed=nodes(full()).find(n=>n.type==='LiveLobbyFeed');
  assert.equal(feed.props.scope,'mine');assert.equal(feed.props.compact,undefined);
  feed.props.onCreate();assert.equal(creates,1);
  feed.props.onSelect(lobby.id);assert.equal(nodes(full()).find(n=>n.type==='LiveLobbyDetails').props.id,lobby.id);
  assert.equal(nodes(full()).find(n=>n.type==='ChatsModal'),undefined);
  byId(full(),'personal-lobbies-back').props.onPress();
  assert.ok(nodes(render()).find(n=>n.type==='LiveLobbyFeed'));
  for(const file of ['src/screens/HomeScreen.tsx','src/screens/PersonalLobbiesScreen.tsx']) {
    assert.doesNotMatch(readFileSync(path.join(__dirname,'..',file),'utf8'),/demoLobbies|joinDemoLobby|getJoinedLobbies|initialLobby:|listPage:|onOpenChat/);
  }
  fullHost.unmount();h.unmount();
});

test('ApiClient sends explicit scope and separate opaque cursor through the same Bearer session', async () => {
  const calls=[];const client=creationClient(async (url,options)=>{
    if(url.endsWith('/auth/login'))return authReply(1);
    calls.push({url,authorization:options.headers.Authorization});
    return new Response(JSON.stringify(page()));
  });
  await client.login({email:'a@example.test',password:'test-only'});
  await client.listLobbies();await client.listLobbies(undefined,'mine');await client.listLobbies('mine+/cursor','mine');
  assert.deepEqual(calls.map(c=>c.url),[
    'http://api.test/api/v1/lobbies?limit=20&scope=all',
    'http://api.test/api/v1/lobbies?limit=20&scope=mine',
    'http://api.test/api/v1/lobbies?limit=20&scope=mine&after=mine%2B%2Fcursor',
  ]);
  assert.ok(calls.every(c=>c.authorization==='Bearer access-1'));
});

test('POST uses existing Bearer refresh-on-401 exactly once, but never retries an ambiguous network/500/JSON failure', async () => {
  for (const mode of ['401','network','500','json']) {
    let posts=0, rotations=0;
    const client = creationClient(async (url,options)=>{
      if (url.endsWith('/auth/login')) return authReply(1);
      if (url.endsWith('/auth/refresh')) {rotations++;return authReply(2);}
      posts++; assert.equal(options.method,'POST');
      if (mode==='401') {
        if (posts===1) return new Response(JSON.stringify({error:{code:'INVALID_ACCESS_TOKEN',message:'expired'}}),{status:401});
        assert.equal(options.headers.Authorization,'Bearer access-2'); return new Response(JSON.stringify(lobby),{status:201});
      }
      if (mode==='network') throw new TypeError('offline');
      return new Response('not JSON',{status:mode==='500'?500:201});
    });
    await client.login({email:'test@example.test',password:'test-only'});
    const request=client.createLobby(validateLobbyForm(draft()));
    if(mode==='401'){assert.deepEqual(await request,lobby);assert.equal(posts,2);assert.equal(rotations,1);}
    else {await assert.rejects(request);assert.equal(posts,1);assert.equal(rotations,0);}
  }
});

test('POST response from the old authenticated lease is rejected after account switch', async () => {
  const pending=deferred();let logins=0;
  const client=creationClient(async url=>url.endsWith('/auth/login')?authReply(++logins,logins===1?'A':'B'):pending.promise);
  await client.login({email:'a@example.test',password:'test-only'});
  const inFlight=client.createLobby(validateLobbyForm(draft()));const rejects=assert.rejects(inFlight,error=>error.code==='INVALID_REFRESH_TOKEN');
  await client.login({email:'b@example.test',password:'test-only'});
  pending.resolve(new Response(JSON.stringify(lobby),{status:201}));await rejects;
});
