const assert = require('node:assert/strict');
const { test } = require('node:test');
const { resolveAppLanguage } = require('../.expo/i18n-tests/language.js');
const { createTranslator, translations } = require('../.expo/i18n-tests/translations.js');

test('Russian language variants all select Russian, regardless of region', () => {
  for (const languageTag of ['ru', 'ru-RU', 'ru-KG', 'ru-US', 'ru-Cyrl-RU', 'RU_ru', ' ru-RU ']) {
    assert.equal(resolveAppLanguage([{ languageTag }]), 'ru', languageTag);
  }
  assert.equal(resolveAppLanguage([{ languageCode: 'ru', languageTag: 'ru-KG' }]), 'ru');
});

test('English and every unsupported primary language select English', () => {
  for (const languageTag of ['en', 'en-GB', 'en-RU', 'ky-KG', 'de-DE', 'fr-FR', 'ar', 'ja-JP', 'uk-UA', 'rue']) {
    assert.equal(resolveAppLanguage([{ languageTag }]), 'en', languageTag);
  }
});

test('Russian as a secondary language must not override the primary language', () => {
  assert.equal(resolveAppLanguage([{ languageTag: 'de-DE' }, { languageTag: 'ru-RU' }]), 'en');
  assert.equal(resolveAppLanguage([{ languageCode: 'en' }, { languageCode: 'ru' }]), 'en');
  assert.equal(resolveAppLanguage([{ languageCode: 'ru' }, { languageCode: 'en' }]), 'ru');
});

test('language code is preferred, missing codes fall back to the primary tag', () => {
  assert.equal(resolveAppLanguage([{ languageCode: 'RU', languageTag: 'ru-RU' }]), 'ru');
  assert.equal(resolveAppLanguage([{ languageCode: null, languageTag: 'ru-KG' }]), 'ru');
  assert.equal(resolveAppLanguage([{ languageCode: '', languageTag: 'ru' }]), 'ru');
  assert.equal(resolveAppLanguage([{ languageCode: 'en', languageTag: 'ru-RU' }]), 'en');
});

test('empty or unavailable language data safely falls back to English', () => {
  for (const locales of [[], [{}], [{ languageCode: null, languageTag: null }], [{ languageTag: '' }]]) {
    assert.equal(resolveAppLanguage(locales), 'en');
  }
});

test('exactly two complete dictionaries, with a nonempty value for every key', () => {
  assert.deepEqual(Object.keys(translations).sort(), ['en', 'ru']);
  assert.deepEqual(Object.keys(translations.ru).sort(), Object.keys(translations.en).sort());
  for (const [language, dictionary] of Object.entries(translations)) {
    const t = createTranslator(language);
    for (const [key, value] of Object.entries(dictionary)) {
      assert.equal(typeof value, 'string');
      assert.ok(value.trim().length > 0, `${language}.${key} is empty`);
      assert.equal(t(key), value);
      if (language === 'ru') assert.match(value, /[А-Яа-яЁё]/, `${key} needs Russian text`);
    }
  }
});

test('all five screens and icon-only navigation have translations', () => {
  const t = createTranslator('ru');
  assert.deepEqual(
    ['nav.home', 'nav.moments', 'nav.create', 'nav.activity', 'nav.profile'].map(t),
    ['Главная', 'Моменты', 'Создать лобби', 'Активность', 'Профиль'],
  );
  assert.equal(createTranslator('en')('search.title'), 'Search');
  assert.equal(t('search.title'), 'Поиск');
});

test('demo dates and notification times use the selected language', () => {
  const t = createTranslator('ru');
  assert.equal(t('time.15m'), '15 мин');
  assert.equal(t('time.2h'), '2 ч');
  assert.equal(t('demo.aug24'), '24 авг.');
});

test('demo form values fit the displayed character limits in both languages', () => {
  for (const language of ['en', 'ru']) {
    const t = createTranslator(language);
    assert.ok(Array.from(t('demo.beer')).length <= 40);
    assert.ok(Array.from(t('demo.lobbyDescription')).length <= 200);
  }
});

test('UI translations keep decorative artwork in icon components, not emoji text', () => {
  for (const dictionary of Object.values(translations)) {
    for (const [key, value] of Object.entries(dictionary)) {
      assert.doesNotMatch(value, /\p{Extended_Pictographic}/u, `${key} contains a platform emoji`);
    }
  }
});

test('native config declares only English and Russian and keeps left-to-right layout', () => {
  const config = require('../app.json').expo;
  const [, options] = config.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-localization');
  assert.deepEqual(options.supportedLocales, { ios: ['en', 'ru'], android: ['en', 'ru'] });
  assert.equal(options.supportsRTL, false);
});
