const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const { ApiClient } = require('../.expo/auth-tests/api/client.js');
const {
  ApiClientError,
  normalizeApiError,
} = require('../.expo/auth-tests/api/errors.js');
const {
  getRequestErrorTranslationKey,
  isRetryableRequestError,
} = require('../.expo/auth-tests/api/errorMessages.js');
const {
  saveExtroversionOptimistically,
} = require('../.expo/auth-tests/features/profile/saveExtroversion.js');
const {
  createFailClosedRefreshTokenStorage,
} = require('../.expo/auth-tests/auth/refreshTokenPersistence.js');

const profile = {
  avatar: null,
  id: '00000000-0000-4000-8000-000000000001',
  email: 'person@example.test',
  handle: 'person',
  displayName: 'Person',
  bio: null,
  city: 'Bishkek',
  countryCode: 'KG',
  extroversionLevel: 5.5,
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
};

function authResponse(accessToken, refreshToken, user = profile) {
  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    accessTokenExpiresIn: 900,
    user,
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status, code) {
  return jsonResponse(status, {
    statusCode: status,
    error: { code, message: code },
    path: '/api/v1/test',
    timestamp: '2026-09-05T00:00:00.000Z',
  });
}

function noContentResponse() {
  return new Response(null, { status: 204 });
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createManualWriteDeadline() {
  let current = null;
  return {
    create() {
      const expired = createDeferred();
      const deadline = { expired, cancelled: false };
      current = deadline;
      return {
        expired: expired.promise,
        cancel() { deadline.cancelled = true; },
      };
    },
    expire() {
      assert.ok(current, 'Expected an active storage write deadline');
      assert.equal(current.cancelled, false);
      current.expired.resolve();
    },
  };
}

function createControlledWriteStorage(initialValue = null) {
  let value = initialValue;
  let blockedWrite = null;
  let clearCount = 0;
  const clearWaiters = [];
  const deadline = createManualWriteDeadline();

  function notifyClearWaiters() {
    for (let index = clearWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = clearWaiters[index];
      if (clearCount >= waiter.count) {
        clearWaiters.splice(index, 1);
        waiter.resolve();
      }
    }
  }

  return {
    storage: {
      async get() { return value; },
      async set(nextValue) {
        const pending = blockedWrite;
        if (!pending) {
          value = nextValue;
          return;
        }
        blockedWrite = null;
        if (!pending.writeAfterRelease) value = nextValue;
        pending.started.resolve();
        await pending.release.promise;
        if (pending.writeAfterRelease) value = nextValue;
      },
      async clear() {
        value = null;
        clearCount += 1;
        notifyClearWaiters();
      },
      createWriteDeadline: () => deadline.create(),
    },
    blockNextWrite(options = {}) {
      const pending = {
        started: createDeferred(),
        release: createDeferred(),
        writeAfterRelease: options.writeAfterRelease === true,
      };
      blockedWrite = pending;
      return {
        started: pending.started.promise,
        release: () => pending.release.resolve(),
      };
    },
    expireWrite: () => deadline.expire(),
    read: () => value,
    clearCount: () => clearCount,
    waitForClearCount(count) {
      if (clearCount >= count) return Promise.resolve();
      const waiter = createDeferred();
      clearWaiters.push({ count, resolve: waiter.resolve });
      return waiter.promise;
    },
  };
}

async function drainMicrotasks(iterations = 12) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

function createMemoryStorage(initialValue = null) {
  let value = initialValue;
  let clearCount = 0;
  const storedValues = [];
  return {
    storage: {
      async get() { return value; },
      async set(nextValue) {
        value = nextValue;
        storedValues.push(nextValue);
      },
      async clear() {
        value = null;
        clearCount += 1;
      },
    },
    read: () => value,
    clearCount: () => clearCount,
    storedValues: () => [...storedValues],
  };
}

function createControlledReadStorage(initialValue = null) {
  let value = initialValue;
  let blockedRead = null;
  let clearShouldFail = false;
  let clearCount = 0;

  return {
    storage: {
      async get() {
        if (!blockedRead) return value;
        blockedRead.started.resolve();
        return blockedRead.result.promise;
      },
      async set(nextValue) { value = nextValue; },
      async clear() {
        clearCount += 1;
        if (clearShouldFail) throw new Error('SecureStore clear failed');
        value = null;
      },
    },
    blockReads() {
      const state = {
        started: createDeferred(),
        result: createDeferred(),
      };
      blockedRead = state;
      return {
        started: state.started.promise,
        release(result) {
          if (blockedRead === state) blockedRead = null;
          state.result.resolve(result);
        },
      };
    },
    clearCount: () => clearCount,
    failClear(shouldFail) { clearShouldFail = shouldFail; },
    read: () => value,
  };
}

function createDurableStorage(initialToken = null) {
  const keys = {
    token: 'test.refresh-token',
    invalidated: 'test.session-invalidated',
  };
  const values = new Map();
  if (initialToken) {
    values.set(keys.token, JSON.stringify({
      version: 1, operationId: 'fixture', refreshToken: initialToken,
    }));
    values.set(`${keys.token}.operation`, JSON.stringify({
      version: 1, id: 'fixture', barrier: null, state: 'pending',
    }));
    values.set(`${keys.token}.operation.fixture.result`, JSON.stringify({
      version: 1, id: 'fixture', state: 'committed',
    }));
  }
  const failures = {
    writeMarker: false,
    deleteToken: false,
    deleteMarker: false,
  };
  const reads = {
    token: 0,
    invalidated: 0,
  };
  const durableStorage = {
    async getItem(key) {
      if (key === keys.token) reads.token += 1;
      if (key === keys.invalidated) reads.invalidated += 1;
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      if (key === keys.invalidated && failures.writeMarker) {
        throw new Error('Marker write failed');
      }
      values.set(key, value);
    },
    async deleteItem(key) {
      if (key === keys.token && failures.deleteToken) {
        throw new Error('Token deletion failed');
      }
      if (key === keys.invalidated && failures.deleteMarker) {
        throw new Error('Marker deletion failed');
      }
      values.delete(key);
    },
  };
  const createStorage = () => createFailClosedRefreshTokenStorage(
    durableStorage,
    keys,
  );
  const storage = createStorage();

  return { createStorage, failures, keys, reads, storage, values };
}

function createProtocolStorage() {
  const keys = { token: 'wal.token', invalidated: 'wal.revoked' };
  const values = new Map();
  const writes = [];
  const blockers = [];
  const barriers = [];
  const headKey = `${keys.token}.operation`;
  function raw() {
    return {
      async getItem(key) { return values.get(key) ?? null; },
      async setItem(key, value) {
        writes.push({ key, value });
        const blocker = blockers.find((entry) => !entry.used && entry.match(key, value));
        if (blocker) {
          blocker.used = true;
          if (blocker.physical) values.set(key, value);
          blocker.started.resolve();
          await blocker.release.promise;
        }
        if (!blocker || !blocker.physical) values.set(key, value);
        for (const entry of barriers) {
          if (entry.match(key, value)) entry.reached.resolve();
        }
      },
      async deleteItem(key) { values.delete(key); },
    };
  }
  return {
    keys, values, writes, headKey,
    runtime() {
      // Fresh raw identity and fresh persistence state: only durable values survive.
      const rawStorage = raw();
      const storage = createFailClosedRefreshTokenStorage(rawStorage, keys);
      const deadline = createManualWriteDeadline();
      storage.createWriteDeadline = () => deadline.create();
      return { storage, rawStorage, expire: () => deadline.expire() };
    },
    block(match, physical = false) {
      const entry = {
        match, physical, used: false, started: createDeferred(), release: createDeferred(),
      };
      blockers.push(entry);
      return { started: entry.started.promise, release: () => entry.release.resolve() };
    },
    whenWrite(match) {
      const reached = createDeferred();
      barriers.push({ match, reached });
      return reached.promise;
    },
    tokenWrites(token) {
      return writes.filter((entry) => entry.key === keys.token
        && JSON.parse(entry.value).refreshToken === token).length;
    },
  };
}

function observe(promise) {
  const outcome = { settled: false, value: undefined };
  outcome.promise = promise.then(
    (value) => { outcome.settled = true; outcome.value = value; },
    (error) => { outcome.settled = true; outcome.value = error; },
  );
  return outcome;
}

// Execute the actual Provider and AuthScreen handlers, stubbing only the
// React/native host. No duplicated recovery action or test-only auth bypass.
function createAuthScreenHarness(storage, fetchImpl) {
  let current = null;
  const context = { value: null, Provider: 'Provider' };
  const react = {
    createContext: () => context,
    useContext: (value) => value.value,
    useState(initial) {
      const instance = current;
      const index = instance.cursor++;
      if (!(index in instance.slots)) {
        instance.slots[index] = typeof initial === 'function' ? initial() : initial;
      }
      return [instance.slots[index], (value) => {
        instance.slots[index] = typeof value === 'function' ? value(instance.slots[index]) : value;
      }];
    },
    useRef(initial) { return react.useState(() => ({ current: initial }))[0]; },
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    useEffect(effect) {
      const index = current.cursor++;
      if (!(index in current.slots)) { current.slots[index] = true; current.effects.push(effect); }
    },
  };
  const jsx = (type, props) => ({ type, props });
  function load(relativePath, mocks) {
    const filename = path.join(__dirname, '..', relativePath);
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const exports = {};
    vm.runInNewContext(code, {
      exports,
      require(name) {
        if (name === 'react') return react;
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
        if (Object.hasOwn(mocks, name)) return mocks[name];
        throw new Error(`Unexpected component dependency: ${name}`);
      },
    }, { filename });
    return exports;
  }
  const provider = load('src/auth/AuthProvider.tsx', {
    '../api/client': { ApiClient: class extends ApiClient {
      constructor(options) { super({ ...options, fetchImpl, baseUrl: () => 'http://api.test/api/v1' }); }
    } },
    '../api/errors': { ApiClientError },
    './refreshTokenStorage': { refreshTokenStorage: storage },
  });
  const native = Object.fromEntries([
    'ActivityIndicator', 'KeyboardAvoidingView', 'Pressable', 'SafeAreaView',
    'ScrollView', 'Text', 'TextInput', 'View',
  ].map((name) => [name, name]));
  const screen = load('src/screens/AuthScreen.tsx', {
    '@expo/vector-icons': { Feather: 'Feather' },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    'react-native': { ...native, Platform: { OS: 'ios' }, StyleSheet: { create: (styles) => styles } },
    '../api/errorMessages': { getRequestErrorTranslationKey, isRetryableRequestError },
    '../auth/AuthProvider': provider,
    '../i18n/LocalizationProvider': { useI18n: () => ({ t: (key) => key }) },
    '../theme': { colors: {}, radius: {}, shadows: {} },
  });
  function instance(render) { return { slots: [], cursor: 0, effects: [], render }; }
  const providerInstance = instance(() => provider.AuthProvider({ children: null }));
  const screenInstance = instance(screen.AuthScreen);
  function render(instance) {
    current = instance;
    instance.cursor = 0;
    const tree = instance.render();
    current = null;
    for (const effect of instance.effects.splice(0)) effect();
    return tree;
  }
  function find(node, predicate) {
    if (Array.isArray(node)) return node.map((child) => find(child, predicate)).find(Boolean);
    if (!node || typeof node !== 'object') return null;
    return predicate(node) ? node : find(node.props?.children, predicate);
  }
  return {
    render() {
      context.value = render(providerInstance).props.value;
      return render(screenInstance);
    },
    auth: () => context.value,
    find,
  };
}

async function assertStorageFailure(outcome) {
  await drainMicrotasks(120);
  assert.equal(outcome.settled, true, 'The API must settle without releasing storage I/O');
  assert.ok(outcome.value instanceof ApiClientError);
  assert.equal(outcome.value.code, 'SESSION_STORAGE_ERROR');
}

test('AuthProvider merges avatar/text/extroversion independently and ignores an older avatar read', async () => {
  const avatar = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', width: 512, height: 512, mimeType: 'image/jpeg' };
  const next = { ...avatar, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
  const text = createDeferred(), upload = createDeferred(), read = createDeferred();
  let uploadCount = 0;
  const h = createAuthScreenHarness({ async get() { return null; }, async set() {}, async clear() {} }, async (url, init) => {
    if (url.endsWith('/auth/login')) return jsonResponse(200, authResponse('access', 'refresh'));
    if (url.endsWith('/avatar')) return ++uploadCount === 1 ? upload.promise : jsonResponse(200, { avatar: next });
    if (url.endsWith('/extroversion')) return jsonResponse(200, { ...profile, extroversionLevel: 8 });
    if (init.method === 'PATCH') return text.promise;
    return read.promise;
  });
  h.render(); await drainMicrotasks(120); h.render(); await h.auth().login({ email: 'fixture', password: 'fixture' }); h.render();
  const saveText = h.auth().updateProfile({ displayName: 'New name', bio: 'New bio' });
  const saveAvatar = h.auth().uploadAvatar({ uri: 'native-file', mimeType: 'image/jpeg', file: new Blob(['fixture']) }, () => true);
  await h.auth().updateExtroversion(8); h.render();
  upload.resolve(jsonResponse(200, { avatar })); await saveAvatar; h.render();
  text.resolve(jsonResponse(200, { ...profile, displayName: 'New name', bio: 'New bio', avatar: null })); await saveText; h.render();
  assert.equal(h.auth().user.avatar.id, avatar.id); assert.equal(h.auth().user.displayName, 'New name'); assert.equal(h.auth().user.bio, 'New bio'); assert.equal(h.auth().user.extroversionLevel, 8);
  const oldRead = h.auth().refreshAvatar(() => true);
  await h.auth().uploadAvatar({ uri: 'native-file', mimeType: 'image/jpeg', file: new Blob(['next']) }, () => true); h.render();
  read.resolve(jsonResponse(200, { ...profile, avatar })); await oldRead; h.render();
  assert.equal(h.auth().user.avatar.id, next.id); assert.equal(h.auth().user.displayName, 'New name'); assert.equal(h.auth().user.extroversionLevel, 8);
});

test('AuthProvider never applies avatar results from a closed screen, logout or another account', async () => {
  const avatar = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', width: 512, height: 512, mimeType: 'image/jpeg' };
  for (const transition of ['close', 'logout', 'account']) {
    const late = createDeferred(); let screenCurrent = true, loginCount = 0;
    const h = createAuthScreenHarness({ async get() { return null; }, async set() {}, async clear() {} }, async (url) => {
      if (url.endsWith('/auth/login')) return jsonResponse(200, authResponse('access', 'refresh', ++loginCount === 1 ? profile : { ...profile, id: 'user-b' }));
      if (url.endsWith('/auth/logout')) return noContentResponse();
      return late.promise;
    });
    h.render(); await drainMicrotasks(120); h.render(); await h.auth().login({}); h.render();
    const outcome = observe(h.auth().uploadAvatar({ uri: 'file', mimeType: 'image/jpeg', file: new Blob(['fixture']) }, () => screenCurrent));
    await drainMicrotasks(20);
    if (transition === 'close') screenCurrent = false;
    else if (transition === 'logout') await h.auth().logout();
    else await h.auth().login({});
    h.render(); late.resolve(jsonResponse(200, { avatar })); await outcome.promise; h.render();
    assert.equal(h.auth().user?.avatar ?? null, null);
    if (transition === 'logout') assert.equal(h.auth().status, 'unauthenticated');
    if (transition === 'account') assert.equal(h.auth().user.id, 'user-b');
  }
});

test('AuthProvider publishes manual image retry for the same avatar id without reverting independent profile fields', async () => {
  const avatar = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', width: 512, height: 512, mimeType: 'image/jpeg' };
  let failRead = false, reads = 0;
  const h = createAuthScreenHarness({ async get() { return null; }, async set() {}, async clear() {} }, async (url, init) => {
    if (url.endsWith('/auth/login')) return jsonResponse(200, authResponse('access', 'refresh', { ...profile, avatar }));
    if (init.method === 'PATCH') return jsonResponse(200, { ...profile, displayName: 'New name', avatar });
    if (init.method === 'PUT') return jsonResponse(200, { ...profile, extroversionLevel: 8, avatar });
    reads++; if (failRead) throw Error('offline');
    return jsonResponse(200, { ...profile, avatar });
  });
  h.render(); await drainMicrotasks(120); h.render(); await h.auth().login({}); h.render();
  await h.auth().updateProfile({ displayName: 'New name' }); h.render(); await h.auth().updateExtroversion(8); h.render();
  assert.equal(h.auth().avatarReloadKey, '');
  await h.auth().refreshAvatar(() => true); h.render(); const first = h.auth().avatarReloadKey;
  assert.ok(first); assert.equal(h.auth().user.avatar.id, avatar.id);
  assert.equal(h.auth().user.displayName, 'New name'); assert.equal(h.auth().user.extroversionLevel, 8);
  await h.auth().refreshAvatar(() => true); h.render(); const second = h.auth().avatarReloadKey;
  assert.notEqual(second, first); failRead = true;
  await assert.rejects(h.auth().refreshAvatar(() => true)); h.render(); assert.equal(h.auth().avatarReloadKey, second);
  await drainMicrotasks(120); assert.equal(reads, 3, 'No automatic retry after a failed read');
});

test('late manual avatar reads cannot send retry signals into a closed screen or newer account/session', async () => {
  const avatar = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', width: 512, height: 512, mimeType: 'image/jpeg' };
  for (const transition of ['close', 'logout', 'account', 'same-account-login']) {
    const late = createDeferred(); let current = true, loginCount = 0;
    const h = createAuthScreenHarness({ async get() { return null; }, async set() {}, async clear() {} }, async url => {
      if (url.endsWith('/auth/login')) return jsonResponse(200, authResponse('access', 'refresh', { ...profile, avatar,
        id: ++loginCount > 1 && transition === 'account' ? 'user-b' : profile.id }));
      if (url.endsWith('/auth/logout')) return noContentResponse();
      return late.promise;
    });
    h.render(); await drainMicrotasks(120); h.render(); await h.auth().login({}); h.render();
    const result = observe(h.auth().refreshAvatar(() => current)); await drainMicrotasks(20);
    if (transition === 'close') current = false;
    else if (transition === 'logout') await h.auth().logout(); else await h.auth().login({});
    h.render(); late.resolve(jsonResponse(200, { ...profile, avatar })); await result.promise; h.render();
    assert.equal(h.auth().avatarReloadKey, '');
    if (transition === 'account') assert.equal(h.auth().user.id, 'user-b');
    if (transition === 'logout') assert.equal(h.auth().user, null);
  }
});

function createClient(fetchImpl, storage, onSessionCleared) {
  return new ApiClient({
    baseUrl: () => 'http://api.test/api/v1',
    fetchImpl,
    refreshTokenStorage: storage,
    onSessionCleared,
  });
}

async function loginClient(client) {
  await client.login({
    email: 'person@example.test',
    password: 'test-password',
  });
}

test('default browser fetch keeps its global receiver instead of receiving ApiClient', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', function (url) {
    assert.equal(this, globalThis, 'Browser fetch requires the global receiver');
    calls += 1;
    if (url.endsWith('/auth/login')) {
      return Promise.resolve(jsonResponse(200, authResponse('access-web', 'refresh-web')));
    }
    assert.ok(url.endsWith('/users/me'));
    return Promise.resolve(jsonResponse(200, profile));
  });
  const client = new ApiClient({
    baseUrl: () => 'http://api.test/api/v1',
    refreshTokenStorage: createMemoryStorage().storage,
  });
  await loginClient(client);
  assert.deepEqual(await client.getMe(), profile);
  assert.equal(calls, 2);
});

test('normalizes the backend API error envelope', () => {
  const error = normalizeApiError(409, {
    statusCode: 409,
    error: {
      code: 'EMAIL_ALREADY_EXISTS',
      message: 'Email already exists',
      details: ['email must be unique'],
    },
    path: '/api/v1/auth/register',
    timestamp: '2026-09-05T00:00:00.000Z',
  });

  assert.ok(error instanceof ApiClientError);
  assert.equal(error.statusCode, 409);
  assert.equal(error.code, 'EMAIL_ALREADY_EXISTS');
  assert.equal(error.message, 'Email already exists');
  assert.deepEqual(error.details, ['email must be unique']);
});

test('maps unavailable API responses to a localized retryable error', () => {
  const error = new ApiClientError({
    statusCode: 503,
    code: 'SERVICE_UNAVAILABLE',
    message: 'Service unavailable',
  });

  assert.equal(getRequestErrorTranslationKey(error), 'common.error.network');
  assert.equal(isRetryableRequestError(error), true);
});

test('restores a stored session by rotating refresh and loading /users/me', async () => {
  const memory = createMemoryStorage('refresh-old');
  const calls = [];
  const client = createClient(async (url, init) => {
    calls.push({ url, authorization: init?.headers?.Authorization });
    if (url.endsWith('/auth/refresh')) {
      return jsonResponse(200, authResponse('access-new', 'refresh-new'));
    }
    if (url.endsWith('/users/me')) return jsonResponse(200, profile);
    throw new Error('Unexpected request');
  }, memory.storage);

  const restored = await client.restoreSession();

  assert.deepEqual(restored, profile);
  assert.equal(memory.read(), 'refresh-new');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].authorization, 'Bearer access-new');
});

test('retries a protected request once after INVALID_ACCESS_TOKEN', async () => {
  const memory = createMemoryStorage();
  let meCalls = 0;
  let refreshCalls = 0;
  const client = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-old', 'refresh-old'));
    }
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return jsonResponse(200, authResponse('access-new', 'refresh-new'));
    }
    if (url.endsWith('/users/me')) {
      meCalls += 1;
      if (meCalls === 1) return errorResponse(401, 'INVALID_ACCESS_TOKEN');
      assert.equal(init?.headers?.Authorization, 'Bearer access-new');
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected request');
  }, memory.storage);

  await loginClient(client);
  assert.deepEqual(await client.getMe(), profile);
  assert.equal(refreshCalls, 1);
  assert.equal(meCalls, 2);
  assert.equal(memory.read(), 'refresh-new');
});

test('does not enter a refresh loop when the retried request is also 401', async () => {
  const memory = createMemoryStorage();
  let meCalls = 0;
  let refreshCalls = 0;
  const client = createClient(async (url) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-old', 'refresh-old'));
    }
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return jsonResponse(200, authResponse('access-new', 'refresh-new'));
    }
    if (url.endsWith('/users/me')) {
      meCalls += 1;
      return errorResponse(401, 'INVALID_ACCESS_TOKEN');
    }
    throw new Error('Unexpected request');
  }, memory.storage);

  await loginClient(client);
  await assert.rejects(() => client.getMe(), ApiClientError);
  assert.equal(refreshCalls, 1);
  assert.equal(meCalls, 2);
});

test('shares one refresh rotation between parallel protected 401 responses', async () => {
  const memory = createMemoryStorage();
  let refreshCalls = 0;
  let oldTokenRequests = 0;
  const client = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-old', 'refresh-old'));
    }
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return jsonResponse(200, authResponse('access-new', 'refresh-new'));
    }
    if (url.endsWith('/users/me')) {
      if (init?.headers?.Authorization === 'Bearer access-old') {
        oldTokenRequests += 1;
        return errorResponse(401, 'INVALID_ACCESS_TOKEN');
      }
      assert.equal(init?.headers?.Authorization, 'Bearer access-new');
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected request');
  }, memory.storage);

  await loginClient(client);
  const results = await Promise.all([client.getMe(), client.getMe()]);

  assert.equal(results.length, 2);
  assert.equal(oldTokenRequests, 2);
  assert.equal(refreshCalls, 1);
  assert.equal(memory.read(), 'refresh-new');
});

test('clears local session after refresh failure', async () => {
  const memory = createMemoryStorage();
  let invalidationCount = 0;
  const client = createClient(async (url) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-old', 'refresh-old'));
    }
    if (url.endsWith('/auth/refresh')) {
      return errorResponse(401, 'INVALID_REFRESH_TOKEN');
    }
    if (url.endsWith('/users/me')) {
      return errorResponse(401, 'INVALID_ACCESS_TOKEN');
    }
    throw new Error('Unexpected request');
  }, memory.storage, () => {
    invalidationCount += 1;
  });

  await loginClient(client);
  await assert.rejects(() => client.getMe(), ApiClientError);

  assert.equal(memory.read(), null);
  assert.ok(memory.clearCount() >= 1);
  assert.ok(invalidationCount >= 1);
});

test('logout with an expired access token does not start a new refresh', async () => {
  const memory = createMemoryStorage();
  const logoutAttempted = createDeferred();
  let logoutCalls = 0;
  let refreshCalls = 0;
  const client = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-old', 'refresh-old'));
    }
    if (url.endsWith('/auth/logout')) {
      logoutCalls += 1;
      assert.equal(init?.headers?.Authorization, 'Bearer access-old');
      logoutAttempted.resolve();
      return errorResponse(401, 'INVALID_ACCESS_TOKEN');
    }
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      throw new Error('Logout must not start a refresh from persistent storage');
    }
    throw new Error('Unexpected request');
  }, memory.storage);

  await loginClient(client);
  await client.logout();
  await logoutAttempted.promise;
  await drainMicrotasks();

  assert.equal(logoutCalls, 1);
  assert.equal(refreshCalls, 0);
  assert.equal(memory.read(), null);
  assert.deepEqual(memory.storedValues(), ['refresh-old']);
});

test('expired-access logout clears tokens without restoring the session', async () => {
  const memory = createMemoryStorage();
  let logoutCalls = 0;
  let refreshCalls = 0;
  let protectedCalls = 0;
  const client = createClient(async (url) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-old', 'refresh-old'));
    }
    if (url.endsWith('/auth/logout')) {
      logoutCalls += 1;
      return errorResponse(401, 'INVALID_ACCESS_TOKEN');
    }
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return errorResponse(401, 'INVALID_REFRESH_TOKEN');
    }
    if (url.endsWith('/users/me')) {
      protectedCalls += 1;
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected request');
  }, memory.storage);

  await loginClient(client);
  await client.logout();
  await drainMicrotasks();

  assert.equal(logoutCalls, 1);
  assert.equal(refreshCalls, 0);
  assert.equal(memory.read(), null);
  await assert.rejects(
    () => client.getMe(),
    (error) => error instanceof ApiClientError
      && error.code === 'INVALID_REFRESH_TOKEN',
  );
  assert.equal(protectedCalls, 0);
  assert.equal(await client.restoreSession(), null);
});

test('an in-flight refresh cannot restore tokens after logout starts', async () => {
  const memory = createMemoryStorage();
  const refreshStarted = createDeferred();
  const refreshResponse = createDeferred();
  const firstLogoutStarted = createDeferred();
  const retriedLogoutFinished = createDeferred();
  let refreshCalls = 0;
  let logoutCalls = 0;
  let protectedCalls = 0;
  const client = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-old', 'refresh-old'));
    }
    if (url.endsWith('/users/me')) {
      protectedCalls += 1;
      return errorResponse(401, 'INVALID_ACCESS_TOKEN');
    }
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      refreshStarted.resolve();
      return refreshResponse.promise;
    }
    if (url.endsWith('/auth/logout')) {
      logoutCalls += 1;
      if (logoutCalls === 1) {
        assert.equal(init?.headers?.Authorization, 'Bearer access-old');
        firstLogoutStarted.resolve();
        return errorResponse(401, 'INVALID_ACCESS_TOKEN');
      }
      assert.equal(init?.headers?.Authorization, 'Bearer access-new');
      retriedLogoutFinished.resolve();
      return noContentResponse();
    }
    throw new Error('Unexpected request');
  }, memory.storage);

  await loginClient(client);
  const protectedOutcome = client.getMe().then(
    (value) => value,
    (error) => error,
  );
  await refreshStarted.promise;

  const logoutPromise = client.logout();
  await logoutPromise;
  await firstLogoutStarted.promise;
  assert.equal(memory.read(), null);
  await assert.rejects(
    () => client.getMe(),
    (error) => error instanceof ApiClientError
      && error.code === 'INVALID_REFRESH_TOKEN',
  );
  refreshResponse.resolve(
    jsonResponse(200, authResponse('access-new', 'refresh-new')),
  );
  await retriedLogoutFinished.promise;
  await drainMicrotasks();

  const protectedError = await protectedOutcome;
  assert.ok(protectedError instanceof ApiClientError);
  assert.equal(protectedError.code, 'INVALID_REFRESH_TOKEN');
  assert.equal(refreshCalls, 1);
  assert.equal(logoutCalls, 2);
  assert.equal(protectedCalls, 1);
  assert.equal(memory.read(), null);
  assert.deepEqual(memory.storedValues(), ['refresh-old']);

  await assert.rejects(
    () => client.getMe(),
    (error) => error instanceof ApiClientError
      && error.code === 'INVALID_REFRESH_TOKEN',
  );
  assert.equal(refreshCalls, 1);
  assert.equal(protectedCalls, 1);
});

test('logout clears a refresh token write that was already in progress', async () => {
  const rotationSetStarted = createDeferred();
  const releaseRotationSet = createDeferred();
  let storedToken = null;
  let setCalls = 0;
  const storage = {
    async get() { return storedToken; },
    async set(nextValue) {
      setCalls += 1;
      if (setCalls === 1) {
        storedToken = nextValue;
        return;
      }
      rotationSetStarted.resolve();
      await releaseRotationSet.promise;
      storedToken = nextValue;
    },
    async clear() { storedToken = null; },
  };
  let logoutCalls = 0;
  const client = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-old', 'refresh-old'));
    }
    if (url.endsWith('/users/me')) {
      return errorResponse(401, 'INVALID_ACCESS_TOKEN');
    }
    if (url.endsWith('/auth/refresh')) {
      return jsonResponse(200, authResponse('access-new', 'refresh-new'));
    }
    if (url.endsWith('/auth/logout')) {
      logoutCalls += 1;
      assert.equal(init?.headers?.Authorization, 'Bearer access-old');
      return noContentResponse();
    }
    throw new Error('Unexpected request');
  }, storage);

  await loginClient(client);
  const protectedOutcome = client.getMe().catch((error) => error);
  await rotationSetStarted.promise;
  const logoutPromise = client.logout();
  releaseRotationSet.resolve();
  await logoutPromise;

  const protectedError = await protectedOutcome;
  assert.ok(protectedError instanceof ApiClientError);
  assert.equal(protectedError.code, 'INVALID_REFRESH_TOKEN');
  assert.equal(logoutCalls, 1);
  assert.equal(storedToken, null);
});

test('parallel logout calls share one bounded backend operation', async () => {
  const memory = createMemoryStorage();
  const logoutStarted = createDeferred();
  const logoutResponse = createDeferred();
  let logoutCalls = 0;
  let refreshCalls = 0;
  let invalidationCount = 0;
  const client = createClient(async (url) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-old', 'refresh-old'));
    }
    if (url.endsWith('/auth/logout')) {
      logoutCalls += 1;
      logoutStarted.resolve();
      return logoutResponse.promise;
    }
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return jsonResponse(200, authResponse('access-new', 'refresh-new'));
    }
    throw new Error('Unexpected request');
  }, memory.storage, () => {
    invalidationCount += 1;
  });

  await loginClient(client);
  const firstLogout = client.logout();
  const secondLogout = client.logout();
  const thirdLogout = client.logout();
  assert.equal(firstLogout, secondLogout);
  assert.equal(secondLogout, thirdLogout);

  await logoutStarted.promise;
  assert.equal(logoutCalls, 1);
  logoutResponse.resolve(noContentResponse());
  await Promise.all([firstLogout, secondLogout, thirdLogout]);

  assert.equal(logoutCalls, 1);
  assert.equal(refreshCalls, 0);
  assert.equal(invalidationCount, 1);
  assert.equal(memory.read(), null);
  assert.deepEqual(memory.storedValues(), ['refresh-old']);
});

test('logout clears both tokens when the backend request fails', async () => {
  const memory = createMemoryStorage();
  let logoutCalls = 0;
  let protectedCalls = 0;
  const client = createClient(async (url) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-old', 'refresh-old'));
    }
    if (url.endsWith('/auth/logout')) {
      logoutCalls += 1;
      throw new Error('Backend unavailable');
    }
    if (url.endsWith('/users/me')) {
      protectedCalls += 1;
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected request');
  }, memory.storage);

  await loginClient(client);
  await client.logout();

  assert.equal(logoutCalls, 1);
  assert.equal(memory.read(), null);
  await assert.rejects(
    () => client.getMe(),
    (error) => error instanceof ApiClientError
      && error.code === 'INVALID_REFRESH_TOKEN',
  );
  assert.equal(protectedCalls, 0);
});

test('offline logout tombstone blocks an undeleted refresh token after restart', async () => {
  const durable = createDurableStorage();
  let refreshCalls = 0;
  const client = createClient(async (url) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-old', 'refresh-old'));
    }
    if (url.endsWith('/auth/logout')) {
      throw new Error('Backend unavailable');
    }
    throw new Error('Unexpected request');
  }, durable.storage);

  await loginClient(client);
  durable.failures.deleteToken = true;
  await client.logout();

  assert.equal(JSON.parse(durable.values.get(durable.keys.token)).refreshToken, 'refresh-old');
  assert.ok(durable.values.get(durable.keys.invalidated));

  const restartedClient = createClient(async (url) => {
    if (url.endsWith('/auth/refresh')) refreshCalls += 1;
    throw new Error('No request expected while tombstoned');
  }, durable.storage);

  assert.equal(await restartedClient.restoreSession(), null);
  assert.equal(refreshCalls, 0);
});

test('failed logout fences refresh and remains retryable after storage recovers', async () => {
  const durable = createDurableStorage();
  let logoutCalls = 0;
  let refreshCalls = 0;
  let invalidationCount = 0;
  const client = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-old', 'refresh-old'));
    }
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      assert.deepEqual(JSON.parse(init?.body), { refreshToken: 'refresh-old' });
      return jsonResponse(200, authResponse('access-retry', 'refresh-retry'));
    }
    if (url.endsWith('/auth/logout')) {
      logoutCalls += 1;
      if (logoutCalls === 1) throw new Error('Backend unavailable');
      assert.equal(init?.headers?.Authorization, 'Bearer access-retry');
      return noContentResponse();
    }
    throw new Error('Unexpected request');
  }, durable.storage, () => {
    invalidationCount += 1;
  });

  await loginClient(client);
  durable.failures.writeMarker = true;
  durable.failures.deleteToken = true;

  await assert.rejects(
    () => client.logout(),
    (error) => error instanceof ApiClientError
      && error.code === 'SESSION_STORAGE_ERROR',
  );
  assert.equal(invalidationCount, 0);
  assert.equal(JSON.parse(durable.values.get(durable.keys.token)).refreshToken, 'refresh-old');
  const tokenReadsAtFence = durable.reads.token;
  await assert.rejects(
    () => client.getMe(),
    (error) => error instanceof ApiClientError
      && error.code === 'SESSION_STORAGE_ERROR',
  );
  await assert.rejects(
    () => client.restoreSession(),
    (error) => error instanceof ApiClientError
      && error.code === 'SESSION_STORAGE_ERROR',
  );
  assert.equal(refreshCalls, 0);
  assert.equal(durable.reads.token, tokenReadsAtFence);

  durable.failures.writeMarker = false;
  durable.failures.deleteToken = false;
  await client.logout();
  await drainMicrotasks();

  assert.equal(logoutCalls, 1);
  assert.equal(refreshCalls, 0);
  assert.equal(invalidationCount, 1);
  assert.equal(durable.values.has(durable.keys.token), false);
  assert.equal(durable.values.has(durable.keys.invalidated), true);
  assert.equal(await durable.storage.get(), null);
  assert.equal(await client.restoreSession(), null);
});

test('stale login cannot overwrite a newer post-logout session', async () => {
  const durable = createDurableStorage();
  const loginAResponse = createDeferred();
  let loginCalls = 0;
  const client = createClient(async (url) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      if (loginCalls === 1) return loginAResponse.promise;
      return jsonResponse(200, authResponse('access-b', 'refresh-b'));
    }
    throw new Error('Unexpected request');
  }, durable.storage);

  const loginA = client.login({
    email: 'first@example.test',
    password: 'test-password',
  });
  await client.logout();
  await client.login({
    email: 'second@example.test',
    password: 'test-password',
  });

  loginAResponse.resolve(
    jsonResponse(200, authResponse('access-a', 'refresh-a')),
  );
  await assert.rejects(
    () => loginA,
    (error) => error instanceof ApiClientError
      && error.code === 'INVALID_REFRESH_TOKEN',
  );
  assert.equal(JSON.parse(durable.values.get(durable.keys.token)).refreshToken, 'refresh-b');

  let restoredWithToken = null;
  const restartedClient = createClient(async (url, init) => {
    if (url.endsWith('/auth/refresh')) {
      restoredWithToken = JSON.parse(init?.body).refreshToken;
      return jsonResponse(200, authResponse('access-b2', 'refresh-b2'));
    }
    if (url.endsWith('/users/me')) return jsonResponse(200, profile);
    throw new Error('Unexpected request');
  }, durable.storage);

  assert.deepEqual(await restartedClient.restoreSession(), profile);
  assert.equal(restoredWithToken, 'refresh-b');
  assert.equal(JSON.parse(durable.values.get(durable.keys.token)).refreshToken, 'refresh-b2');
});

test('a newer login prevents a deferred restore from mutating its session', async () => {
  const durable = createDurableStorage('refresh-restore');
  const refreshStarted = createDeferred();
  const restoreRefreshResponse = createDeferred();
  let restoreProfileCalls = 0;
  const client = createClient(async (url) => {
    if (url.endsWith('/auth/refresh')) {
      refreshStarted.resolve();
      return restoreRefreshResponse.promise;
    }
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-b', 'refresh-b'));
    }
    if (url.endsWith('/users/me')) {
      restoreProfileCalls += 1;
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected request');
  }, durable.storage);

  const restoreOutcome = client.restoreSession().catch((error) => error);
  await refreshStarted.promise;
  await client.login({
    email: 'second@example.test',
    password: 'test-password',
  });

  restoreRefreshResponse.resolve(
    jsonResponse(200, authResponse('access-restore', 'refresh-restore-next')),
  );
  const restoreError = await restoreOutcome;

  assert.ok(restoreError instanceof ApiClientError);
  assert.equal(restoreError.code, 'INVALID_REFRESH_TOKEN');
  assert.equal(restoreProfileCalls, 0);
  assert.equal(JSON.parse(durable.values.get(durable.keys.token)).refreshToken, 'refresh-b');
});

test('the later-started parallel login owns the session when it finishes first', async () => {
  const durable = createDurableStorage();
  const loginAResponse = createDeferred();
  const loginBResponse = createDeferred();
  let loginCalls = 0;
  let profileAuthorization = null;
  const client = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      return loginCalls === 1
        ? loginAResponse.promise
        : loginBResponse.promise;
    }
    if (url.endsWith('/users/me')) {
      profileAuthorization = init?.headers?.Authorization;
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected request');
  }, durable.storage);

  const loginA = client.login({
    email: 'first@example.test',
    password: 'test-password',
  });
  const loginB = client.login({
    email: 'second@example.test',
    password: 'test-password',
  });

  loginBResponse.resolve(
    jsonResponse(200, authResponse('access-b', 'refresh-b')),
  );
  await loginB;
  loginAResponse.resolve(
    jsonResponse(200, authResponse('access-a', 'refresh-a')),
  );

  await assert.rejects(
    () => loginA,
    (error) => error instanceof ApiClientError
      && error.code === 'INVALID_REFRESH_TOKEN',
  );
  assert.equal(JSON.parse(durable.values.get(durable.keys.token)).refreshToken, 'refresh-b');
  assert.deepEqual(await client.getMe(), profile);
  assert.equal(profileAuthorization, 'Bearer access-b');
});

test('restore cannot displace an explicit login waiting for its network response', async () => {
  const loginBStarted = createDeferred();
  const loginBResponse = createDeferred();
  let storedToken = null;
  let getCalls = 0;
  let clearCalls = 0;
  const storage = {
    async get() {
      getCalls += 1;
      return storedToken;
    },
    async set(nextToken) { storedToken = nextToken; },
    async clear() {
      clearCalls += 1;
      storedToken = null;
    },
  };
  let loginCalls = 0;
  let refreshCalls = 0;
  let sessionClearedCalls = 0;
  const client = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      if (loginCalls === 1) {
        return jsonResponse(200, authResponse('access-a', 'refresh-a'));
      }
      loginBStarted.resolve();
      return loginBResponse.promise;
    }
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      throw new Error('Blocked restore must not refresh');
    }
    if (url.endsWith('/users/me')) {
      assert.equal(init?.headers?.Authorization, 'Bearer access-b');
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected request');
  }, storage, () => {
    sessionClearedCalls += 1;
  });

  await loginClient(client);
  const loginB = client.login({
    email: 'second@example.test',
    password: 'test-password',
  });
  await loginBStarted.promise;

  await assert.rejects(
    () => client.restoreSession(),
    (error) => error instanceof ApiClientError
      && error.code === 'INVALID_REFRESH_TOKEN',
  );
  assert.equal(getCalls, 0);
  assert.equal(refreshCalls, 0);
  assert.equal(clearCalls, 0);
  assert.equal(sessionClearedCalls, 0);
  assert.equal(storedToken, 'refresh-a');

  loginBResponse.resolve(
    jsonResponse(200, authResponse('access-b', 'refresh-b')),
  );
  await loginB;
  assert.equal(storedToken, 'refresh-b');
  assert.deepEqual(await client.getMe(), profile);
});

test('restore cannot displace an explicit login during its durable token write', async () => {
  const writeBStarted = createDeferred();
  const releaseWriteB = createDeferred();
  let storedToken = null;
  let setCalls = 0;
  let getCalls = 0;
  let clearCalls = 0;
  const storage = {
    async get() {
      getCalls += 1;
      return storedToken;
    },
    async set(nextToken) {
      setCalls += 1;
      storedToken = nextToken;
      if (setCalls === 2) {
        writeBStarted.resolve();
        await releaseWriteB.promise;
      }
    },
    async clear() {
      clearCalls += 1;
      storedToken = null;
    },
  };
  let loginCalls = 0;
  let refreshCalls = 0;
  let sessionClearedCalls = 0;
  const client = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      return loginCalls === 1
        ? jsonResponse(200, authResponse('access-a', 'refresh-a'))
        : jsonResponse(200, authResponse('access-b', 'refresh-b'));
    }
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      throw new Error('Blocked restore must not refresh');
    }
    if (url.endsWith('/users/me')) {
      assert.equal(init?.headers?.Authorization, 'Bearer access-b');
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected request');
  }, storage, () => {
    sessionClearedCalls += 1;
  });

  await loginClient(client);
  let loginBSettled = false;
  const loginB = client.login({
    email: 'second@example.test',
    password: 'test-password',
  }).then((response) => {
    loginBSettled = true;
    return response;
  });
  await writeBStarted.promise;
  assert.equal(storedToken, 'refresh-b');

  await assert.rejects(
    () => client.restoreSession(),
    (error) => error instanceof ApiClientError
      && error.code === 'INVALID_REFRESH_TOKEN',
  );
  assert.equal(loginBSettled, false);
  assert.equal(getCalls, 0);
  assert.equal(refreshCalls, 0);
  assert.equal(clearCalls, 0);
  assert.equal(sessionClearedCalls, 0);
  assert.equal(storedToken, 'refresh-b');

  releaseWriteB.resolve();
  await loginB;
  assert.equal(storedToken, 'refresh-b');
  assert.deepEqual(await client.getMe(), profile);
});

test('restore in another client cannot displace a shared explicit login write', async () => {
  const writeBStarted = createDeferred();
  const releaseWriteB = createDeferred();
  let storedToken = null;
  let setCalls = 0;
  let getCalls = 0;
  let clearCalls = 0;
  const storage = {
    async get() {
      getCalls += 1;
      return storedToken;
    },
    async set(nextToken) {
      setCalls += 1;
      storedToken = nextToken;
      if (setCalls === 2) {
        writeBStarted.resolve();
        await releaseWriteB.promise;
      }
    },
    async clear() {
      clearCalls += 1;
      storedToken = null;
    },
  };
  let refreshCalls = 0;
  let sessionClearedA = 0;
  let sessionClearedB = 0;
  const clientA = createClient(async (url) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-a', 'refresh-a'));
    }
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      throw new Error('Blocked cross-client restore must not refresh');
    }
    throw new Error('Unexpected client A request');
  }, storage, () => {
    sessionClearedA += 1;
  });
  const clientB = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-b', 'refresh-b'));
    }
    if (url.endsWith('/users/me')) {
      assert.equal(init?.headers?.Authorization, 'Bearer access-b');
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected client B request');
  }, storage, () => {
    sessionClearedB += 1;
  });

  await loginClient(clientA);
  const loginB = clientB.login({
    email: 'second@example.test',
    password: 'test-password',
  });
  await writeBStarted.promise;
  assert.equal(storedToken, 'refresh-b');

  await assert.rejects(
    () => clientA.restoreSession(),
    (error) => error instanceof ApiClientError
      && error.code === 'INVALID_REFRESH_TOKEN',
  );
  assert.equal(getCalls, 0);
  assert.equal(refreshCalls, 0);
  assert.equal(clearCalls, 0);
  assert.equal(sessionClearedA, 0);
  assert.equal(sessionClearedB, 0);
  assert.equal(storedToken, 'refresh-b');

  releaseWriteB.resolve();
  await loginB;
  assert.equal(storedToken, 'refresh-b');
  assert.deepEqual(await clientB.getMe(), profile);
});

test('an explicit login replaces a tombstoned token and restores normally', async () => {
  const durable = createDurableStorage('refresh-old');
  durable.values.set(durable.keys.invalidated, '1');
  const client = createClient(async (url) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-new', 'refresh-new'));
    }
    throw new Error('Unexpected request');
  }, durable.storage);

  await loginClient(client);

  assert.equal(JSON.parse(durable.values.get(durable.keys.token)).refreshToken, 'refresh-new');
  assert.equal(await durable.storage.get(), 'refresh-new');

  let restoredWithToken = null;
  const restartedClient = createClient(async (url, init) => {
    if (url.endsWith('/auth/refresh')) {
      restoredWithToken = JSON.parse(init?.body).refreshToken;
      return jsonResponse(200, authResponse('access-next', 'refresh-next'));
    }
    if (url.endsWith('/users/me')) return jsonResponse(200, profile);
    throw new Error('Unexpected request');
  }, durable.storage);

  assert.deepEqual(await restartedClient.restoreSession(), profile);
  assert.equal(restoredWithToken, 'refresh-new');
  assert.equal(JSON.parse(durable.values.get(durable.keys.token)).refreshToken, 'refresh-next');
});

test('a stale deferred token write is cleared even when its replacement login fails', async () => {
  const setStarted = createDeferred();
  const releaseSet = createDeferred();
  let storedToken = null;
  let clearCalls = 0;
  let refreshCalls = 0;
  let sessionClearedCalls = 0;
  const storage = {
    async get() { return storedToken; },
    async set(refreshToken) {
      setStarted.resolve();
      await releaseSet.promise;
      storedToken = refreshToken;
    },
    async clear() {
      storedToken = null;
      clearCalls += 1;
    },
  };
  let loginCalls = 0;
  const client = createClient(async (url) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      if (loginCalls === 1) {
        return jsonResponse(200, authResponse('access-a', 'refresh-a'));
      }
      return errorResponse(401, 'INVALID_CREDENTIALS');
    }
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return jsonResponse(200, authResponse('unexpected', 'unexpected'));
    }
    throw new Error('Unexpected request');
  }, storage, () => {
    sessionClearedCalls += 1;
  });

  const loginAOutcome = client.login({
    email: 'first@example.test',
    password: 'test-password',
  }).catch((error) => error);
  await setStarted.promise;
  await assert.rejects(
    () => client.login({
      email: 'second@example.test',
      password: 'wrong-password',
    }),
    (error) => error instanceof ApiClientError
      && error.code === 'INVALID_CREDENTIALS',
  );

  releaseSet.resolve();
  const loginAError = await loginAOutcome;
  assert.ok(loginAError instanceof ApiClientError);
  assert.equal(loginAError.code, 'INVALID_REFRESH_TOKEN');
  assert.equal(storedToken, null);
  assert.equal(clearCalls, 1);
  assert.equal(sessionClearedCalls, 0);

  await assert.rejects(
    () => client.getMe(),
    (error) => error instanceof ApiClientError
      && error.code === 'INVALID_REFRESH_TOKEN',
  );
  assert.equal(refreshCalls, 0);
});

test('an impossible logout failure fences every client sharing the storage', async () => {
  const durable = createDurableStorage();
  let clientBNetworkCalls = 0;
  const clientA = createClient(async (url) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-old', 'refresh-old'));
    }
    if (url.endsWith('/auth/logout')) {
      throw new Error('Backend unavailable');
    }
    throw new Error('Unexpected request');
  }, durable.storage);

  await loginClient(clientA);
  durable.failures.writeMarker = true;
  durable.failures.deleteToken = true;
  await assert.rejects(
    () => clientA.logout(),
    (error) => error instanceof ApiClientError
      && error.code === 'SESSION_STORAGE_ERROR',
  );

  const tokenReadsAtFence = durable.reads.token;
  const clientB = createClient(async () => {
    clientBNetworkCalls += 1;
    throw new Error('No network request expected while fenced');
  }, durable.storage);

  await assert.rejects(
    () => clientB.getMe(),
    (error) => error instanceof ApiClientError
      && error.code === 'SESSION_STORAGE_ERROR',
  );
  await assert.rejects(
    () => clientB.restoreSession(),
    (error) => error instanceof ApiClientError
      && error.code === 'SESSION_STORAGE_ERROR',
  );
  assert.equal(clientBNetworkCalls, 0);
  assert.equal(durable.reads.token, tokenReadsAtFence);
});

test('two concurrent restores in one client coalesce one refresh without cleanup', async () => {
  const memory = createMemoryStorage('refresh-old');
  const refreshStarted = createDeferred();
  const refreshResponse = createDeferred();
  let refreshCalls = 0;
  let profileCalls = 0;
  const client = createClient(async (url) => {
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      refreshStarted.resolve();
      return refreshResponse.promise;
    }
    if (url.endsWith('/users/me')) {
      profileCalls += 1;
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected request');
  }, memory.storage);

  const firstRestore = client.restoreSession().catch((error) => error);
  await refreshStarted.promise;
  const secondRestore = client.restoreSession();
  refreshResponse.resolve(
    jsonResponse(200, authResponse('access-new', 'refresh-new')),
  );

  const firstResult = await firstRestore;
  const secondResult = await secondRestore;
  assert.ok(firstResult instanceof ApiClientError);
  assert.equal(firstResult.code, 'INVALID_REFRESH_TOKEN');
  assert.deepEqual(secondResult, profile);
  assert.equal(refreshCalls, 1);
  assert.equal(profileCalls, 1);
  assert.equal(memory.clearCount(), 0);
  assert.equal(memory.read(), 'refresh-new');
});

test('two clients sharing storage coalesce concurrent restore without losing the session', async () => {
  const memory = createMemoryStorage('refresh-old');
  const refreshStarted = createDeferred();
  const refreshResponse = createDeferred();
  let refreshCalls = 0;
  let profileCalls = 0;
  const sharedFetch = async (url) => {
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      refreshStarted.resolve();
      return refreshResponse.promise;
    }
    if (url.endsWith('/users/me')) {
      profileCalls += 1;
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected request');
  };
  const clientA = createClient(sharedFetch, memory.storage);
  const clientB = createClient(sharedFetch, memory.storage);

  const restoreA = clientA.restoreSession().catch((error) => error);
  await refreshStarted.promise;
  const restoreB = clientB.restoreSession();
  refreshResponse.resolve(
    jsonResponse(200, authResponse('access-new', 'refresh-new')),
  );

  const resultA = await restoreA;
  const resultB = await restoreB;
  assert.ok(resultA instanceof ApiClientError);
  assert.equal(resultA.code, 'INVALID_REFRESH_TOKEN');
  assert.deepEqual(resultB, profile);
  assert.equal(refreshCalls, 1);
  assert.equal(profileCalls, 1);
  assert.equal(memory.clearCount(), 0);
  assert.equal(memory.read(), 'refresh-new');
});

test('a restore starting during refresh storage commit adopts the rotated session', async () => {
  const firstSetStarted = createDeferred();
  const releaseFirstSet = createDeferred();
  let storedToken = 'refresh-old';
  let setCalls = 0;
  let clearCalls = 0;
  const storage = {
    async get() { return storedToken; },
    async set(nextToken) {
      setCalls += 1;
      if (setCalls === 1) {
        firstSetStarted.resolve();
        await releaseFirstSet.promise;
      }
      storedToken = nextToken;
    },
    async clear() {
      storedToken = null;
      clearCalls += 1;
    },
  };
  let refreshCalls = 0;
  let profileCalls = 0;
  const client = createClient(async (url) => {
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return jsonResponse(200, authResponse('access-new', 'refresh-new'));
    }
    if (url.endsWith('/users/me')) {
      profileCalls += 1;
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected request');
  }, storage);

  const firstRestore = client.restoreSession().catch((error) => error);
  await firstSetStarted.promise;
  const secondRestore = client.restoreSession();
  releaseFirstSet.resolve();

  const firstResult = await firstRestore;
  const secondResult = await secondRestore;
  assert.ok(firstResult instanceof ApiClientError);
  assert.equal(firstResult.code, 'INVALID_REFRESH_TOKEN');
  assert.deepEqual(secondResult, profile);
  assert.equal(refreshCalls, 1);
  assert.equal(profileCalls, 1);
  assert.equal(clearCalls, 1);
  assert.equal(setCalls, 2);
  assert.equal(storedToken, 'refresh-new');
});

test('a new login clears a shared recovery fence and only its token is restored', async () => {
  const durable = createDurableStorage();
  const refreshedTokens = [];
  let loginCalls = 0;
  let refreshCalls = 0;
  const sharedFetch = async (url, init) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      return loginCalls === 1
        ? jsonResponse(200, authResponse('access-old', 'refresh-old'))
        : jsonResponse(200, authResponse('access-new', 'refresh-new'));
    }
    if (url.endsWith('/auth/logout')) {
      throw new Error('Backend unavailable');
    }
    if (url.endsWith('/auth/refresh')) {
      const refreshToken = JSON.parse(init?.body).refreshToken;
      refreshedTokens.push(refreshToken);
      refreshCalls += 1;
      return refreshCalls === 1
        ? jsonResponse(200, authResponse('access-shared', 'refresh-shared'))
        : jsonResponse(200, authResponse('access-restarted', 'refresh-restarted'));
    }
    if (url.endsWith('/users/me')) return jsonResponse(200, profile);
    throw new Error('Unexpected request');
  };
  const clientA = createClient(sharedFetch, durable.storage);
  const clientB = createClient(sharedFetch, durable.storage);

  await loginClient(clientA);
  durable.failures.writeMarker = true;
  durable.failures.deleteToken = true;
  await assert.rejects(
    () => clientA.logout(),
    (error) => error instanceof ApiClientError
      && error.code === 'SESSION_STORAGE_ERROR',
  );
  await assert.rejects(
    () => clientB.getMe(),
    (error) => error instanceof ApiClientError
      && error.code === 'SESSION_STORAGE_ERROR',
  );

  durable.failures.writeMarker = false;
  durable.failures.deleteToken = false;
  await clientB.login({
    email: 'second@example.test',
    password: 'test-password',
  });
  assert.equal(JSON.parse(durable.values.get(durable.keys.token)).refreshToken, 'refresh-new');
  assert.equal(await durable.storage.get(), 'refresh-new');

  assert.deepEqual(await clientA.getMe(), profile);
  const restartedClient = createClient(
    sharedFetch,
    durable.createStorage(),
  );
  assert.deepEqual(await restartedClient.restoreSession(), profile);

  assert.deepEqual(refreshedTokens, ['refresh-new', 'refresh-shared']);
  assert.equal(JSON.parse(durable.values.get(durable.keys.token)).refreshToken, 'refresh-restarted');
});

test('a pending login is never adopted by an older protected request', async () => {
  const memory = createMemoryStorage();
  const loginBResponse = createDeferred();
  const refreshStarted = createDeferred();
  const oldRefreshResponse = createDeferred();
  let loginCalls = 0;
  let refreshCalls = 0;
  let sessionClearedCalls = 0;
  const protectedTokens = [];
  const client = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      return loginCalls === 1
        ? jsonResponse(200, authResponse('access-a', 'refresh-a'))
        : loginBResponse.promise;
    }
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      assert.deepEqual(JSON.parse(init?.body), { refreshToken: 'refresh-a' });
      refreshStarted.resolve();
      return oldRefreshResponse.promise;
    }
    if (url.endsWith('/users/me')) {
      const authorization = init?.headers?.Authorization;
      protectedTokens.push(authorization);
      if (authorization === 'Bearer access-a') {
        return errorResponse(401, 'INVALID_ACCESS_TOKEN');
      }
      assert.equal(authorization, 'Bearer access-b');
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected request');
  }, memory.storage, () => {
    sessionClearedCalls += 1;
  });

  await loginClient(client);
  const loginB = client.login({
    email: 'second@example.test',
    password: 'test-password',
  });
  const oldRequest = client.getMe().catch((error) => error);
  await refreshStarted.promise;

  loginBResponse.resolve(
    jsonResponse(200, authResponse('access-b', 'refresh-b')),
  );
  await loginB;
  oldRefreshResponse.resolve(
    jsonResponse(200, authResponse('access-a2', 'refresh-a2')),
  );

  const oldError = await oldRequest;
  assert.ok(oldError instanceof ApiClientError);
  assert.equal(oldError.code, 'INVALID_REFRESH_TOKEN');
  assert.equal(refreshCalls, 1);
  assert.equal(sessionClearedCalls, 0);
  assert.equal(memory.read(), 'refresh-b');
  assert.deepEqual(await client.getMe(), profile);
  assert.deepEqual(protectedTokens, [
    'Bearer access-a',
    'Bearer access-b',
  ]);
});

test('a late protected response cannot cross into a newly published session', async () => {
  const memory = createMemoryStorage();
  const oldProfileResponse = createDeferred();
  let loginCalls = 0;
  let profileCalls = 0;
  const client = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      return loginCalls === 1
        ? jsonResponse(200, authResponse('access-a', 'refresh-a'))
        : jsonResponse(200, authResponse('access-b', 'refresh-b'));
    }
    if (url.endsWith('/users/me')) {
      profileCalls += 1;
      if (profileCalls === 1) {
        assert.equal(init?.headers?.Authorization, 'Bearer access-a');
        return oldProfileResponse.promise;
      }
      assert.equal(init?.headers?.Authorization, 'Bearer access-b');
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected request');
  }, memory.storage);

  await loginClient(client);
  const oldRequest = client.getMe().catch((error) => error);
  await client.login({
    email: 'second@example.test',
    password: 'test-password',
  });
  oldProfileResponse.resolve(jsonResponse(200, profile));

  const oldError = await oldRequest;
  assert.ok(oldError instanceof ApiClientError);
  assert.equal(oldError.code, 'INVALID_REFRESH_TOKEN');
  assert.equal(memory.read(), 'refresh-b');
  assert.deepEqual(await client.getMe(), profile);
});

test('a refresh started before a new login cannot overwrite its committed tokens', async () => {
  const memory = createMemoryStorage();
  const refreshStarted = createDeferred();
  const oldRefreshResponse = createDeferred();
  let loginCalls = 0;
  const client = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      return loginCalls === 1
        ? jsonResponse(200, authResponse('access-a', 'refresh-a'))
        : jsonResponse(200, authResponse('access-b', 'refresh-b'));
    }
    if (url.endsWith('/users/me')) {
      if (init?.headers?.Authorization === 'Bearer access-a') {
        return errorResponse(401, 'INVALID_ACCESS_TOKEN');
      }
      assert.equal(init?.headers?.Authorization, 'Bearer access-b');
      return jsonResponse(200, profile);
    }
    if (url.endsWith('/auth/refresh')) {
      assert.deepEqual(JSON.parse(init?.body), { refreshToken: 'refresh-a' });
      refreshStarted.resolve();
      return oldRefreshResponse.promise;
    }
    throw new Error('Unexpected request');
  }, memory.storage);

  await loginClient(client);
  const oldRequest = client.getMe().catch((error) => error);
  await refreshStarted.promise;
  await client.login({
    email: 'second@example.test',
    password: 'test-password',
  });

  oldRefreshResponse.resolve(
    jsonResponse(200, authResponse('access-a2', 'refresh-a2')),
  );
  const oldError = await oldRequest;
  assert.ok(oldError instanceof ApiClientError);
  assert.equal(oldError.code, 'INVALID_REFRESH_TOKEN');
  assert.equal(memory.read(), 'refresh-b');
  assert.deepEqual(await client.getMe(), profile);
});

test('a pending cross-client login cannot lend ownership to an older client', async () => {
  const memory = createMemoryStorage();
  const loginBResponse = createDeferred();
  const refreshStarted = createDeferred();
  const oldRefreshResponse = createDeferred();
  const clientAFetch = async (url, init) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-a', 'refresh-a'));
    }
    if (url.endsWith('/users/me')) {
      return errorResponse(401, 'INVALID_ACCESS_TOKEN');
    }
    if (url.endsWith('/auth/refresh')) {
      assert.deepEqual(JSON.parse(init?.body), { refreshToken: 'refresh-a' });
      refreshStarted.resolve();
      return oldRefreshResponse.promise;
    }
    throw new Error('Unexpected client A request');
  };
  const clientBFetch = async (url, init) => {
    if (url.endsWith('/auth/login')) return loginBResponse.promise;
    if (url.endsWith('/users/me')) {
      assert.equal(init?.headers?.Authorization, 'Bearer access-b');
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected client B request');
  };
  const clientA = createClient(clientAFetch, memory.storage);
  const clientB = createClient(clientBFetch, memory.storage);

  await loginClient(clientA);
  const loginB = clientB.login({
    email: 'second@example.test',
    password: 'test-password',
  });
  const oldRequest = clientA.getMe().catch((error) => error);
  await refreshStarted.promise;

  loginBResponse.resolve(
    jsonResponse(200, authResponse('access-b', 'refresh-b')),
  );
  await loginB;
  oldRefreshResponse.resolve(
    jsonResponse(200, authResponse('access-a2', 'refresh-a2')),
  );

  const oldError = await oldRequest;
  assert.ok(oldError instanceof ApiClientError);
  assert.equal(oldError.code, 'INVALID_REFRESH_TOKEN');
  assert.equal(memory.read(), 'refresh-b');
  assert.deepEqual(await clientB.getMe(), profile);
});

test('a newer register attempt exclusively publishes its credentials', async () => {
  const memory = createMemoryStorage();
  const staleLoginResponse = createDeferred();
  const client = createClient(async (url) => {
    if (url.endsWith('/auth/login')) return staleLoginResponse.promise;
    if (url.endsWith('/auth/register')) {
      return jsonResponse(200, authResponse('access-r', 'refresh-r'));
    }
    if (url.endsWith('/users/me')) return jsonResponse(200, profile);
    throw new Error('Unexpected request');
  }, memory.storage);

  const staleLogin = client.login({
    email: 'first@example.test',
    password: 'test-password',
  }).catch((error) => error);
  await client.register({
    email: 'registered@example.test',
    password: 'test-password',
    handle: 'registered',
    displayName: 'Registered',
  });
  staleLoginResponse.resolve(
    jsonResponse(200, authResponse('access-stale', 'refresh-stale')),
  );

  const staleError = await staleLogin;
  assert.ok(staleError instanceof ApiClientError);
  assert.equal(staleError.code, 'INVALID_REFRESH_TOKEN');
  assert.equal(memory.read(), 'refresh-r');
  assert.deepEqual(await client.getMe(), profile);
});

test('logout clears storage without waiting for a hanging token read', async () => {
  const neverRead = createDeferred();
  let storedToken = null;
  let shouldHangGet = false;
  let getCalls = 0;
  let clearCalls = 0;
  const storage = {
    async get() {
      getCalls += 1;
      return shouldHangGet ? neverRead.promise : storedToken;
    },
    async set(nextToken) { storedToken = nextToken; },
    async clear() {
      storedToken = null;
      clearCalls += 1;
    },
  };
  let loginCalls = 0;
  let logoutCalls = 0;
  const client = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      return loginCalls === 1
        ? jsonResponse(200, authResponse('access-a', 'refresh-a'))
        : jsonResponse(200, authResponse('access-b', 'refresh-b'));
    }
    if (url.endsWith('/auth/logout')) {
      logoutCalls += 1;
      assert.equal(init?.headers?.Authorization, 'Bearer access-a');
      return noContentResponse();
    }
    throw new Error('Unexpected request');
  }, storage);

  await loginClient(client);
  shouldHangGet = true;
  let logoutSettled = false;
  const logout = client.logout().then(() => {
    logoutSettled = true;
  });
  await drainMicrotasks(24);

  assert.equal(logoutSettled, true);
  assert.equal(getCalls, 0);
  assert.equal(clearCalls, 1);
  assert.equal(storedToken, null);
  await logout;

  await client.login({
    email: 'second@example.test',
    password: 'test-password',
  });
  assert.equal(storedToken, 'refresh-b');
  await drainMicrotasks();
  assert.equal(logoutCalls, 1);
});

test('logout with a hanging token read rejects cleanup failure and unblocks login', async () => {
  const neverRead = createDeferred();
  let storedToken = null;
  let shouldHangGet = false;
  let clearShouldFail = false;
  let clearCalls = 0;
  const storage = {
    async get() {
      return shouldHangGet ? neverRead.promise : storedToken;
    },
    async set(nextToken) { storedToken = nextToken; },
    async clear() {
      clearCalls += 1;
      if (clearShouldFail) throw new Error('SecureStore clear failed');
      storedToken = null;
    },
  };
  let loginCalls = 0;
  const client = createClient(async (url) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      return loginCalls === 1
        ? jsonResponse(200, authResponse('access-a', 'refresh-a'))
        : jsonResponse(200, authResponse('access-b', 'refresh-b'));
    }
    if (url.endsWith('/auth/logout')) throw new Error('Backend unavailable');
    throw new Error('Unexpected request');
  }, storage);

  await loginClient(client);
  shouldHangGet = true;
  clearShouldFail = true;
  const logoutOutcome = client.logout().catch((error) => error);
  await drainMicrotasks(24);

  const logoutError = await logoutOutcome;
  assert.ok(logoutError instanceof ApiClientError);
  assert.equal(logoutError.code, 'SESSION_STORAGE_ERROR');
  assert.equal(clearCalls, 1);

  clearShouldFail = false;
  await client.login({
    email: 'second@example.test',
    password: 'test-password',
  });
  assert.equal(storedToken, 'refresh-b');
});

test('logout clears locally despite a hanging get and late in-flight refresh', async () => {
  const refreshStarted = createDeferred();
  const oldRefreshResponse = createDeferred();
  const neverRead = createDeferred();
  let storedToken = null;
  let shouldHangGet = false;
  let getCalls = 0;
  let clearCalls = 0;
  const storage = {
    async get() {
      getCalls += 1;
      return shouldHangGet ? neverRead.promise : storedToken;
    },
    async set(nextToken) { storedToken = nextToken; },
    async clear() {
      storedToken = null;
      clearCalls += 1;
    },
  };
  let loginCalls = 0;
  let logoutCalls = 0;
  const client = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      return loginCalls === 1
        ? jsonResponse(200, authResponse('access-a', 'refresh-a'))
        : jsonResponse(200, authResponse('access-b', 'refresh-b'));
    }
    if (url.endsWith('/users/me')) {
      if (init?.headers?.Authorization === 'Bearer access-a') {
        return errorResponse(401, 'INVALID_ACCESS_TOKEN');
      }
      assert.equal(init?.headers?.Authorization, 'Bearer access-b');
      return jsonResponse(200, profile);
    }
    if (url.endsWith('/auth/refresh')) {
      refreshStarted.resolve();
      return oldRefreshResponse.promise;
    }
    if (url.endsWith('/auth/logout')) {
      logoutCalls += 1;
      return noContentResponse();
    }
    throw new Error('Unexpected request');
  }, storage);

  await loginClient(client);
  const oldRequest = client.getMe().catch((error) => error);
  await refreshStarted.promise;
  assert.equal(getCalls, 1);
  shouldHangGet = true;
  let logoutSettled = false;
  const logout = client.logout().then(() => {
    logoutSettled = true;
  });
  await drainMicrotasks(24);

  assert.equal(logoutSettled, true);
  assert.equal(getCalls, 1);
  assert.equal(storedToken, null);
  assert.equal(clearCalls, 1);
  await client.login({
    email: 'second@example.test',
    password: 'test-password',
  });
  assert.equal(storedToken, 'refresh-b');

  oldRefreshResponse.resolve(
    jsonResponse(200, authResponse('access-a2', 'refresh-a2')),
  );
  await logout;
  const oldError = await oldRequest;
  assert.ok(oldError instanceof ApiClientError);
  assert.equal(oldError.code, 'INVALID_REFRESH_TOKEN');
  assert.equal(storedToken, 'refresh-b');
  assert.equal(logoutCalls, 1);
  assert.deepEqual(await client.getMe(), profile);
});

test('a pending refresh storage read cannot block logout or the next login', async () => {
  const controlled = createControlledReadStorage();
  let loginCalls = 0;
  let refreshCalls = 0;
  let logoutCalls = 0;
  const client = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      return loginCalls === 1
        ? jsonResponse(200, authResponse('access-a', 'refresh-a'))
        : jsonResponse(200, authResponse('access-b', 'refresh-b'));
    }
    if (url.endsWith('/users/me')) {
      if (init?.headers?.Authorization === 'Bearer access-a') {
        return errorResponse(401, 'INVALID_ACCESS_TOKEN');
      }
      assert.equal(init?.headers?.Authorization, 'Bearer access-b');
      return jsonResponse(200, profile);
    }
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      throw new Error('A stale storage read must not start refresh');
    }
    if (url.endsWith('/auth/logout')) {
      logoutCalls += 1;
      assert.equal(init?.headers?.Authorization, 'Bearer access-a');
      return noContentResponse();
    }
    throw new Error('Unexpected request');
  }, controlled.storage);

  await loginClient(client);
  const blockedRead = controlled.blockReads();
  const oldRequest = client.getMe().catch((error) => error);
  await blockedRead.started;

  let logoutSettled = false;
  const logout = client.logout().then(() => {
    logoutSettled = true;
  });
  await drainMicrotasks(24);
  assert.equal(logoutSettled, true);
  assert.equal(controlled.clearCount(), 1);
  assert.equal(controlled.read(), null);
  await logout;

  let loginSettled = false;
  const loginB = client.login({
    email: 'second@example.test',
    password: 'test-password',
  }).then((response) => {
    loginSettled = true;
    return response;
  });
  await drainMicrotasks(24);
  assert.equal(loginSettled, true);
  await loginB;
  assert.equal(controlled.read(), 'refresh-b');

  blockedRead.release('refresh-a');
  const oldError = await oldRequest;
  assert.ok(oldError instanceof ApiClientError);
  assert.equal(oldError.code, 'INVALID_REFRESH_TOKEN');
  assert.equal(refreshCalls, 0);
  assert.equal(logoutCalls, 1);
  assert.equal(controlled.read(), 'refresh-b');
  assert.deepEqual(await client.getMe(), profile);
});

test('a pending restore storage read cannot block logout or the next login', async () => {
  const controlled = createControlledReadStorage();
  let loginCalls = 0;
  let refreshCalls = 0;
  let logoutCalls = 0;
  const sharedFetch = async (url, init) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      return loginCalls === 1
        ? jsonResponse(200, authResponse('access-a', 'refresh-a'))
        : jsonResponse(200, authResponse('access-b', 'refresh-b'));
    }
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      throw new Error('A stale restore read must not start refresh');
    }
    if (url.endsWith('/auth/logout')) {
      logoutCalls += 1;
      assert.equal(init?.headers?.Authorization, 'Bearer access-a');
      return noContentResponse();
    }
    if (url.endsWith('/users/me')) {
      assert.equal(init?.headers?.Authorization, 'Bearer access-b');
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected request');
  };
  const sessionClient = createClient(sharedFetch, controlled.storage);
  const restoreClient = createClient(sharedFetch, controlled.storage);

  await loginClient(sessionClient);
  const blockedRead = controlled.blockReads();
  const oldRestore = restoreClient.restoreSession().catch((error) => error);
  await blockedRead.started;

  let logoutSettled = false;
  const logout = sessionClient.logout().then(() => {
    logoutSettled = true;
  });
  await drainMicrotasks(24);
  assert.equal(logoutSettled, true);
  assert.equal(controlled.clearCount(), 1);
  assert.equal(controlled.read(), null);
  await logout;

  await sessionClient.login({
    email: 'second@example.test',
    password: 'test-password',
  });
  assert.equal(controlled.read(), 'refresh-b');

  blockedRead.release('refresh-a');
  const restoreError = await oldRestore;
  assert.ok(restoreError instanceof ApiClientError);
  assert.equal(restoreError.code, 'INVALID_REFRESH_TOKEN');
  assert.equal(refreshCalls, 0);
  assert.equal(logoutCalls, 1);
  assert.equal(controlled.read(), 'refresh-b');
  assert.deepEqual(await sessionClient.getMe(), profile);
});

test('clear failure during a pending read fences restore but not recovery login', async () => {
  const controlled = createControlledReadStorage();
  let loginCalls = 0;
  let refreshCalls = 0;
  const sharedFetch = async (url, init) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      return loginCalls === 1
        ? jsonResponse(200, authResponse('access-a', 'refresh-a'))
        : jsonResponse(200, authResponse('access-b', 'refresh-b'));
    }
    if (url.endsWith('/users/me')) {
      if (init?.headers?.Authorization === 'Bearer access-a') {
        return errorResponse(401, 'INVALID_ACCESS_TOKEN');
      }
      assert.equal(init?.headers?.Authorization, 'Bearer access-b');
      return jsonResponse(200, profile);
    }
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      throw new Error('A stale fenced read must not start refresh');
    }
    if (url.endsWith('/auth/logout')) throw new Error('Backend unavailable');
    throw new Error('Unexpected request');
  };
  const clientA = createClient(sharedFetch, controlled.storage);
  const clientB = createClient(sharedFetch, controlled.storage);

  await loginClient(clientA);
  const blockedRead = controlled.blockReads();
  const oldRequest = clientA.getMe().catch((error) => error);
  await blockedRead.started;
  controlled.failClear(true);

  let logoutSettled = false;
  const logoutOutcome = clientA.logout().then(
    () => {
      logoutSettled = true;
      return null;
    },
    (error) => {
      logoutSettled = true;
      return error;
    },
  );
  await drainMicrotasks(24);
  assert.equal(logoutSettled, true);
  const logoutError = await logoutOutcome;
  assert.ok(logoutError instanceof ApiClientError);
  assert.equal(logoutError.code, 'SESSION_STORAGE_ERROR');
  assert.equal(controlled.clearCount(), 1);
  assert.equal(controlled.read(), 'refresh-a');

  await assert.rejects(
    () => clientB.restoreSession(),
    (error) => error instanceof ApiClientError
      && error.code === 'SESSION_STORAGE_ERROR',
  );

  controlled.failClear(false);
  await clientB.login({
    email: 'second@example.test',
    password: 'test-password',
  });
  assert.equal(controlled.read(), 'refresh-b');

  blockedRead.release('refresh-a');
  const oldError = await oldRequest;
  assert.ok(oldError instanceof ApiClientError);
  assert.equal(oldError.code, 'INVALID_REFRESH_TOKEN');
  assert.equal(refreshCalls, 0);
  assert.equal(controlled.read(), 'refresh-b');
  assert.deepEqual(await clientB.getMe(), profile);
});

test('credential write fence rejects a stale read before it can use token B', async () => {
  const readStarted = createDeferred();
  const releaseRead = createDeferred();
  const writeBStarted = createDeferred();
  const releaseWriteB = createDeferred();
  let storedToken = null;
  let shouldBlockRead = false;
  let setCalls = 0;
  let clearCalls = 0;
  const storage = {
    async get() {
      if (!shouldBlockRead) return storedToken;
      readStarted.resolve();
      await releaseRead.promise;
      return storedToken;
    },
    async set(nextToken) {
      setCalls += 1;
      storedToken = nextToken;
      if (setCalls === 2) {
        writeBStarted.resolve();
        await releaseWriteB.promise;
      }
    },
    async clear() {
      clearCalls += 1;
      storedToken = null;
    },
  };
  let loginCalls = 0;
  const refreshedTokens = [];
  let sessionClearedCalls = 0;
  const client = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      return loginCalls === 1
        ? jsonResponse(200, authResponse('access-a', 'refresh-a'))
        : jsonResponse(200, authResponse('access-b', 'refresh-b'));
    }
    if (url.endsWith('/users/me')) {
      if (init?.headers?.Authorization === 'Bearer access-a') {
        return errorResponse(401, 'INVALID_ACCESS_TOKEN');
      }
      assert.equal(init?.headers?.Authorization, 'Bearer access-b');
      return jsonResponse(200, profile);
    }
    if (url.endsWith('/auth/refresh')) {
      refreshedTokens.push(JSON.parse(init?.body).refreshToken);
      return errorResponse(401, 'INVALID_REFRESH_TOKEN');
    }
    throw new Error('Unexpected request');
  }, storage, () => {
    sessionClearedCalls += 1;
  });

  await loginClient(client);
  shouldBlockRead = true;
  let oldRequestSettled = false;
  const oldRequest = client.getMe().then(
    (value) => {
      oldRequestSettled = true;
      return value;
    },
    (error) => {
      oldRequestSettled = true;
      return error;
    },
  );
  await readStarted.promise;

  let loginBSettled = false;
  const loginB = client.login({
    email: 'second@example.test',
    password: 'test-password',
  }).then((response) => {
    loginBSettled = true;
    return response;
  });
  await writeBStarted.promise;
  assert.equal(storedToken, 'refresh-b');

  releaseRead.resolve();
  await drainMicrotasks(24);
  assert.equal(oldRequestSettled, true);
  assert.equal(loginBSettled, false);
  assert.deepEqual(refreshedTokens, []);
  const oldError = await oldRequest;
  assert.ok(oldError instanceof ApiClientError);
  assert.equal(oldError.code, 'INVALID_REFRESH_TOKEN');
  assert.equal(clearCalls, 0);
  assert.equal(sessionClearedCalls, 0);

  releaseWriteB.resolve();
  await loginB;
  assert.equal(storedToken, 'refresh-b');
  assert.deepEqual(await client.getMe(), profile);
});

test('credential write fence stops an old refresh failure from clearing login B', async () => {
  const refreshStarted = createDeferred();
  const oldRefreshResponse = createDeferred();
  const writeBStarted = createDeferred();
  const releaseWriteB = createDeferred();
  let storedToken = null;
  let setCalls = 0;
  let clearCalls = 0;
  const storage = {
    async get() { return storedToken; },
    async set(nextToken) {
      setCalls += 1;
      storedToken = nextToken;
      if (setCalls === 2) {
        writeBStarted.resolve();
        await releaseWriteB.promise;
      }
    },
    async clear() {
      clearCalls += 1;
      storedToken = null;
    },
  };
  let loginCalls = 0;
  let sessionClearedCalls = 0;
  const client = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      return loginCalls === 1
        ? jsonResponse(200, authResponse('access-a', 'refresh-a'))
        : jsonResponse(200, authResponse('access-b', 'refresh-b'));
    }
    if (url.endsWith('/users/me')) {
      if (init?.headers?.Authorization === 'Bearer access-a') {
        return errorResponse(401, 'INVALID_ACCESS_TOKEN');
      }
      assert.equal(init?.headers?.Authorization, 'Bearer access-b');
      return jsonResponse(200, profile);
    }
    if (url.endsWith('/auth/refresh')) {
      assert.deepEqual(JSON.parse(init?.body), { refreshToken: 'refresh-a' });
      refreshStarted.resolve();
      return oldRefreshResponse.promise;
    }
    throw new Error('Unexpected request');
  }, storage, () => {
    sessionClearedCalls += 1;
  });

  await loginClient(client);
  let oldRequestSettled = false;
  const oldRequest = client.getMe().then(
    (value) => {
      oldRequestSettled = true;
      return value;
    },
    (error) => {
      oldRequestSettled = true;
      return error;
    },
  );
  await refreshStarted.promise;

  let loginBSettled = false;
  const loginB = client.login({
    email: 'second@example.test',
    password: 'test-password',
  }).then((response) => {
    loginBSettled = true;
    return response;
  });
  await writeBStarted.promise;
  assert.equal(storedToken, 'refresh-b');

  oldRefreshResponse.resolve(errorResponse(401, 'INVALID_REFRESH_TOKEN'));
  await drainMicrotasks(24);
  assert.equal(oldRequestSettled, true);
  assert.equal(loginBSettled, false);
  const oldError = await oldRequest;
  assert.ok(oldError instanceof ApiClientError);
  assert.equal(oldError.code, 'INVALID_REFRESH_TOKEN');
  assert.equal(clearCalls, 0);
  assert.equal(sessionClearedCalls, 0);
  assert.equal(storedToken, 'refresh-b');

  releaseWriteB.resolve();
  await loginB;
  assert.equal(storedToken, 'refresh-b');
  assert.deepEqual(await client.getMe(), profile);
});

test('credential write fence protects login B across clients sharing storage', async () => {
  const refreshStarted = createDeferred();
  const oldRefreshResponse = createDeferred();
  const writeBStarted = createDeferred();
  const releaseWriteB = createDeferred();
  let storedToken = null;
  let setCalls = 0;
  let clearCalls = 0;
  const storage = {
    async get() { return storedToken; },
    async set(nextToken) {
      setCalls += 1;
      storedToken = nextToken;
      if (setCalls === 2) {
        writeBStarted.resolve();
        await releaseWriteB.promise;
      }
    },
    async clear() {
      clearCalls += 1;
      storedToken = null;
    },
  };
  let sessionClearedA = 0;
  let sessionClearedB = 0;
  const clientA = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-a', 'refresh-a'));
    }
    if (url.endsWith('/users/me')) {
      assert.equal(init?.headers?.Authorization, 'Bearer access-a');
      return errorResponse(401, 'INVALID_ACCESS_TOKEN');
    }
    if (url.endsWith('/auth/refresh')) {
      assert.deepEqual(JSON.parse(init?.body), { refreshToken: 'refresh-a' });
      refreshStarted.resolve();
      return oldRefreshResponse.promise;
    }
    throw new Error('Unexpected client A request');
  }, storage, () => {
    sessionClearedA += 1;
  });
  const clientB = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-b', 'refresh-b'));
    }
    if (url.endsWith('/users/me')) {
      assert.equal(init?.headers?.Authorization, 'Bearer access-b');
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected client B request');
  }, storage, () => {
    sessionClearedB += 1;
  });

  await loginClient(clientA);
  let oldRequestSettled = false;
  const oldRequest = clientA.getMe().then(
    (value) => {
      oldRequestSettled = true;
      return value;
    },
    (error) => {
      oldRequestSettled = true;
      return error;
    },
  );
  await refreshStarted.promise;

  let loginBSettled = false;
  const loginB = clientB.login({
    email: 'second@example.test',
    password: 'test-password',
  }).then((response) => {
    loginBSettled = true;
    return response;
  });
  await writeBStarted.promise;
  assert.equal(storedToken, 'refresh-b');

  oldRefreshResponse.resolve(errorResponse(401, 'INVALID_REFRESH_TOKEN'));
  await drainMicrotasks(24);
  assert.equal(oldRequestSettled, true);
  assert.equal(loginBSettled, false);
  const oldError = await oldRequest;
  assert.ok(oldError instanceof ApiClientError);
  assert.equal(oldError.code, 'INVALID_REFRESH_TOKEN');
  assert.equal(clearCalls, 0);
  assert.equal(sessionClearedA, 0);
  assert.equal(sessionClearedB, 0);

  releaseWriteB.resolve();
  await loginB;
  assert.equal(storedToken, 'refresh-b');
  assert.deepEqual(await clientB.getMe(), profile);
});

test('failed fenced credential write permits a later recovery login', async () => {
  let storedToken = null;
  let setCalls = 0;
  let clearCalls = 0;
  let clearShouldFail = true;
  const storage = {
    async get() { return storedToken; },
    async set(nextToken) {
      setCalls += 1;
      storedToken = nextToken;
      if (setCalls === 2) throw new Error('SecureStore set failed');
    },
    async clear() {
      clearCalls += 1;
      if (clearShouldFail) throw new Error('SecureStore clear failed');
      storedToken = null;
    },
  };
  let loginCalls = 0;
  let protectedCalls = 0;
  let sessionClearedCalls = 0;
  const client = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      if (loginCalls === 1) {
        return jsonResponse(200, authResponse('access-a', 'refresh-a'));
      }
      if (loginCalls === 2) {
        return jsonResponse(200, authResponse('access-b', 'refresh-b'));
      }
      return jsonResponse(200, authResponse('access-c', 'refresh-c'));
    }
    if (url.endsWith('/users/me')) {
      protectedCalls += 1;
      assert.equal(init?.headers?.Authorization, 'Bearer access-c');
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected request');
  }, storage, () => {
    sessionClearedCalls += 1;
  });

  await loginClient(client);
  await assert.rejects(
    () => client.login({
      email: 'second@example.test',
      password: 'test-password',
    }),
    (error) => error instanceof ApiClientError
      && error.code === 'SESSION_STORAGE_ERROR',
  );
  assert.equal(setCalls, 2);
  assert.equal(clearCalls, 1);
  assert.equal(storedToken, 'refresh-b');
  assert.equal(sessionClearedCalls, 0);

  await assert.rejects(
    () => client.getMe(),
    (error) => error instanceof ApiClientError
      && error.code === 'SESSION_STORAGE_ERROR',
  );
  assert.equal(protectedCalls, 0);

  clearShouldFail = false;
  await client.login({
    email: 'third@example.test',
    password: 'test-password',
  });
  assert.equal(setCalls, 3);
  assert.equal(storedToken, 'refresh-c');
  assert.deepEqual(await client.getMe(), profile);
});

test('two clients coalesce logout without duplicate server revocation', async () => {
  const memory = createMemoryStorage();
  let logoutCalls = 0;
  let clientACleared = 0;
  let clientBCleared = 0;
  const sharedFetch = async (url) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-a', 'refresh-a'));
    }
    if (url.endsWith('/auth/logout')) {
      logoutCalls += 1;
      return noContentResponse();
    }
    throw new Error('Unexpected request');
  };
  const clientA = createClient(sharedFetch, memory.storage, () => {
    clientACleared += 1;
  });
  const clientB = createClient(sharedFetch, memory.storage, () => {
    clientBCleared += 1;
  });

  await loginClient(clientA);
  await Promise.all([clientA.logout(), clientB.logout()]);
  await drainMicrotasks();

  assert.equal(logoutCalls, 1);
  assert.equal(memory.read(), null);
  assert.equal(clientACleared, 1);
  assert.equal(clientBCleared, 1);
});

test('a hanging token write times out logout without reporting local success', async () => {
  const controlled = createControlledWriteStorage();
  let loginCalls = 0;
  const client = createClient(async (url) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      return loginCalls === 1
        ? jsonResponse(200, authResponse('access-a', 'refresh-a'))
        : jsonResponse(200, authResponse('access-b', 'refresh-b'));
    }
    throw new Error('Unexpected request');
  }, controlled.storage);

  await loginClient(client);
  const blockedWrite = controlled.blockNextWrite({ writeAfterRelease: true });
  const loginBOutcome = client.login({
    email: 'second@example.test',
    password: 'test-password',
  }).catch((error) => error);
  await blockedWrite.started;

  let logoutSettled = false;
  const logoutOutcome = client.logout().then(
    () => {
      logoutSettled = true;
      return null;
    },
    (error) => {
      logoutSettled = true;
      return error;
    },
  );
  controlled.expireWrite();
  const logoutError = await logoutOutcome;

  assert.equal(logoutSettled, true);
  assert.ok(logoutError instanceof ApiClientError);
  assert.equal(logoutError.code, 'SESSION_STORAGE_ERROR');
  assert.equal(controlled.clearCount(), 1);
  assert.equal(controlled.read(), null);

  await assert.rejects(
    () => client.login({
      email: 'third@example.test',
      password: 'test-password',
    }),
    (error) => error instanceof ApiClientError
      && error.code === 'SESSION_STORAGE_ERROR',
  );
  assert.equal(loginCalls, 2);

  blockedWrite.release();
  await controlled.waitForClearCount(2);
  const loginBError = await loginBOutcome;
  assert.ok(loginBError instanceof ApiClientError);
  assert.equal(loginBError.code, 'INVALID_REFRESH_TOKEN');
  assert.equal(controlled.read(), null);
});

test('a hanging refresh-token rotation cannot keep logout pending', async () => {
  const controlled = createControlledWriteStorage();
  let profileCalls = 0;
  let logoutCalls = 0;
  const client = createClient(async (url) => {
    if (url.endsWith('/auth/login')) {
      return jsonResponse(200, authResponse('access-a', 'refresh-a'));
    }
    if (url.endsWith('/users/me')) {
      profileCalls += 1;
      return errorResponse(401, 'INVALID_ACCESS_TOKEN');
    }
    if (url.endsWith('/auth/refresh')) {
      return jsonResponse(200, authResponse('access-b', 'refresh-b'));
    }
    if (url.endsWith('/auth/logout')) {
      logoutCalls += 1;
      return noContentResponse();
    }
    throw new Error('Unexpected request');
  }, controlled.storage);

  await loginClient(client);
  const blockedWrite = controlled.blockNextWrite();
  const protectedOutcome = client.getMe().catch((error) => error);
  await blockedWrite.started;

  const logoutOutcome = client.logout().catch((error) => error);
  controlled.expireWrite();
  const logoutError = await logoutOutcome;

  assert.ok(logoutError instanceof ApiClientError);
  assert.equal(logoutError.code, 'SESSION_STORAGE_ERROR');
  assert.equal(controlled.clearCount(), 1);
  assert.equal(controlled.read(), null);
  assert.equal(profileCalls, 1);

  blockedWrite.release();
  await controlled.waitForClearCount(2);
  const protectedError = await protectedOutcome;
  assert.ok(protectedError instanceof ApiClientError);
  assert.equal(protectedError.code, 'INVALID_REFRESH_TOKEN');
  await drainMicrotasks();
  assert.equal(logoutCalls, 1);
  assert.equal(controlled.read(), null);
});

test('a timed-out durable write stays tombstoned for a restarted client', async () => {
  const keys = {
    token: 'timeout.refresh-token',
    invalidated: 'timeout.session-invalidated',
  };
  const values = new Map();
  const deadline = createManualWriteDeadline();
  const writeStarted = createDeferred();
  const releaseWrite = createDeferred();
  const finalCleanup = createDeferred();
  const durableStorage = {
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) {
      values.set(key, value);
      if (key === keys.token && JSON.parse(value).refreshToken === 'refresh-b') {
        writeStarted.resolve();
        await releaseWrite.promise;
      }
      if (key.endsWith('.result') && JSON.parse(value).state === 'aborted') {
        finalCleanup.resolve();
      }
    },
    async deleteItem(key) { values.delete(key); },
  };
  const storage = createFailClosedRefreshTokenStorage(durableStorage, keys);
  storage.createWriteDeadline = () => deadline.create();
  let loginCalls = 0;
  let refreshCalls = 0;
  const client = createClient(async (url) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      return loginCalls === 1
        ? jsonResponse(200, authResponse('access-a', 'refresh-a'))
        : jsonResponse(200, authResponse('access-b', 'refresh-b'));
    }
    throw new Error('Unexpected request');
  }, storage);

  await loginClient(client);
  const loginBOutcome = client.login({
    email: 'second@example.test',
    password: 'test-password',
  }).catch((error) => error);
  await writeStarted.promise;
  const logoutOutcome = client.logout().catch((error) => error);
  deadline.expire();
  const logoutError = await logoutOutcome;

  assert.ok(logoutError instanceof ApiClientError);
  assert.equal(logoutError.code, 'SESSION_STORAGE_ERROR');
  assert.equal(JSON.parse(values.get(keys.token)).refreshToken, 'refresh-b');
  const pending = JSON.parse(values.get(`${keys.token}.operation`));
  assert.equal(values.has(`${keys.token}.operation.${pending.id}.result`), false);

  const restartedStorage = createFailClosedRefreshTokenStorage(
    { ...durableStorage },
    keys,
  );
  const restartedClient = createClient(async (url) => {
    if (url.endsWith('/auth/refresh')) refreshCalls += 1;
    throw new Error('A quarantined restart must not use refresh credentials');
  }, restartedStorage);
  await assert.rejects(
    () => restartedClient.restoreSession(),
    (error) => error instanceof ApiClientError
      && error.code === 'SESSION_STORAGE_ERROR',
  );
  assert.equal(refreshCalls, 0);

  releaseWrite.resolve();
  await finalCleanup.promise;
  const loginBError = await loginBOutcome;
  assert.ok(loginBError instanceof ApiClientError);
  assert.equal(loginBError.code, 'INVALID_REFRESH_TOKEN');

  const cleanRestartStorage = createFailClosedRefreshTokenStorage(
    durableStorage,
    keys,
  );
  const cleanRestartClient = createClient(async (url) => {
    if (url.endsWith('/auth/refresh')) refreshCalls += 1;
    throw new Error('No request expected after quarantined cleanup');
  }, cleanRestartStorage);
  assert.equal(await cleanRestartClient.restoreSession(), null);
  assert.equal(refreshCalls, 0);
  assert.equal(values.has(keys.token), false);
});

test('a poisoned write rejects login until late-write cleanup is confirmed', async () => {
  const controlled = createControlledWriteStorage();
  let loginCalls = 0;
  let profileAuthorization = null;
  const client = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      if (loginCalls === 1) {
        return jsonResponse(200, authResponse('access-a', 'refresh-a'));
      }
      if (loginCalls === 2) {
        return jsonResponse(200, authResponse('access-b', 'refresh-b'));
      }
      return jsonResponse(200, authResponse('access-c', 'refresh-c'));
    }
    if (url.endsWith('/users/me')) {
      profileAuthorization = init?.headers?.Authorization;
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected request');
  }, controlled.storage);

  await loginClient(client);
  const blockedWrite = controlled.blockNextWrite();
  const loginBOutcome = client.login({
    email: 'second@example.test',
    password: 'test-password',
  }).catch((error) => error);
  await blockedWrite.started;
  controlled.expireWrite();
  const loginBError = await loginBOutcome;

  assert.ok(loginBError instanceof ApiClientError);
  assert.equal(loginBError.code, 'SESSION_STORAGE_ERROR');
  assert.equal(controlled.clearCount(), 1);
  await assert.rejects(
    () => client.login({
      email: 'third@example.test',
      password: 'test-password',
    }),
    (error) => error instanceof ApiClientError
      && error.code === 'SESSION_STORAGE_ERROR',
  );
  assert.equal(loginCalls, 2);

  blockedWrite.release();
  await controlled.waitForClearCount(2);
  await drainMicrotasks();
  await client.login({
    email: 'third@example.test',
    password: 'test-password',
  });

  assert.equal(loginCalls, 3);
  assert.equal(controlled.read(), 'refresh-c');
  assert.deepEqual(await client.getMe(), profile);
  assert.equal(profileAuthorization, 'Bearer access-c');
});

test('write quarantine is shared by two clients and recovers only after cleanup', async () => {
  const controlled = createControlledWriteStorage();
  let loginCalls = 0;
  const sharedFetch = async (url, init) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      if (loginCalls === 1) {
        return jsonResponse(200, authResponse('access-a', 'refresh-a'));
      }
      if (loginCalls === 2) {
        return jsonResponse(200, authResponse('access-b', 'refresh-b'));
      }
      return jsonResponse(200, authResponse('access-c', 'refresh-c'));
    }
    if (url.endsWith('/users/me')) {
      assert.equal(init?.headers?.Authorization, 'Bearer access-c');
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected request');
  };
  const clientA = createClient(sharedFetch, controlled.storage);
  const clientB = createClient(sharedFetch, controlled.storage);

  await loginClient(clientA);
  const blockedWrite = controlled.blockNextWrite();
  const loginBOutcome = clientB.login({
    email: 'second@example.test',
    password: 'test-password',
  }).catch((error) => error);
  await blockedWrite.started;
  controlled.expireWrite();
  const loginBError = await loginBOutcome;
  assert.ok(loginBError instanceof ApiClientError);
  assert.equal(loginBError.code, 'SESSION_STORAGE_ERROR');

  for (const client of [clientA, clientB]) {
    await assert.rejects(
      () => client.login({
        email: 'third@example.test',
        password: 'test-password',
      }),
      (error) => error instanceof ApiClientError
        && error.code === 'SESSION_STORAGE_ERROR',
    );
  }
  assert.equal(loginCalls, 2);

  blockedWrite.release();
  await controlled.waitForClearCount(2);
  await drainMicrotasks();
  await clientA.login({
    email: 'third@example.test',
    password: 'test-password',
  });

  assert.equal(controlled.read(), 'refresh-c');
  assert.deepEqual(await clientA.getMe(), profile);
});

test('write-ahead pending marker must settle before any token write', async () => {
  const protocol = createProtocolStorage();
  const runtime = protocol.runtime();
  let loginCalls = 0;
  const client = createClient(async (url) => {
    if (url.endsWith('/auth/login')) {
      loginCalls += 1;
      return jsonResponse(200, loginCalls === 1
        ? authResponse('access-a', 'refresh-a') : authResponse('access-b', 'refresh-b'));
    }
    throw new Error('Unexpected request');
  }, runtime.storage);
  await loginClient(client);
  const marker = protocol.block((key) => key === protocol.headKey);
  const loginB = observe(loginClient(client));
  await marker.started;
  assert.equal(protocol.tokenWrites('refresh-b'), 0);
  runtime.expire();
  await assertStorageFailure(loginB);
  await assertStorageFailure(observe(client.logout()));
  await assertStorageFailure(observe(client.getMe()));
  await assertStorageFailure(observe(client.restoreSession()));
  await assertStorageFailure(observe(loginClient(client)));
  assert.equal(loginCalls, 2);

  const reconciled = protocol.whenWrite((key, value) => key.endsWith('.result')
    && JSON.parse(value).state === 'aborted');
  marker.release();
  await reconciled;
  assert.equal(protocol.tokenWrites('refresh-b'), 0);
  assert.equal(await protocol.runtime().storage.get(), null);
});

test('deadline does not wait for a hanging quarantine marker or fallback clear', async (t) => {
  for (const hook of ['quarantinePendingWrite', 'clear']) {
    await t.test(hook, async () => {
      const deadline = createManualWriteDeadline();
      const write = createDeferred();
      const started = createDeferred();
      const invalidation = createDeferred();
      const invalidationStarted = createDeferred();
      const storage = {
        async get() { throw new Error('Quarantine must prevent reads'); },
        async set() { started.resolve(); await write.promise; },
        async clear() {},
        createWriteDeadline: () => deadline.create(),
      };
      storage[hook] = async () => {
        invalidationStarted.resolve();
        await invalidation.promise;
      };
      const fetchImpl = async () => jsonResponse(200, authResponse('access-b', 'refresh-b'));
      const clientA = createClient(fetchImpl, storage);
      const clientB = createClient(fetchImpl, storage);
      const login = observe(loginClient(clientA));
      await started.promise;
      deadline.expire();
      await invalidationStarted.promise;
      await assertStorageFailure(login);
      await assertStorageFailure(observe(clientA.logout()));
      await assertStorageFailure(observe(clientB.logout()));
      await assertStorageFailure(observe(loginClient(clientB)));
      await assertStorageFailure(observe(clientB.restoreSession()));
      // Even a late token write alone cannot release the quarantine.
      write.resolve();
      await assertStorageFailure(observe(clientB.getMe()));
      invalidation.resolve();
      await drainMicrotasks(120);
    });
  }
});

test('physical pending marker with a hanging acknowledgement never authorizes token B', async () => {
  const protocol = createProtocolStorage();
  const runtime = protocol.runtime();
  const marker = protocol.block((key) => key === protocol.headKey, true);
  const quarantine = protocol.block((key) => key.endsWith('.revoked'));
  const client = createClient(async () => jsonResponse(200, authResponse('access-b', 'refresh-b')), runtime.storage);
  const login = observe(loginClient(client));
  await marker.started;
  runtime.expire();
  await quarantine.started;
  await assertStorageFailure(login);
  await assertStorageFailure(observe(client.logout()));
  assert.equal(protocol.tokenWrites('refresh-b'), 0);
  await assert.rejects(() => protocol.runtime().storage.get());
  marker.release();
  await drainMicrotasks(120);
  assert.equal(protocol.tokenWrites('refresh-b'), 0);
  await assertStorageFailure(observe(loginClient(client)));
  const reconciled = protocol.whenWrite((key, value) => key.endsWith('.result')
    && JSON.parse(value).state === 'aborted');
  quarantine.release();
  await reconciled;
  assert.equal(await protocol.runtime().storage.get(), null);
});

test('a hanging reconciliation clear leaves API retries bounded and quarantined', async () => {
  const deadline = createManualWriteDeadline();
  const write = createDeferred();
  const started = createDeferred();
  const cleanup = createDeferred();
  const cleanupStarted = createDeferred();
  const storage = {
    async get() { throw new Error('No reads during quarantine'); },
    async set() { started.resolve(); await write.promise; },
    async clear() {},
    async quarantinePendingWrite() {},
    async resolvePendingWrite() { cleanupStarted.resolve(); await cleanup.promise; },
    createWriteDeadline: () => deadline.create(),
  };
  const client = createClient(async () => jsonResponse(200, authResponse('access-b', 'refresh-b')), storage);
  const login = observe(loginClient(client));
  await started.promise;
  deadline.expire();
  await assertStorageFailure(login);
  write.resolve();
  await cleanupStarted.promise;
  await assertStorageFailure(observe(client.logout()));
  await assertStorageFailure(observe(client.logout()));
  await assertStorageFailure(observe(loginClient(client)));
  cleanup.resolve();
  await drainMicrotasks(120);
});

test('logout can retry a failed reconciliation after all old I/O has settled', async () => {
  const deadline = createManualWriteDeadline();
  const write = createDeferred();
  const started = createDeferred();
  let cleanupFailed = true;
  let value = null;
  const storage = {
    async get() { return value; },
    async set(token) {
      if (token === 'refresh-b') { started.resolve(); await write.promise; }
      value = token;
    },
    async clear() { value = null; },
    async quarantinePendingWrite() {},
    async resolvePendingWrite() {
      if (cleanupFailed) throw new Error('Temporary cleanup failure');
      value = null;
    },
    createWriteDeadline: () => deadline.create(),
  };
  let calls = 0;
  const client = createClient(async () => {
    calls += 1;
    return jsonResponse(200, calls === 1
      ? authResponse('access-b', 'refresh-b') : authResponse('access-c', 'refresh-c'));
  }, storage);
  const loginB = observe(loginClient(client));
  await started.promise;
  deadline.expire();
  await assertStorageFailure(loginB);
  write.resolve();
  await drainMicrotasks(120);
  await assertStorageFailure(observe(loginClient(client)));
  cleanupFailed = false;
  // This retry starts reconciliation; it still honestly reports the quarantine.
  await assertStorageFailure(observe(client.logout()));
  await loginClient(client);
  assert.equal(value, 'refresh-c');
});

test('durable pending B survives a real wrapper restart and late writes require reconciliation', async (t) => {
  for (const sharedClient of [false, true]) {
    await t.test(sharedClient ? 'two ApiClients' : 'one ApiClient', async () => {
      const protocol = createProtocolStorage();
      const runtime = protocol.runtime();
      let loginCalls = 0;
      let refreshCalls = 0;
      const fetchImpl = async (url, init) => {
        if (url.endsWith('/auth/login')) {
          loginCalls += 1;
          const id = loginCalls === 1 ? 'a' : loginCalls === 2 ? 'b' : 'c';
          return jsonResponse(200, authResponse(`access-${id}`, `refresh-${id}`));
        }
        if (url.endsWith('/auth/refresh')) {
          refreshCalls += 1;
          assert.equal(JSON.parse(init.body).refreshToken, 'refresh-c');
          return jsonResponse(200, authResponse('access-c2', 'refresh-c2'));
        }
        if (url.endsWith('/users/me')) return jsonResponse(200, profile);
        throw new Error('Unexpected request');
      };
      const clientA = createClient(fetchImpl, runtime.storage);
      const clientB = sharedClient ? createClient(fetchImpl, runtime.storage) : clientA;
      await loginClient(clientA);
      const tokenWrite = protocol.block((key, value) => key === protocol.keys.token
        && JSON.parse(value).refreshToken === 'refresh-b', true);
      const loginB = observe(loginClient(clientB));
      await tokenWrite.started;
      const pending = JSON.parse(protocol.values.get(protocol.headKey));
      assert.equal(pending.state, 'pending');
      assert.equal(protocol.values.has(`${protocol.headKey}.${pending.id}.result`), false);

      // Both pending-record and token writes preceded this quarantine write;
      // leave its physical write AND its acknowledgement blocked.
      const quarantineWrite = protocol.block((key) => key.endsWith('.revoked'));
      runtime.expire();
      await quarantineWrite.started;
      await assertStorageFailure(loginB);
      await assertStorageFailure(observe(clientA.logout()));
      await assertStorageFailure(observe(clientB.logout()));

      const restart = protocol.runtime();
      assert.notEqual(restart.rawStorage, runtime.rawStorage);
      const restartedClient = createClient(fetchImpl, restart.storage);
      await assertStorageFailure(observe(restartedClient.restoreSession()));
      await assertStorageFailure(observe(loginClient(restartedClient)));
      assert.equal(refreshCalls, 0);
      assert.equal(protocol.tokenWrites('refresh-c'), 0);
      const revocationBeforeLateB = protocol.values.get(protocol.keys.invalidated);

      tokenWrite.release();
      await drainMicrotasks(120);
      // An unreconciled writer cannot publish a terminal result or undo a newer revoke.
      assert.equal(protocol.values.has(`${protocol.headKey}.${pending.id}.result`), false);
      assert.equal(protocol.values.get(protocol.keys.invalidated), revocationBeforeLateB);
      await assertStorageFailure(observe(loginClient(clientA)));
      const anotherRestart = createClient(fetchImpl, protocol.runtime().storage);
      await assertStorageFailure(observe(anotherRestart.restoreSession()));
      assert.equal(refreshCalls, 0);

      const reconciled = protocol.whenWrite((key, value) => key === `${protocol.headKey}.${pending.id}.result`
        && JSON.parse(value).state === 'aborted');
      quarantineWrite.release();
      await reconciled;
      await drainMicrotasks(120);
      assert.equal(await protocol.runtime().storage.get(), null);
      // A runtime that discovered an unknown writer requires an explicit
      // readiness check even after another runtime has reconciled it.
      await restartedClient.recoverSessionStorage();
      await loginClient(restartedClient);
      assert.equal(await restart.storage.get(), 'refresh-c');
      assert.equal(JSON.parse(protocol.values.get(protocol.keys.token)).refreshToken, 'refresh-c');
      assert.deepEqual(await createClient(fetchImpl, protocol.runtime().storage).restoreSession(), profile);
      assert.equal(refreshCalls, 1);
    });
  }
});

test('persistence rejects unversioned, unknown, pending and mismatched credentials', async () => {
  const protocol = createProtocolStorage();
  const storage = protocol.runtime().storage;
  protocol.values.set(protocol.keys.token, 'legacy-token');
  assert.equal(await storage.get(), null);
  protocol.values.set(protocol.headKey, '{broken');
  await assert.rejects(() => storage.get());
  protocol.values.set(protocol.headKey, JSON.stringify({
    version: 1, id: 'test-operation', state: 'pending', barrier: null,
  }));
  await assert.rejects(() => storage.get());
  protocol.values.set(`${protocol.headKey}.test-operation.result`, JSON.stringify({
    version: 1, id: 'test-operation', state: 'committed',
  }));
  protocol.values.set(protocol.keys.token, JSON.stringify({
    version: 1, operationId: 'different-operation', refreshToken: 'wrong-token',
  }));
  assert.equal(await storage.get(), null);
  protocol.values.set(protocol.keys.token, JSON.stringify({
    version: 1, operationId: 'test-operation', refreshToken: 'matching-token',
  }));
  assert.equal(await storage.get(), 'matching-token');
  protocol.values.set(protocol.keys.invalidated, 'new-tombstone');
  assert.equal(await storage.get(), null);
});

test('fresh-wrapper logout requires a barrier even when token deletion succeeds', async () => {
  const protocol = createProtocolStorage();
  const writer = protocol.runtime();
  const delayedToken = protocol.block((key) => key === protocol.keys.token);
  const writeA = writer.storage.set('refresh-a');
  await delayedToken.started;
  const fresh = protocol.runtime();
  assert.notEqual(fresh.rawStorage, writer.rawStorage);
  const originalSet = fresh.rawStorage.setItem;
  fresh.rawStorage.setItem = async (key, value) => {
    if (key === protocol.keys.invalidated) throw new Error('Barrier unavailable');
    return originalSet(key, value);
  };
  let clears = 0;
  let requests = 0;
  const clientB = createClient(async () => { requests += 1; throw new Error('No request expected'); },
    fresh.storage, () => { clears += 1; });
  await assertStorageFailure(observe(clientB.logout()));
  assert.equal(protocol.values.has(protocol.keys.token), false);
  assert.equal(clears, 0);
  delayedToken.release();
  await writeA;
  // Unconfirmed invalidation cannot promise restart safety. B must remain fenced.
  assert.equal(await protocol.runtime().storage.get(), 'refresh-a');
  await assertStorageFailure(observe(clientB.getMe()));
  await assertStorageFailure(observe(clientB.restoreSession()));
  assert.equal(requests, 0);
  assert.equal(clears, 0);
  fresh.rawStorage.setItem = originalSet;
  await clientB.recoverSessionStorage();
  assert.equal(clears, 1);
  assert.equal(await protocol.runtime().storage.get(), null);
});

test('a confirmed fresh-wrapper barrier revokes a delayed token from another writer', async () => {
  const protocol = createProtocolStorage();
  const writer = protocol.runtime();
  const delayedToken = protocol.block((key) => key === protocol.keys.token);
  const writeA = observe(writer.storage.set('refresh-a'));
  await delayedToken.started;
  const fresh = protocol.runtime();
  let clears = 0;
  let refreshes = 0;
  const clientB = createClient(async () => { throw new Error('No network on local logout'); },
    fresh.storage, () => { clears += 1; });
  await clientB.logout();
  assert.equal(clears, 1);
  assert.ok(protocol.values.get(protocol.keys.invalidated));
  delayedToken.release();
  await writeA.promise;
  assert.ok(writeA.value instanceof Error);
  // Pending terminal proof is still absent; restart fails closed, never refreshes A.
  const restarted = createClient(async () => { refreshes += 1; throw new Error('No refresh allowed'); },
    protocol.runtime().storage);
  await assertStorageFailure(observe(restarted.restoreSession()));
  assert.equal(refreshes, 0);
});

test('unconfirmed revocation during delayed committed publication documents the restart limit', async () => {
  const protocol = createProtocolStorage();
  const runtime = protocol.runtime();
  const committed = protocol.block((key, value) => key.endsWith('.result')
    && JSON.parse(value).state === 'committed');
  const originalSet = runtime.rawStorage.setItem;
  runtime.rawStorage.setItem = async (key, value) => {
    if (key === protocol.keys.invalidated || key.endsWith('.revoked')) {
      throw new Error('Revocation writes unavailable');
    }
    return originalSet(key, value);
  };
  runtime.rawStorage.deleteItem = async () => { throw new Error('Deletion unavailable'); };
  let clears = 0;
  const client = createClient(async () => jsonResponse(200, authResponse('access-a', 'refresh-a')),
    runtime.storage, () => { clears += 1; });
  const login = observe(loginClient(client));
  await committed.started;
  runtime.expire();
  await assertStorageFailure(login);
  await assertStorageFailure(observe(client.logout()));
  committed.release();
  await drainMicrotasks(120);
  await assertStorageFailure(observe(client.getMe()));
  assert.equal(clears, 0);
  // Physical commit can become visible without acknowledgement/revocation.
  // This is explicitly NOT a confirmed logout, and no restart guarantee is claimed.
  const restart = protocol.runtime();
  assert.notEqual(restart.rawStorage, runtime.rawStorage);
  assert.equal(await restart.storage.get(), 'refresh-a');
});

test('confirmed barrier dominates even a late committed publication after restart', async () => {
  const protocol = createProtocolStorage();
  const writer = protocol.runtime();
  const committed = protocol.block((key, value) => key.endsWith('.result')
    && JSON.parse(value).state === 'committed');
  const write = observe(writer.storage.set('refresh-a'));
  await committed.started;
  let cleared = 0;
  const logoutRuntime = protocol.runtime();
  logoutRuntime.rawStorage.deleteItem = async () => { throw new Error('Token deletion unavailable'); };
  const client = createClient(async () => { throw new Error('No network expected'); },
    logoutRuntime.storage, () => { cleared += 1; });
  await client.logout();
  assert.equal(cleared, 1);
  committed.release();
  await write.promise;
  assert.ok(write.value instanceof Error);
  const head = JSON.parse(protocol.values.get(protocol.headKey));
  assert.equal(JSON.parse(protocol.values.get(`${protocol.headKey}.${head.id}.result`)).state, 'committed');
  assert.equal(JSON.parse(protocol.values.get(protocol.keys.token)).refreshToken, 'refresh-a');
  let requests = 0;
  const restart = protocol.runtime();
  assert.equal(await restart.storage.get(), null);
  assert.equal(await createClient(async () => { requests += 1; throw new Error('No refresh'); },
    restart.storage).restoreSession(), null);
  assert.equal(requests, 0);
});

test('AuthScreen recovery action retries failed reconciliation through AuthProvider', async () => {
  const protocol = createProtocolStorage();
  const runtime = protocol.runtime();
  let barrierUnavailable = false;
  const originalSet = runtime.rawStorage.setItem;
  runtime.rawStorage.setItem = async (key, value) => {
    if (barrierUnavailable && key === protocol.keys.invalidated) throw new Error('Temporary failure');
    return originalSet(key, value);
  };
  let logins = 0;
  const ui = createAuthScreenHarness(runtime.storage, async (url) => {
    assert.ok(url.endsWith('/auth/login'));
    logins += 1;
    return jsonResponse(200, logins === 1
      ? authResponse('access-b', 'refresh-b') : authResponse('access-c', 'refresh-c'));
  });
  ui.render();
  await drainMicrotasks(120);
  let tree = ui.render();
  assert.equal(ui.auth().status, 'unauthenticated');
  ui.find(tree, (node) => node.props.label === 'auth.email').props.onChangeText('person@example.test');
  ui.find(tree, (node) => node.props.label === 'auth.password').props.onChangeText('test-password');
  tree = ui.render();
  const token = protocol.block((key) => key === protocol.keys.token, true);
  ui.find(tree, (node) => node.props.testID === 'auth-submit').props.onPress();
  await token.started;
  runtime.expire();
  await drainMicrotasks(120);
  barrierUnavailable = true;
  token.release();
  await drainMicrotasks(120);
  tree = ui.render();
  assert.equal(ui.auth().storageRecoveryRequired, true);
  assert.equal(ui.find(tree, (node) => node.props.testID === 'auth-submit').props.disabled, true);
  const recoveryButton = ui.find(tree, (node) => node.props.testID === 'auth-storage-recovery');
  assert.equal(recoveryButton.props.accessibilityLabel, 'auth.recoverStorage');
  await recoveryButton.props.onPress(); // Still unavailable, remains visibly retryable.
  tree = ui.render();
  assert.equal(ui.auth().storageRecoveryRequired, true);
  assert.equal(ui.auth().status, 'unauthenticated');
  assert.equal(ui.auth().user, null);
  assert.ok(ui.find(tree, (node) => node.props.children === 'auth.storageNotReady'));
  barrierUnavailable = false;
  await ui.find(tree, (node) => node.props.testID === 'auth-storage-recovery').props.onPress();
  tree = ui.render();
  assert.equal(ui.auth().storageRecoveryRequired, false);
  assert.equal(ui.auth().status, 'unauthenticated');
  assert.ok(ui.find(tree, (node) => node.props.children === 'auth.storageRecovered'));
  assert.equal(logins, 1, 'Recovery must not automatically sign in');
  assert.equal(ui.find(tree, (node) => node.props.testID === 'auth-submit').props.disabled, false);
  ui.find(tree, (node) => node.props.testID === 'auth-submit').props.onPress();
  await drainMicrotasks(120);
  ui.render();
  assert.equal(ui.auth().status, 'authenticated');
  assert.equal(await protocol.runtime().storage.get(), 'refresh-c');
});

test('recovery clicks share cleanup and time out without releasing quarantine', async () => {
  const protocol = createProtocolStorage();
  const runtime = protocol.runtime();
  const token = protocol.block((key) => key === protocol.keys.token, true);
  const cleanup = protocol.block((key) => key === protocol.keys.invalidated);
  let clears = 0;
  const fetchImpl = async () => jsonResponse(200, authResponse('access-b', 'refresh-b'));
  const a = createClient(fetchImpl, runtime.storage, () => { clears += 1; });
  const b = createClient(fetchImpl, runtime.storage, () => { clears += 1; });
  const login = observe(loginClient(a));
  await token.started;
  runtime.expire();
  await assertStorageFailure(login);
  await assertStorageFailure(observe(a.recoverSessionStorage())); // Original write unresolved.
  token.release();
  await cleanup.started;
  const recoveryA = a.recoverSessionStorage();
  assert.equal(a.recoverSessionStorage(), recoveryA);
  const outcomeA = observe(recoveryA);
  const outcomeB = observe(b.recoverSessionStorage());
  await drainMicrotasks(120);
  runtime.expire();
  await assertStorageFailure(outcomeA);
  await assertStorageFailure(outcomeB);
  const repeated = observe(a.recoverSessionStorage());
  await drainMicrotasks(120);
  runtime.expire();
  await assertStorageFailure(repeated);
  assert.equal(protocol.writes.filter((write) => write.key === protocol.keys.invalidated).length, 1);
  await assertStorageFailure(observe(loginClient(b)));
  assert.equal(clears, 0);
  const finalRetry = a.recoverSessionStorage();
  cleanup.release();
  await finalRetry;
  assert.equal(clears, 1);
  assert.equal(await protocol.runtime().storage.get(), null);
  await loginClient(b);
  assert.equal(await runtime.storage.get(), 'refresh-b');
});

test('AuthProvider does not present a failed logout as unauthenticated success', async () => {
  const durable = createDurableStorage();
  const ui = createAuthScreenHarness(durable.storage, async (url) => {
    if (url.endsWith('/auth/logout')) throw new Error('Offline');
    return jsonResponse(200, authResponse('access-a', 'refresh-a'));
  });
  ui.render();
  await drainMicrotasks(120);
  ui.render();
  await ui.auth().login({ email: 'person@example.test', password: 'test-password' });
  ui.render();
  durable.failures.writeMarker = true;
  await assertStorageFailure(observe(ui.auth().logout()));
  ui.render();
  assert.equal(ui.auth().status, 'authenticated');
  assert.equal(ui.auth().user.id, profile.id);
  assert.equal(ui.auth().storageRecoveryRequired, true);
  durable.failures.writeMarker = false;
  await ui.auth().recoverSessionStorage();
  ui.render();
  assert.equal(ui.auth().status, 'unauthenticated');
  assert.equal(ui.auth().storageRecoveryRequired, false);
});

test('fresh runtime separates confirmed revocation from unknown-writer readiness', async () => {
  const protocol = createProtocolStorage();
  const writer = protocol.runtime();
  const blocked = protocol.block((key) => key === protocol.keys.token);
  const writeA = observe(writer.storage.set('refresh-a'));
  await blocked.started;
  const head = protocol.values.get(protocol.headKey);
  const pending = JSON.parse(head);
  const terminalKey = `${protocol.headKey}.${pending.id}.result`;
  const fresh = protocol.runtime();
  assert.notEqual(fresh.rawStorage, writer.rawStorage);
  let requests = 0;
  const notifications = [];
  const fetchImpl = async (url, init) => {
    requests += 1;
    if (url.endsWith('/auth/login')) return jsonResponse(200, authResponse('access-c', 'refresh-c'));
    if (url.endsWith('/auth/refresh')) {
      assert.equal(JSON.parse(init.body).refreshToken, 'refresh-c');
      return jsonResponse(200, authResponse('access-c2', 'refresh-c2'));
    }
    if (url.endsWith('/users/me')) return jsonResponse(200, profile);
    throw new Error('Unexpected request');
  };
  const b = createClient(fetchImpl, fresh.storage, (state) => notifications.push(state));
  const peer = createClient(fetchImpl, fresh.storage);
  await assertStorageFailure(observe(b.recoverSessionStorage()));
  assert.equal(notifications.length, 0, 'Failed readiness is not a recovery callback');
  assert.equal(writeA.settled, false);
  assert.equal(protocol.values.get(protocol.headKey), head);
  assert.equal(protocol.values.has(terminalKey), false);
  assert.ok(protocol.values.get(protocol.keys.invalidated), 'Revocation itself was durable');

  await b.logout();
  assert.deepEqual(notifications, [{ storageRecoveryRequired: true }]);
  await assertStorageFailure(observe(loginClient(b)));
  await assertStorageFailure(observe(peer.register({ email: 'test@example.test', password: 'test-password',
    handle: 'person', displayName: 'Person' })));
  await assertStorageFailure(observe(peer.restoreSession()));
  await assertStorageFailure(observe(b.getMe()));
  assert.equal(requests, 0);

  blocked.release();
  await writeA.promise;
  assert.ok(writeA.value instanceof Error);
  await assertStorageFailure(observe(b.recoverSessionStorage()));
  assert.equal(protocol.values.has(terminalKey), false, 'Settling a foreign Promise is not terminal proof');
  // Only the owning wrapper reconciles its settled operation and writes aborted.
  await writer.storage.resolvePendingWrite();
  await b.recoverSessionStorage();
  assert.deepEqual(notifications.at(-1), { storageRecoveryRequired: false });
  assert.equal(requests, 0, 'Recovery never signs in automatically');
  await loginClient(b);
  assert.equal(await fresh.storage.get(), 'refresh-c');
  assert.deepEqual(await createClient(fetchImpl, protocol.runtime().storage).restoreSession(), profile);
  assert.equal(await protocol.runtime().storage.get(), 'refresh-c2');
});

test('unknown durable state cannot be reported as ready or repaired by a fresh wrapper', async (t) => {
  const cases = [
    { name: 'malformed head', head: '{broken' },
    { name: 'unknown state', head: JSON.stringify({ version: 1, id: 'old', state: 'unknown', barrier: null }) },
    { name: 'missing terminal', head: JSON.stringify({ version: 1, id: 'old', state: 'pending', barrier: null }) },
    { name: 'mismatched terminal', head: JSON.stringify({ version: 1, id: 'old', state: 'pending', barrier: null }),
      terminal: JSON.stringify({ version: 1, id: 'someone-else', state: 'aborted' }) },
  ];
  for (const item of cases) await t.test(item.name, async () => {
    const protocol = createProtocolStorage();
    protocol.values.set(protocol.headKey, item.head);
    const resultKey = `${protocol.headKey}.old.result`;
    if (item.terminal) protocol.values.set(resultKey, item.terminal);
    let calls = 0;
    let cleared = 0;
    const runtime = protocol.runtime();
    const client = createClient(async () => { calls += 1; throw new Error('No network allowed'); },
      runtime.storage, () => { cleared += 1; });
    await assertStorageFailure(observe(client.recoverSessionStorage()));
    await assertStorageFailure(observe(client.recoverSessionStorage()));
    await assertStorageFailure(observe(loginClient(client)));
    assert.equal(protocol.values.get(protocol.headKey), item.head);
    assert.equal(protocol.values.get(resultKey), item.terminal);
    assert.equal(calls, 0);
    assert.equal(cleared, 0);
  });
});

test('pending discovered by restore or login blocks subsequent explicit auth before network', async (t) => {
  for (const entry of ['restore', 'login']) await t.test(entry, async () => {
    const protocol = createProtocolStorage();
    const writer = protocol.runtime();
    const blocked = protocol.block((key) => key === protocol.keys.token);
    const write = observe(writer.storage.set('refresh-a'));
    await blocked.started;
    let calls = 0;
    const runtime = protocol.runtime();
    const fetchImpl = async () => { calls += 1; return jsonResponse(200, authResponse('access-c', 'refresh-c')); };
    const client = createClient(fetchImpl, runtime.storage);
    const peer = createClient(fetchImpl, runtime.storage);
    await assertStorageFailure(observe(entry === 'restore' ? client.restoreSession() : loginClient(client)));
    const callsAtDiscovery = calls;
    await assertStorageFailure(observe(loginClient(client)));
    await assertStorageFailure(observe(peer.register({ email: 'test@example.test', password: 'test-password',
      handle: 'person', displayName: 'Person' })));
    assert.equal(calls, callsAtDiscovery);
    assert.equal(calls, entry === 'restore' ? 0 : 1);
    blocked.release();
    await write.promise;
  });
});

test('AuthScreen keeps recovery error after restart and after a confirmed logout', async () => {
  const protocol = createProtocolStorage();
  const writer = protocol.runtime();
  const blocked = protocol.block((key) => key === protocol.keys.token);
  const write = observe(writer.storage.set('refresh-a'));
  await blocked.started;
  const runtime = protocol.runtime();
  let logins = 0;
  const ui = createAuthScreenHarness(runtime.storage, async (url) => {
    assert.ok(url.endsWith('/auth/login'));
    logins += 1;
    return jsonResponse(200, authResponse('access-c', 'refresh-c'));
  });
  ui.render();
  await drainMicrotasks(160);
  let tree = ui.render();
  assert.equal(ui.auth().storageRecoveryRequired, true);
  const button = ui.find(tree, (node) => node.props.testID === 'auth-storage-recovery');
  await Promise.all([button.props.onPress(), button.props.onPress()]);
  tree = ui.render();
  assert.equal(ui.auth().storageRecoveryRequired, true);
  assert.ok(ui.find(tree, (node) => node.props.children === 'auth.storageNotReady'));
  assert.equal(ui.find(tree, (node) => node.props.children === 'auth.storageRecovered'), undefined);
  assert.equal(ui.find(tree, (node) => node.props.testID === 'auth-submit').props.disabled, true);
  assert.equal(write.settled, false);
  await ui.auth().logout(); // Logout is confirmed, but readiness is NOT.
  tree = ui.render();
  assert.equal(ui.auth().status, 'unauthenticated');
  assert.equal(ui.auth().storageRecoveryRequired, true);
  assert.equal(ui.find(tree, (node) => node.props.testID === 'auth-submit').props.disabled, true);
  assert.equal(logins, 0);

  blocked.release();
  await write.promise;
  await writer.storage.resolvePendingWrite();
  await ui.find(tree, (node) => node.props.testID === 'auth-storage-recovery').props.onPress();
  tree = ui.render();
  assert.ok(ui.find(tree, (node) => node.props.children === 'auth.storageRecovered'));
  assert.equal(ui.auth().storageRecoveryRequired, false);
  assert.equal(ui.auth().status, 'unauthenticated');
  ui.find(tree, (node) => node.props.label === 'auth.email').props.onChangeText('person@example.test');
  ui.find(tree, (node) => node.props.label === 'auth.password').props.onChangeText('test-password');
  tree = ui.render();
  ui.find(tree, (node) => node.props.testID === 'auth-submit').props.onPress();
  await drainMicrotasks(160);
  ui.render();
  assert.equal(ui.auth().status, 'authenticated');
  assert.equal(await protocol.runtime().storage.get(), 'refresh-c');
});

test('hanging readiness checks are bounded reads, not mutations or late unlocks', async () => {
  const protocol = createProtocolStorage();
  const runtime = protocol.runtime();
  const readStarted = createDeferred();
  const lateRead = createDeferred();
  const originalGet = runtime.rawStorage.getItem;
  let blockReads = false;
  let readinessReads = 0;
  runtime.rawStorage.getItem = async (key) => {
    if (blockReads && key === protocol.headKey) {
      readinessReads += 1;
      readStarted.resolve();
      return lateRead.promise;
    }
    return originalGet(key);
  };
  let calls = 0;
  const notifications = [];
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/auth/login')) {
      calls += 1;
      return jsonResponse(200, calls === 1 ? authResponse('access-a', 'refresh-a') : authResponse('access-c', 'refresh-c'));
    }
    if (url.endsWith('/users/me')) {
      assert.equal(init.headers.Authorization, 'Bearer access-c');
      return jsonResponse(200, profile);
    }
    throw new Error('Unexpected network');
  };
  const a = createClient(fetchImpl, runtime.storage, (state) => notifications.push(state));
  const b = createClient(fetchImpl, runtime.storage, (state) => notifications.push(state));
  await loginClient(a);
  const oldHead = protocol.values.get(protocol.headKey);
  blockReads = true;
  const first = a.recoverSessionStorage();
  assert.equal(a.recoverSessionStorage(), first);
  const resultA = observe(first);
  const resultB = observe(b.recoverSessionStorage());
  await readStarted.promise;
  assert.equal(protocol.values.has(protocol.keys.token), false, 'Clear precedes the readiness read');
  assert.equal(readinessReads, 1);
  runtime.expire();
  await assertStorageFailure(resultA);
  await assertStorageFailure(resultB);
  assert.equal(notifications.length, 0);
  await b.logout(); // Does not wait for the unresolved readiness read.
  assert.deepEqual(notifications, [{ storageRecoveryRequired: true }]);
  await assertStorageFailure(observe(loginClient(b)));
  const again = observe(a.recoverSessionStorage());
  await drainMicrotasks(120);
  runtime.expire();
  await assertStorageFailure(again);
  assert.equal(protocol.writes.filter((write) => write.key === protocol.keys.invalidated).length, 1);
  blockReads = false;
  // This new observation can succeed even though both older reads remain pending.
  await b.recoverSessionStorage();
  await loginClient(b);
  assert.equal(await runtime.storage.get(), 'refresh-c');
  const notificationsBeforeLateRead = notifications.length;
  lateRead.resolve(oldHead);
  await drainMicrotasks(160);
  assert.equal(notifications.length, notificationsBeforeLateRead);
  assert.equal(await runtime.storage.get(), 'refresh-c');
  assert.deepEqual(await b.getMe(), profile);
});

test('a late failed readiness-related restore read cannot fence a newer explicit login', async () => {
  const protocol = createProtocolStorage();
  const runtime = protocol.runtime();
  const firstRead = createDeferred();
  const started = createDeferred();
  const originalGet = runtime.rawStorage.getItem;
  let blocked = false;
  runtime.rawStorage.getItem = async (key) => {
    if (!blocked && key === protocol.headKey) {
      blocked = true;
      started.resolve();
      return firstRead.promise;
    }
    return originalGet(key);
  };
  const client = createClient(async (url, init) => {
    if (url.endsWith('/auth/login')) return jsonResponse(200, authResponse('access-c', 'refresh-c'));
    assert.equal(init.headers.Authorization, 'Bearer access-c');
    return jsonResponse(200, profile);
  }, runtime.storage);
  const restore = observe(client.restoreSession());
  await started.promise;
  await loginClient(client);
  firstRead.reject(new Error('Late storage read failure'));
  await restore.promise;
  assert.equal(restore.value.code, 'INVALID_REFRESH_TOKEN');
  assert.deepEqual(await client.getMe(), profile);
  assert.equal(await runtime.storage.get(), 'refresh-c');
});

test('optimistic extroversion save keeps the server-confirmed level', async () => {
  const appliedLevels = [];
  const result = await saveExtroversionOptimistically({
    currentLevel: 5.5,
    nextLevel: 7,
    setLevel: (level) => appliedLevels.push(level),
    persist: async (level) => level,
  });

  assert.equal(result, 7);
  assert.deepEqual(appliedLevels, [7, 7]);
});

test('optimistic extroversion save rolls back after an API error', async () => {
  const appliedLevels = [];
  await assert.rejects(() => saveExtroversionOptimistically({
    currentLevel: 5.5,
    nextLevel: 8,
    setLevel: (level) => appliedLevels.push(level),
    persist: async () => {
      throw new ApiClientError({
        statusCode: 503,
        code: 'NETWORK_ERROR',
        message: 'Unavailable',
      });
    },
  }), ApiClientError);

  assert.deepEqual(appliedLevels, [8, 5.5]);
});
