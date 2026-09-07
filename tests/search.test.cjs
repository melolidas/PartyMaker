const assert = require('node:assert/strict');
const { test } = require('node:test');
const { searchLobbies } = require('../.expo/home-tests/features/search/searchLobbies.js');
const { demoLobbies } = require('../.expo/home-tests/features/home/lobbies.js');
const { createTranslator } = require('../.expo/home-tests/i18n/translations.js');
const ru = createTranslator('ru');
const en = createTranslator('en');
const ids = (query, t = ru, lobbies = demoLobbies) => searchLobbies(lobbies, query, t).map(lobby => lobby.id);

test('empty input shows every lobby in its original order without modifying the fixtures', () => {
  for (const query of ['', '   ', '\n\t']) assert.deepEqual(ids(query), demoLobbies.map(lobby => lobby.id));
  const result = searchLobbies(demoLobbies, '', ru);
  assert.notEqual(result, demoLobbies);
  result.pop();
  assert.equal(demoLobbies.length, 6);
});

test('localized lobby names match in Russian and English without case sensitivity', () => {
  assert.deepEqual(ids('  ПИЦЦА  '), ['pizza']);
  assert.deepEqual(ids('баскет'), ['basketball']);
  assert.deepEqual(ids('BASKETBALL', en), ['basketball']);
  assert.deepEqual(ids('CS2', en), ['cs2']);
});

test('search covers physical venues and translated place labels', () => {
  assert.deepEqual(ids('bar campus'), ['beer']);
  assert.deepEqual(ids('north'), ['basketball']);
  assert.deepEqual(ids('imax'), ['cinema']);
  assert.deepEqual(ids('онлайн'), ['cs2']);
  assert.deepEqual(ids('online', en), ['cs2']);
  assert.deepEqual(ids('Ала Арча'), ['hike']);
});

test('multiple words may match across title and venue but every word is required', () => {
  assert.deepEqual(ids('  пицца   chanti '), ['pizza']);
  assert.deepEqual(ids('north\tбаскетбол'), ['basketball']);
  assert.deepEqual(ids('north пицца'), []);
});

test('Russian е and ё and Unicode forms compare consistently', () => {
  const lobby = { ...demoLobbies[0], place: 'Берёзка', placeKey: undefined };
  assert.deepEqual(ids('березка', ru, [lobby]), ['beer']);
  assert.deepEqual(ids('ＣＳ２', en), ['cs2']);
});

test('unmatched queries and empty data produce an empty list; input is literal, not a regex', () => {
  for (const query of ['несуществующее место', '.*', '[', 'x'.repeat(100)]) assert.deepEqual(ids(query), []);
  assert.deepEqual(ids('', ru, []), []);
});

test('search UI labels are available in both app languages', () => {
  for (const t of [ru, en]) {
    for (const key of ['search.title', 'search.open', 'search.back', 'search.placeholder', 'search.input', 'search.clear', 'search.allLobbies', 'search.results', 'search.emptyTitle', 'search.emptyDescription']) {
      assert.ok(t(key).trim().length > 0);
    }
  }
});
