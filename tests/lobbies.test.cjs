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
const createForm = require('../.expo/lobby-tests/features/home/createLobbyForm.js');
const { CreateLobbyFormStore, validateLobbyForm, bishkekDateTimeToInstant } = createForm;

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
    const native = Object.fromEntries(['View','Text','Pressable','ActivityIndicator','ScrollView','Modal','TextInput','KeyboardAvoidingView'].map(v => [v,v]));
    const mocks = {
      react,
      'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
      'react-native': { ...native, StyleSheet: { create: v => v }, Platform: { OS: 'web', select: v => v.web }, BackHandler: { addEventListener: () => ({ remove() {} }) } },
      '@expo/vector-icons': { Feather: 'Feather' },
      '../../auth/AuthProvider': { useAuth: () => auth },
      '../../i18n/LocalizationProvider': { useI18n: () => ({ t: createTranslator('ru'), language: 'ru' }) },
      '../../theme': { colors: {}, radius: {} },
      '../../api/errors': { ApiClientError },
      '../../api/lobbyInvalidation': { getLobbyInvalidation },
      './lobbyDetails': detailsLogic,
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

test('actual details load by id, preserve user description and offer membership but no chat action', async () => {
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
  for (const label of ['Чат — недоступен']) {
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
    '../features/chats/ChatsModal':{ChatsModal:'ChatsModal'},
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

test('Home <-> personal transitions expand nav even when the destination cannot scroll', () => {
  let compact=true;const resets=[];
  const h=host({});
  const {HomeScreen}=h.load('src/screens/HomeScreen.tsx',{
    ...personalScreenMocks({}),
    '../navigation/NavScrollContext':{NavScrollContext:{value(value){compact=value;resets.push(value);}}},
    '@expo-google-fonts/outfit/600SemiBold':{Outfit_600SemiBold:{}},'expo-font':{useFonts:()=>[true]},
    '../components/icons/PartyIcon':{PartyIcon:'PartyIcon'},
    '../features/chats/ChatsModal':{ChatsModal:'ChatsModal'},'../features/search/SearchModal':{SearchModal:'SearchModal'},
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

test('actual shared invalidation refreshes all/Home mine/full mine/details and rejects old GET/page results', async () => {
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
  feeds.forEach(f=>f.render());details();await flush();
  oldReads=true;
  byId(feeds[0].render(),'lobbies-load-more').props.onPress();
  for(const feed of feeds.slice(1))button(feed.render(),'Обновить').props.onPress();
  byId(details(),'membership-refresh').props.onPress();
  await flush();assert.equal(pending.length,4);
  oldReads=false;await client.joinLobby(lobby.id);await flush();
  for(const feed of feeds)assert.equal(nodes(feed.render()).find(n=>n.type==='LiveLobbyCard').props.lobby.isJoined,true);
  assert.equal(nodes(details()).find(n=>n.type==='LiveLobbyMetadata').props.lobby.joinedCount,3);
  pending[0].resolve(response(page([{...lobby,id:'stale-page'}])));
  pending[1].resolve(response(page()));pending[2].resolve(response(page()));pending[3].resolve(response(lobby));await flush();
  for(const feed of feeds)assert.deepEqual(nodes(feed.render()).filter(n=>n.type==='LiveLobbyCard').map(n=>n.props.lobby.id),[lobby.id]);
  assert.equal(nodes(details()).find(n=>n.type==='LiveLobbyMetadata').props.lobby.isJoined,true);
  await client.leaveLobby(lobby.id);await flush();
  for(const feed of feeds.slice(1))assert.ok(byId(feed.render(),'mine-lobbies-empty'));
  assert.equal(nodes(feeds[0].render()).find(n=>n.type==='LiveLobbyCard').props.lobby.joinedCount,2);
  assert.equal(nodes(details()).find(n=>n.type==='LiveLobbyMetadata').props.lobby.membershipStatus,'LEFT');
  assert.equal(listCalls.filter(s=>s==='mine').length,6,'Both independent mine stores refreshed on both actions');
  feeds.forEach(f=>f.h.unmount());detailsHost.unmount();
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

test('Home View all opens real personal route and personal cards open LiveLobbyDetails, never a conversation', () => {
  const h=host({});
  const {HomeScreen}=h.load('src/screens/HomeScreen.tsx',{
    ...personalScreenMocks({}),
    '@expo-google-fonts/outfit/600SemiBold':{Outfit_600SemiBold:{}},'expo-font':{useFonts:()=>[true]},
    '../components/icons/PartyIcon':{PartyIcon:'PartyIcon'},
    '../features/chats/ChatsModal':{ChatsModal:'ChatsModal'},
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
