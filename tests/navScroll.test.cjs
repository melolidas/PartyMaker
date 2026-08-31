const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getNavScrollInput, getNavScrollState, initialNavScrollState } = require('../.expo/nav-tests/navScroll.js');

function scroll(offsets, maxOffset = 800, initial = initialNavScrollState) {
  return offsets.reduce((state, offset) => getNavScrollState(state, offset, maxOffset), initial);
}

test('starts expanded and stays expanded near the top', () => {
  assert.equal(initialNavScrollState.compact, false);
  assert.equal(scroll([5, 12, 24, 30]).compact, false);
});

test('shrinks on sustained downward scroll', () => {
  assert.equal(scroll([8, 16, 28, 42, 80]).compact, true);
});

test('expands when scrolling up, even far from the top', () => {
  assert.equal(scroll([80, 240, 238, 234, 228]).compact, false);
});

test('small direction reversals do not flicker', () => {
  assert.equal(scroll([80, 79, 81, 78, 82]).compact, true);
  assert.equal(scroll([80, 60, 64, 62, 66]).compact, false);
});

test('shrinks again after the direction changes back down', () => {
  assert.equal(scroll([160, 140, 144, 150, 158]).compact, true);
});

test('always expands at the top and ignores negative overscroll', () => {
  const state = scroll([160, 12, -20]);
  assert.equal(state.compact, false);
  assert.equal(state.offset, 0);
});

test('bottom bounce does not incorrectly expand the nav', () => {
  const state = scroll([100, 800, 840, 815, 800]);
  assert.equal(state.compact, true);
  assert.equal(state.offset, 800);
});

test('short non-scrollable content stays expanded', () => {
  assert.equal(scroll([20, 40, -20, 0], 0).compact, false);
  assert.equal(scroll([20, 40], -100).compact, false);
});

test('unchanged and tiny offsets do not trigger redundant changes', () => {
  const state = scroll([100]);
  assert.equal(getNavScrollState(state, 100, 800), state);
  assert.equal(getNavScrollState(state, 100.2, 800), state);
});

test('short scroll ranges on large phones can shrink and expand the panel', () => {
  for (const range of [8, 20, 30, 40]) {
    const down = scroll([range * 0.2, range * 0.5, range], range);
    assert.equal(down.compact, true);
    const up = scroll([range * 0.7, range * 0.4], range, down);
    assert.equal(up.compact, false);
  }
});

test('a single coalesced drag-end event still enters compact mode', () => {
  assert.equal(scroll([60]).compact, true);
});

test('iPhone content insets normalize the resting offset and available range', () => {
  const event = {
    contentOffset: { y: -59 },
    contentSize: { height: 1100 },
    layoutMeasurement: { height: 800 },
    contentInset: { top: 59, bottom: 34 },
  };
  const measured = { contentHeight: 0, viewportHeight: 0 };
  const resting = getNavScrollInput(event, measured);
  assert.deepEqual(resting, { offset: 0, maxOffset: 393 });
  const down = getNavScrollInput({ ...event, contentOffset: { y: -10 } }, measured);
  assert.equal(getNavScrollState(initialNavScrollState, down.offset, down.maxOffset).compact, true);
});

test('layout measurements keep scroll working when an event omits content size', () => {
  const input = getNavScrollInput(
    { contentOffset: { y: 70 }, contentSize: { height: 0 } },
    { contentHeight: 1200, viewportHeight: 800 },
  );
  assert.deepEqual(input, { offset: 70, maxOffset: 400 });
  assert.equal(getNavScrollState(initialNavScrollState, input.offset, input.maxOffset).compact, true);
});

test('iPhone rubber-band return does not falsely collapse or expand the panel', () => {
  const measured = { contentHeight: 1100, viewportHeight: 800 };
  const inset = { top: 59, bottom: 34 };
  const state = [-59, -100, -80, -59].reduce((previous, y) => {
    const input = getNavScrollInput({ contentOffset: { y }, contentInset: inset }, measured);
    return getNavScrollState(previous, input.offset, input.maxOffset);
  }, initialNavScrollState);
  assert.equal(state.compact, false);
  assert.equal(state.offset, 0);
});
