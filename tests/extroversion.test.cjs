const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_EXTROVERSION_LEVEL,
  getExtroversionBand,
  getExtroversionVisual,
  normalizeExtroversionLevel,
  parseStoredExtroversionLevel,
} = require('../.expo/profile-tests/features/profile/extroversion.js');

test('normalizes an extroversion level to half steps from 1 to 10', () => {
  assert.equal(normalizeExtroversionLevel(-4), 1);
  assert.equal(normalizeExtroversionLevel(4.6), 4.5);
  assert.equal(normalizeExtroversionLevel(5.4), 5.5);
  assert.equal(normalizeExtroversionLevel(99), 10);
  assert.equal(normalizeExtroversionLevel(Number.NaN), DEFAULT_EXTROVERSION_LEVEL);
});

test('parses a persisted preference safely', () => {
  assert.equal(parseStoredExtroversionLevel(null), DEFAULT_EXTROVERSION_LEVEL);
  assert.equal(parseStoredExtroversionLevel(''), DEFAULT_EXTROVERSION_LEVEL);
  assert.equal(parseStoredExtroversionLevel('8'), 8);
  assert.equal(parseStoredExtroversionLevel('5.5'), 5.5);
  assert.equal(parseStoredExtroversionLevel('broken'), DEFAULT_EXTROVERSION_LEVEL);
});

test('maps the scale from a blue left position to a red right position', () => {
  const introvert = getExtroversionVisual(1);
  const ambivert = getExtroversionVisual(5.5);
  const extrovert = getExtroversionVisual(10);

  assert.equal(introvert.color, '#47C7FF');
  assert.equal(extrovert.color, '#FF3B30');
  assert.ok(introvert.needleRotation < ambivert.needleRotation);
  assert.ok(ambivert.needleRotation < extrovert.needleRotation);
  assert.equal(introvert.needleRotation, -70);
  assert.equal(ambivert.needleRotation, 0);
  assert.equal(extrovert.needleRotation, 70);
});

test('provides an understandable band for each part of the scale', () => {
  assert.equal(getExtroversionBand(1), 'introvert');
  assert.equal(getExtroversionBand(5.5), 'ambivert');
  assert.equal(getExtroversionBand(10), 'extrovert');
});
