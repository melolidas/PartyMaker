const assert = require('node:assert/strict');
const { test } = require('node:test');
const { formatCountdown, getRemainingSeconds } = require('../.expo/home-tests/features/home/countdown.js');
const { demoLobbies, getJoinedLobbies, getLobbyMembers, isLobbyJoined, joinDemoLobby } = require('../.expo/home-tests/features/home/lobbies.js');
const { createTranslator } = require('../.expo/home-tests/i18n/translations.js');
const NOW = 1788350400000;
const DAY_MS = 24 * 60 * 60 * 1000;

test('countdown rounds up so an event does not start a second early', () => {
  assert.equal(getRemainingSeconds(NOW + 1001, NOW), 2);
  assert.equal(getRemainingSeconds(NOW + 1, NOW), 1);
  assert.equal(getRemainingSeconds(NOW, NOW), 0);
  assert.equal(getRemainingSeconds(NOW - 1000, NOW), 0);
  assert.equal(getRemainingSeconds(NaN, NOW), 0);
});

test('countdown follows elapsed wall time after backgrounding, not timer ticks', () => {
  const startsAt = NOW + 2 * 60 * 60 * 1000;
  assert.equal(getRemainingSeconds(startsAt, NOW), 7200);
  assert.equal(getRemainingSeconds(startsAt, NOW + 30 * 60 * 1000), 5400);
  assert.equal(getRemainingSeconds(startsAt, NOW + DAY_MS), 0);
});

test('countdown formats zero, minutes and more than 24 hours without wrapping', () => {
  assert.equal(formatCountdown(0), '00:00:00');
  assert.equal(formatCountdown(61), '00:01:01');
  assert.equal(formatCountdown(8100), '02:15:00');
  assert.equal(formatCountdown(27 * 3600), '27:00:00');
  assert.equal(formatCountdown(-1), '00:00:00');
  assert.equal(formatCountdown(Infinity), '00:00:00');
});

test('popup descriptions and actions exist in both languages', () => {
  for (const language of ['ru', 'en']) {
    const t = createTranslator(language);
    for (const lobby of demoLobbies) {
      assert.ok(t(lobby.titleKey).length > 0);
      assert.ok(t(lobby.descriptionKey).length > 20);
    }
    for (const key of ['home.join', 'home.decline', 'home.joined', 'home.startsIn', 'home.started']) assert.ok(t(key));
  }
});

test('demo events have stable unique ids, future starts and valid member counts', () => {
  assert.equal(new Set(demoLobbies.map((lobby) => lobby.id)).size, demoLobbies.length);
  for (const lobby of demoLobbies) {
    assert.ok(lobby.startsAfterMs > 0);
    assert.ok(lobby.members > 0 && lobby.members <= lobby.capacity);
  }
});

test('cards restore the original demo times and distances in both languages', () => {
  const expected = {
    pizza: ['Сегодня 19:00 · 2,1 км', 'Today 19:00 · 2.1 km'],
    basketball: ['Сегодня 18:00 · 1,3 км', 'Today 18:00 · 1.3 km'],
    cinema: ['Завтра 20:30 · 3,4 км', 'Tomorrow 20:30 · 3.4 km'],
    hike: ['Сб 08:30 · 32 км', 'Sat 08:30 · 32 km'],
  };
  for (const lobby of demoLobbies) {
    assert.match(createTranslator('ru')(lobby.metaKey), /\d{2}:\d{2}/);
    assert.match(createTranslator('en')(lobby.metaKey), /\d{2}:\d{2}/);
    if (expected[lobby.id]) {
      assert.deepEqual(['ru', 'en'].map((language) => createTranslator(language)(lobby.metaKey)), expected[lobby.id]);
    }
  }
});

test('online lobby shows its time without inventing a physical distance', () => {
  const online = demoLobbies.find((lobby) => lobby.id === 'cs2');
  assert.equal(createTranslator('ru')(online.metaKey), 'Сегодня 22:00');
  assert.equal(createTranslator('en')(online.metaKey), 'Today 22:00');
});

const pizza = demoLobbies.find((lobby) => lobby.id === 'pizza');
test('joining adds one participant and marks the lobby without changing its countdown', () => {
  const previous = { startedAt: NOW, joinedIds: [] };
  const next = joinDemoLobby(previous, pizza, NOW);
  assert.equal(getLobbyMembers(pizza, previous), 3);
  assert.equal(getLobbyMembers(pizza, next), 4);
  assert.equal(isLobbyJoined(pizza, next), true);
  assert.equal(next.startedAt, previous.startedAt);
  assert.deepEqual(previous.joinedIds, []);
});

test('repeated joins and existing memberships never add duplicate participants', () => {
  const joined = joinDemoLobby({ startedAt: NOW, joinedIds: [] }, pizza, NOW);
  assert.equal(joinDemoLobby(joined, pizza, NOW), joined);
  const mine = demoLobbies.find((lobby) => lobby.isYours);
  assert.equal(joinDemoLobby(joined, mine, NOW), joined);
  assert.equal(getLobbyMembers(mine, joined), mine.members);
});

test('full and started events cannot be joined', () => {
  const session = { startedAt: NOW, joinedIds: [] };
  assert.equal(joinDemoLobby(session, { ...pizza, members: pizza.capacity }, NOW), session);
  assert.equal(joinDemoLobby(session, pizza, NOW + pizza.startsAfterMs), session);
  assert.equal(joinDemoLobby(session, pizza, NOW + 3 * DAY_MS), session);
});

test('View all and Home use the same initial joined lobby collection', () => {
  const session = { startedAt: NOW, joinedIds: [] };
  assert.deepEqual(getJoinedLobbies(demoLobbies, session).map(lobby => lobby.id), ['beer', 'cs2']);
});

test('newly joined lobbies appear in View all without including unrelated nearby lobbies', () => {
  const session = joinDemoLobby({ startedAt: NOW, joinedIds: [] }, pizza, NOW);
  const lobbies = getJoinedLobbies(demoLobbies, session);
  assert.deepEqual(lobbies.map(lobby => lobby.id), ['beer', 'cs2', 'pizza']);
  assert.equal(getLobbyMembers(lobbies[2], session), 4);
  assert.equal(lobbies[2], pizza, 'the list opens the existing lobby, not a copied fixture');
});

test('duplicate or unknown membership ids do not duplicate or invent lobby cards', () => {
  const session = { startedAt: NOW, joinedIds: ['unknown', 'beer', 'pizza', 'pizza'] };
  assert.deepEqual(getJoinedLobbies(demoLobbies, session).map(lobby => lobby.id), ['beer', 'cs2', 'pizza']);
  assert.deepEqual(session.joinedIds, ['unknown', 'beer', 'pizza', 'pizza']);
});

test('an empty joined collection is supported without mutating the available lobbies', () => {
  const available = demoLobbies.map(lobby => ({ ...lobby, isYours: false }));
  const session = { startedAt: NOW, joinedIds: [] };
  assert.deepEqual(getJoinedLobbies(available, session), []);
  assert.deepEqual(getJoinedLobbies([], session), []);
  assert.equal(available.length, 6);
});

test('View all navigation and empty state are localized in both languages', () => {
  for (const language of ['ru', 'en']) {
    const t = createTranslator(language);
    for (const key of ['yourLobbies.open', 'yourLobbies.emptyTitle', 'yourLobbies.emptyDescription', 'conversation.backToYourLobbies']) assert.ok(t(key));
  }
});
