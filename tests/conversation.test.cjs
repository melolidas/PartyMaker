const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  MAX_MOCK_MESSAGE_LENGTH,
  getMockConversation,
  getMockConversationContext,
  getMockChatThread,
  updateMockChatDraft,
  sendMockChatMessage,
} = require('../.expo/chat-tests/features/chats/mockConversation.js');
const { demoLobbies } = require('../.expo/chat-tests/features/home/lobbies.js');
const { getLobbyChatGroups } = require('../.expo/chat-tests/features/chats/lobbyChats.js');
const { createTranslator } = require('../.expo/chat-tests/i18n/translations.js');

const NOW = 1788350400000;
const session = { startedAt: NOW, joinedIds: [] };
const archivedLobbies = getLobbyChatGroups(session).inactive.map(({ lobby }) => lobby);
const lobbies = [...demoLobbies, ...archivedLobbies];
const expectedContexts = {
  beer: 'drinks',
  cs2: 'gaming',
  pizza: 'food',
  basketball: 'sport',
  cinema: 'movies',
  hike: 'outdoors',
  'inactive-cinema': 'archivedCinema',
  'inactive-hike': 'archivedHike',
};

function freezeState(state) {
  for (const thread of Object.values(state)) {
    for (const message of thread.messages) Object.freeze(message);
    Object.freeze(thread.messages);
    Object.freeze(thread);
  }
  return Object.freeze(state);
}

function sendText(state, lobbyId, text, now = NOW) {
  return sendMockChatMessage(updateMockChatDraft(state, lobbyId, text), lobbyId, now);
}

test('every demo and historical lobby has a conversation suited to its context', () => {
  assert.deepEqual(lobbies.map(({ id }) => id).sort(), Object.keys(expectedContexts).sort());
  for (const lobby of lobbies) {
    const context = getMockConversationContext(lobby);
    assert.equal(context, expectedContexts[lobby.id]);
    const messages = getMockConversation(lobby);
    assert.ok(messages.length >= 4, `${lobby.id} should have a designed conversation`);
    assert.ok(messages.some(({ author }) => author === 'you'));
    assert.ok(messages.some(({ author }) => author !== 'you'));
    for (const message of messages) {
      assert.equal(message.kind, 'fixture');
      assert.ok(['alex', 'john', 'marina', 'kate', 'you'].includes(message.author));
      assert.ok(message.textKey.startsWith(`conversation.${context}.`));
      assert.match(message.time, /^(?:[01]\d|2[0-3]):[0-5]\d$/);
    }
  }
});

test('fixture copy is available in Russian and English for all demo and archive contexts', () => {
  const fallback = { id: 'new-context', category: 'unsupported-category' };
  for (const lobby of [...lobbies, fallback]) {
    for (const message of getMockConversation(lobby)) {
      const localized = ['ru', 'en'].map((language) => createTranslator(language)(message.textKey));
      for (const text of localized) {
        assert.equal(typeof text, 'string', `missing ${message.textKey}`);
        assert.ok(text.trim().length > 0, `blank ${message.textKey}`);
        assert.notEqual(text, message.textKey);
      }
      assert.notEqual(localized[0], localized[1], `${message.textKey} should be translated`);
    }
  }
});

test('historical meetings have separate fixture content and globally distinct message ids', () => {
  const ids = lobbies.flatMap((lobby) => getMockConversation(lobby).map(({ id }) => id));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['cinema', 'hike']) {
    const current = demoLobbies.find((lobby) => lobby.id === id);
    const archived = archivedLobbies.find((lobby) => lobby.id === `inactive-${id}`);
    assert.notEqual(getMockConversationContext(current), getMockConversationContext(archived));
    assert.notDeepEqual(
      getMockConversation(current).map(({ textKey }) => textKey),
      getMockConversation(archived).map(({ textKey }) => textKey),
    );
  }
});

test('unknown categories use a complete generic conversation without inheriting object properties', () => {
  for (const category of ['unknown', 'toString', '__proto__']) {
    const lobby = { id: `new-${category}`, category };
    assert.equal(getMockConversationContext(lobby), 'generic');
    assert.ok(getMockConversation(lobby).length >= 4);
    assert.ok(getMockConversation(lobby).every(({ textKey }) => textKey.startsWith('conversation.generic.')));
  }
});

test('fixture reads are deterministic and do not leak changes into subsequent openings', () => {
  const lobby = demoLobbies[0];
  const before = getMockConversation(lobby);
  const changed = getMockConversation(lobby);
  changed[0].time = '00:00';
  changed[0].textKey = 'modified';
  changed.pop();
  assert.deepEqual(getMockConversation(lobby), before);
});

test('opening an untouched chat returns an empty thread without creating state', () => {
  const state = freezeState({});
  for (const { id } of lobbies) assert.deepEqual(getMockChatThread(state, id), { draft: '', messages: [] });
  assert.deepEqual(state, {});
  assert.equal(updateMockChatDraft(state, 'beer', ''), state);
  assert.equal(sendMockChatMessage(state, 'beer', NOW), state);
});

test('chat lookup does not mistake inherited properties for existing threads', () => {
  const state = {};
  for (const id of ['constructor', 'toString', '__proto__']) {
    assert.deepEqual(getMockChatThread(state, id), { draft: '', messages: [] });
  }
  const next = sendText(state, '__proto__', 'Own chat data');
  assert.equal(Object.getPrototypeOf(next), Object.prototype);
  assert.equal(getMockChatThread(next, '__proto__').messages[0].text, 'Own chat data');
  assert.deepEqual(state, {});
});

test('drafts are independent for every lobby, including current and archived instances', () => {
  let state = {};
  for (const { id } of lobbies) state = updateMockChatDraft(state, id, `draft for ${id}`);
  for (const { id } of lobbies) {
    assert.deepEqual(getMockChatThread(state, id), { draft: `draft for ${id}`, messages: [] });
  }
  const before = freezeState(state);
  const next = updateMockChatDraft(before, 'cinema', 'Only the upcoming meeting changes');
  assert.equal(getMockChatThread(next, 'cinema').draft, 'Only the upcoming meeting changes');
  for (const { id } of lobbies.filter(({ id }) => id !== 'cinema')) {
    assert.equal(getMockChatThread(next, id), getMockChatThread(before, id));
  }
});

test('blank and whitespace-only drafts cannot produce outgoing messages', () => {
  for (const draft of ['', ' ', '\n\r\t', '\u00a0\u2003\n']) {
    const state = freezeState(updateMockChatDraft({}, 'beer', draft));
    assert.equal(sendMockChatMessage(state, 'beer', NOW), state);
    assert.equal(getMockChatThread(state, 'beer').messages.length, 0);
  }
});

test('sending trims outer whitespace, preserves inner text, timestamps the message and clears only its draft', () => {
  let state = updateMockChatDraft({}, 'beer', '  Привет!\nУвидимся  в  восемь? 👋  ');
  state = updateMockChatDraft(state, 'cs2', 'Gaming draft stays');
  freezeState(state);
  const next = sendMockChatMessage(state, 'beer', NOW);
  const thread = getMockChatThread(next, 'beer');
  assert.equal(thread.draft, '');
  assert.equal(thread.messages.length, 1);
  assert.deepEqual(thread.messages[0], {
    id: thread.messages[0].id,
    kind: 'local',
    author: 'you',
    text: 'Привет!\nУвидимся  в  восемь? 👋',
    createdAt: NOW,
  });
  assert.ok(thread.messages[0].id.length > 0);
  assert.equal(getMockChatThread(next, 'cs2'), getMockChatThread(state, 'cs2'));
  assert.equal(getMockChatThread(state, 'beer').messages.length, 0);
});

test('draft input accepts the limit and clamps longer text before display or sending', () => {
  assert.equal(MAX_MOCK_MESSAGE_LENGTH, 2000);
  for (const length of [1, MAX_MOCK_MESSAGE_LENGTH, MAX_MOCK_MESSAGE_LENGTH + 1, 3 * MAX_MOCK_MESSAGE_LENGTH]) {
    const text = 'я'.repeat(length);
    const drafted = updateMockChatDraft({}, 'beer', text);
    const expected = text.slice(0, MAX_MOCK_MESSAGE_LENGTH);
    assert.equal(getMockChatThread(drafted, 'beer').draft, expected);
    const sent = sendMockChatMessage(drafted, 'beer', NOW);
    assert.equal(getMockChatThread(sent, 'beer').messages[0].text, expected);
  }
});

test('unchanged drafts, including identical clamped input, preserve state identity', () => {
  const state = freezeState(updateMockChatDraft({}, 'beer', 'draft'));
  assert.equal(updateMockChatDraft(state, 'beer', 'draft'), state);
  const full = freezeState(updateMockChatDraft({}, 'beer', 'x'.repeat(MAX_MOCK_MESSAGE_LENGTH)));
  assert.equal(updateMockChatDraft(full, 'beer', 'x'.repeat(MAX_MOCK_MESSAGE_LENGTH + 50)), full);
});

test('send defensively bounds oversized drafts supplied outside the input helper', () => {
  const state = freezeState({ beer: { draft: 'a'.repeat(MAX_MOCK_MESSAGE_LENGTH + 100), messages: [] } });
  const next = sendMockChatMessage(state, 'beer', NOW);
  assert.equal(getMockChatThread(next, 'beer').messages[0].text.length, MAX_MOCK_MESSAGE_LENGTH);
  assert.equal(state.beer.draft.length, MAX_MOCK_MESSAGE_LENGTH + 100);
});

test('repeated sends in one millisecond append in order with unique ids and no double-submit', () => {
  let state = {};
  for (let index = 0; index < 25; index++) state = sendText(freezeState(state), 'beer', `Message ${index}`, NOW);
  const thread = getMockChatThread(state, 'beer');
  assert.equal(thread.messages.length, 25);
  assert.equal(new Set(thread.messages.map(({ id }) => id)).size, 25);
  assert.deepEqual(thread.messages.map(({ text }) => text), Array.from({ length: 25 }, (_, index) => `Message ${index}`));
  assert.ok(thread.messages.every(({ createdAt }) => createdAt === NOW));
  assert.equal(sendMockChatMessage(state, 'beer', NOW), state);
});

test('ids remain unique across chats and repeated or backwards clock timestamps', () => {
  let state = {};
  for (const now of [NOW, NOW - 1000, NOW]) {
    for (const { id } of lobbies) state = sendText(state, id, `A message for ${id}`, now);
  }
  const messages = lobbies.flatMap(({ id }) => getMockChatThread(state, id).messages);
  assert.equal(new Set(messages.map(({ id }) => id)).size, messages.length);
  for (const { id } of lobbies) {
    assert.ok(getMockChatThread(state, id).messages.every(({ text }) => text === `A message for ${id}`));
  }
});

test('editing and sending return new state without mutating earlier snapshots or other chats', () => {
  let initial = sendText({}, 'beer', 'First message');
  initial = sendText(initial, 'cs2', 'Separate chat');
  const before = freezeState(initial);
  const oldBeer = getMockChatThread(before, 'beer');
  const oldCs2 = getMockChatThread(before, 'cs2');
  const drafted = freezeState(updateMockChatDraft(before, 'beer', 'Second message'));
  assert.notEqual(drafted, before);
  assert.notEqual(getMockChatThread(drafted, 'beer'), oldBeer);
  assert.equal(getMockChatThread(drafted, 'beer').messages, oldBeer.messages);
  const sent = sendMockChatMessage(drafted, 'beer', NOW + 1);
  assert.notEqual(sent, drafted);
  assert.notEqual(getMockChatThread(sent, 'beer').messages, oldBeer.messages);
  assert.equal(getMockChatThread(sent, 'beer').messages[0], oldBeer.messages[0]);
  assert.equal(getMockChatThread(sent, 'cs2'), oldCs2);
  assert.equal(oldBeer.messages.length, 1);
  assert.equal(oldBeer.draft, '');
  assert.equal(getMockChatThread(drafted, 'beer').draft, 'Second message');
});

test('session state preserves messages and unsent text when reopening from a different lobby', () => {
  const fixtureBefore = getMockConversation(demoLobbies[0]);
  let state = sendText({}, 'beer', 'See you soon');
  state = updateMockChatDraft(state, 'beer', 'Unsent follow-up');
  const previousThread = getMockChatThread(state, 'beer');
  state = sendText(state, 'inactive-cinema', 'Thanks for yesterday');
  state = updateMockChatDraft(state, 'cs2', 'Another draft');
  assert.equal(getMockChatThread(state, 'beer'), previousThread);
  assert.equal(getMockChatThread(state, 'beer').messages[0].text, 'See you soon');
  assert.equal(getMockChatThread(state, 'beer').draft, 'Unsent follow-up');
  assert.deepEqual(getMockConversation(demoLobbies[0]), fixtureBefore);
  assert.deepEqual(getMockChatThread({}, 'beer'), { draft: '', messages: [] }, 'a new app session has no persisted messages');
});
