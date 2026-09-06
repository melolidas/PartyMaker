const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getLobbyChats, getLobbyChatGroups } = require('../.expo/chat-tests/features/chats/lobbyChats.js');
const { demoLobbies, getLobbyMembers, joinDemoLobby } = require('../.expo/chat-tests/features/home/lobbies.js');
const { createTranslator } = require('../.expo/chat-tests/i18n/translations.js');
const { getChatPulseMotion, shouldRunChatPulse } = require('../.expo/chat-tests/features/chats/chatStatusMotion.js');
const { chatPanActivation, getChatSwipeOffset, getNativeChatSwipeTravel, shouldDismissChats } = require('../.expo/chat-tests/features/chats/chatSwipe.js');

const NOW = 1788350400000;
const initial = { startedAt: NOW, joinedIds: [] };
const pizza = demoLobbies.find((lobby) => lobby.id === 'pizza');

test('the initial inbox contains exactly the two existing joined lobbies', () => {
  const chats = getLobbyChats(initial);
  assert.deepEqual(chats.map(({ lobby }) => lobby.id), ['beer', 'cs2']);
  assert.deepEqual(chats.map(({ lobby }) => getLobbyMembers(lobby, initial)), [4, 3]);
});

test('joining a lobby adds it to chats with its existing photo and member count', () => {
  const session = joinDemoLobby(initial, pizza, NOW);
  const chats = getLobbyChats(session);
  assert.deepEqual(chats.map(({ lobby }) => lobby.id), ['beer', 'cs2', 'pizza']);
  const added = chats.find(({ lobby }) => lobby.id === 'pizza');
  assert.equal(added.lobby, pizza);
  assert.equal(getLobbyMembers(added.lobby, session), 4);
  assert.equal(added.previewKey, 'chats.noMessages');
  assert.equal(added.timeKey, undefined);
});

test('unjoined lobbies and unknown membership ids never appear as chats', () => {
  assert.deepEqual(getLobbyChats({ ...initial, joinedIds: ['unknown'] }).map(({ lobby }) => lobby.id), ['beer', 'cs2']);
  assert.deepEqual(getLobbyChats(initial).map(({ lobby }) => lobby.id), ['beer', 'cs2']);
});

test('existing or repeated memberships cannot duplicate chat rows', () => {
  const session = { ...initial, joinedIds: ['beer', 'beer', 'cs2', 'pizza', 'pizza'] };
  assert.deepEqual(getLobbyChats(session).map(({ lobby }) => lobby.id), ['beer', 'cs2', 'pizza']);
  assert.deepEqual(session.joinedIds, ['beer', 'beer', 'cs2', 'pizza', 'pizza']);
});

test('chats remain available after the demo event has started', () => {
  const session = { startedAt: NOW - 7 * 24 * 60 * 60 * 1000, joinedIds: ['pizza'] };
  for (const { lobby } of getLobbyChats(session)) assert.ok(session.startedAt + lobby.startsAfterMs < NOW);
  assert.deepEqual(getLobbyChats(session).map(({ lobby }) => lobby.id), ['beer', 'cs2', 'pizza']);
});

test('chat status labels, previews and navigation exist in both languages', () => {
  const session = joinDemoLobby(initial, pizza, NOW);
  for (const language of ['ru', 'en']) {
    const t = createTranslator(language);
    for (const key of ['chats.title', 'chats.open', 'chats.back', 'chats.active', 'chats.inactive']) assert.ok(t(key));
    for (const chat of Object.values(getLobbyChatGroups(session)).flat()) {
      assert.ok(t(chat.lobby.titleKey));
      assert.ok(t(chat.previewKey));
      if (chat.timeKey) assert.ok(t(chat.timeKey));
    }
  }
});

test('active and inactive chats occupy separate groups with distinct lobby ids', () => {
  const groups = getLobbyChatGroups(initial);
  assert.deepEqual(Object.keys(groups), ['active', 'inactive']);
  assert.deepEqual(groups.active.map(({ lobby }) => lobby.id), ['beer', 'cs2']);
  assert.deepEqual(groups.inactive.map(({ lobby }) => lobby.id), ['inactive-cinema', 'inactive-hike']);
  const ids = Object.values(groups).flat().map(({ lobby }) => lobby.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('inactive mock lobbies are historical instances, not additional Home memberships', () => {
  const { inactive } = getLobbyChatGroups(initial);
  for (const { lobby } of inactive) {
    assert.ok(lobby.startsAfterMs < 0);
    assert.ok(lobby.members > 0 && lobby.members <= lobby.capacity);
    assert.equal(getLobbyMembers(lobby, initial), lobby.members);
    assert.ok(!demoLobbies.some(({ id }) => id === lobby.id));
  }
  assert.deepEqual(demoLobbies.filter((lobby) => lobby.isYours).map(({ id }) => id), ['beer', 'cs2']);
  assert.deepEqual(initial.joinedIds, []);
});

test('new membership adds only to the active group and leaves archived previews unchanged', () => {
  const before = getLobbyChatGroups(initial);
  const session = joinDemoLobby(initial, pizza, NOW);
  const after = getLobbyChatGroups(session);
  assert.deepEqual(after.active.map(({ lobby }) => lobby.id), ['beer', 'cs2', 'pizza']);
  assert.deepEqual(after.inactive, before.inactive);
});

test('joining the current cinema lobby does not merge it with its historical chat', () => {
  const cinema = demoLobbies.find((lobby) => lobby.id === 'cinema');
  const groups = getLobbyChatGroups(joinDemoLobby(initial, cinema, NOW));
  assert.ok(groups.active.some(({ lobby }) => lobby.id === 'cinema'));
  assert.ok(groups.inactive.some(({ lobby }) => lobby.id === 'inactive-cinema'));
});

test('normal pulse visibly grows the 16px dot by at least 6px without flashing rapidly', () => {
  const pulse = getChatPulseMotion(false);
  assert.ok(16 * (Math.max(...pulse.dotScale) - Math.min(...pulse.dotScale)) >= 6);
  assert.equal(pulse.duration, 1200);
  assert.ok(Math.min(...pulse.dotOpacity) >= 0.88);
  assert.equal(Math.max(...pulse.dotOpacity), 1);
  assert.ok(Math.max(...pulse.haloOpacity) >= 0.7);
});

test('outward wave is distinct, grows monotonically and disappears before restarting', () => {
  const pulse = getChatPulseMotion(false);
  assert.ok(Math.max(...pulse.ringOpacity) >= 0.8);
  assert.equal(pulse.ringOpacity[0], 0);
  assert.equal(pulse.ringOpacity.at(-1), 0);
  for (let i = 1; i < pulse.ringScale.length; i++) assert.ok(pulse.ringScale[i] > pulse.ringScale[i - 1]);
  assert.ok(24 * pulse.ringScale.at(-1) > 40);
});

test('pulse keyframes have seamless visible endpoints and valid ranges', () => {
  for (const reduced of [false, true]) {
    const pulse = getChatPulseMotion(reduced);
    assert.equal(pulse.inputRange[0], 0);
    assert.equal(pulse.inputRange.at(-1), 1);
    for (let i = 1; i < pulse.inputRange.length; i++) assert.ok(pulse.inputRange[i] > pulse.inputRange[i - 1]);
    for (const key of ['dotScale', 'dotOpacity', 'haloScale', 'haloOpacity', 'ringScale', 'ringOpacity']) {
      assert.equal(pulse[key].length, pulse.inputRange.length);
      assert.ok(pulse[key].every(Number.isFinite));
      if (key.endsWith('Opacity')) assert.ok(pulse[key].every((value) => value >= 0 && value <= 1));
      if (key !== 'ringScale') assert.equal(pulse[key][0], pulse[key].at(-1));
    }
  }
});

test('reduced motion remains visible on iPhone without changing the dot size', () => {
  const pulse = getChatPulseMotion(true);
  assert.ok(pulse.dotScale.every((scale) => scale === 1));
  assert.ok(pulse.duration >= 2000);
  assert.ok(Math.min(...pulse.dotOpacity) >= 0.4);
  assert.ok(Math.max(...pulse.dotOpacity) - Math.min(...pulse.dotOpacity) >= 0.5);
  assert.equal(pulse.dotOpacity[0], 1, 'show a bright red dot immediately');
  assert.equal(pulse.dotOpacity.at(-1), 1, 'end in the bright state');
});

test('red dot stays near full brightness for over 70 percent of each cycle', () => {
  for (const reduced of [false, true]) {
    const pulse = getChatPulseMotion(reduced);
    const threshold = 0.95;
    let brightFraction = 0;
    for (let i = 1; i < pulse.inputRange.length; i++) {
      const duration = pulse.inputRange[i] - pulse.inputRange[i - 1];
      const from = pulse.dotOpacity[i - 1];
      const to = pulse.dotOpacity[i];
      const low = Math.min(from, to);
      const high = Math.max(from, to);
      if (low >= threshold) brightFraction += duration;
      else if (high > threshold) brightFraction += duration * (high - threshold) / (high - low);
    }
    assert.ok(brightFraction > 0.7, `bright fraction: ${brightFraction}`);
    assert.ok(pulse.inputRange[1] <= 0.15, 'the dot should become bright quickly');
    assert.equal(pulse.dotOpacity[1], 1);
    assert.equal(pulse.dotOpacity[2], 1);
  }
});

test('pulse runs only for active chats in the foreground and resumes when active again', () => {
  assert.equal(shouldRunChatPulse(true, 'active'), true);
  assert.equal(shouldRunChatPulse(true, null), true);
  assert.equal(shouldRunChatPulse(true, 'inactive'), false);
  assert.equal(shouldRunChatPulse(true, 'background'), false);
  assert.equal(shouldRunChatPulse(false, 'active'), false);
  assert.equal(shouldRunChatPulse(false, null), false);
  assert.deepEqual(['active', 'inactive', 'background', 'active'].map((state) => shouldRunChatPulse(true, state)), [true, false, false, true]);
});

const release = (dx, dy = 0, vx = 0) => ({ dx, dy, vx });
const nativeEvent = (translationX, translationY = 0, velocityX = 0) => ({ translationX, translationY, velocityX, numberOfPointers: 1 });

test('the native recognizer activates a light right swipe and yields vertical gestures to scrolling', () => {
  assert.equal(chatPanActivation.activeOffsetX, 6);
  assert.equal(chatPanActivation.failOffsetX, -10);
  assert.deepEqual(chatPanActivation.failOffsetY, [-16, 16]);
  assert.equal(chatPanActivation.maxPointers, 1);
});

test('the chat page tracks the finger without moving left or past the viewport', () => {
  assert.equal(getChatSwipeOffset(-30, 390), 0);
  assert.equal(getChatSwipeOffset(0, 390), 0);
  assert.equal(getChatSwipeOffset(125, 390), 125);
  assert.equal(getChatSwipeOffset(600, 390), 390);
});

test('a short slow right swipe dismisses across phone and tablet widths', () => {
  for (const width of [320, 390, 430, 768, 1024]) {
    assert.equal(shouldDismissChats(release(80, 5), width), true);
    assert.equal(shouldDismissChats(release(30, 2), width), false);
  }
  assert.equal(shouldDismissChats(release(60, 4), 390), true);
});

test('a deliberate quick right flick dismisses without requiring a long drag', () => {
  assert.equal(shouldDismissChats(release(24, 3, 0.35), 390), true);
  assert.equal(shouldDismissChats(release(15, 0, 1.5), 390), false);
  assert.equal(shouldDismissChats(release(45, 3, 0.2), 390), false);
});

test('short, leftward, vertical and reversed swipes restore the chat screen', () => {
  for (const gesture of [release(30), release(-200, 0, -1), release(30, 180, 1), { ...release(100, 0, -0.3), peakDx: 170 }, release(0)]) {
    assert.equal(shouldDismissChats(gesture, 390), false);
  }
  assert.equal(shouldDismissChats(release(200), 0), false);
});

test('a recognized diagonal thumb swipe can close the chat screen', () => {
  assert.equal(shouldDismissChats(release(65, 48), 390), true);
});

test('native translation includes the initial movement without adding it twice', () => {
  assert.deepEqual(getNativeChatSwipeTravel(nativeEvent(18, 4)), release(18, 4));
  const travel = getNativeChatSwipeTravel(nativeEvent(62, 6));
  assert.deepEqual(travel, release(62, 6));
  assert.equal(shouldDismissChats(travel, 390), true);
});

test('native velocity is converted from points per second before projecting a flick', () => {
  const travel = getNativeChatSwipeTravel(nativeEvent(24, 3, 350));
  assert.deepEqual(travel, release(24, 3, 0.35));
  assert.equal(shouldDismissChats(travel, 390), true);
});

test('small release wobble does not undo an otherwise complete swipe', () => {
  assert.equal(shouldDismissChats({ ...release(65, 5, -0.2), peakDx: 68 }, 390), true);
  assert.equal(shouldDismissChats({ ...release(90, 5, -0.4), peakDx: 94 }, 390), true);
  assert.equal(shouldDismissChats({ ...release(70, 5, 0), peakDx: 110 }, 390), false);
});

test('an immediate retry continues from the current visible settling position', () => {
  const travel = getNativeChatSwipeTravel(nativeEvent(32, 2), 30);
  assert.deepEqual(travel, release(62, 2));
  assert.equal(shouldDismissChats(travel, 390), true);
});
