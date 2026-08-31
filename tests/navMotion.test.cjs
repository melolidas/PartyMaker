const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  easeNavMotion,
  getNavGlintLayout,
  getNavItemLayout,
  getNavScrollAnimation,
  navLayout,
  navMotion,
} = require('../.expo/nav-tests/navMotion.js');

test('motion easing is continuous, monotonic and has gentle endpoints', () => {
  assert.equal(easeNavMotion(0), 0);
  assert.equal(easeNavMotion(1), 1);
  assert.ok(Math.abs(easeNavMotion(0.5) - 0.5) < 1e-10);
  assert.ok(easeNavMotion(0.01) < 0.001);
  assert.ok(1 - easeNavMotion(0.99) < 0.001);
  for (let step = 1; step <= 100; step++) {
    assert.ok(easeNavMotion(step / 100) >= easeNavMotion((step - 1) / 100));
  }
});

test('scroll motion is spread over more than a second, with limited frame-to-frame change', () => {
  assert.ok(navMotion.scrollDuration >= 1500);
  for (let ms = 0; ms < navMotion.scrollDuration; ms += 16) {
    const delta = easeNavMotion((ms + 16) / navMotion.scrollDuration)
      - easeNavMotion(ms / navMotion.scrollDuration);
    assert.ok(delta * (1 - navMotion.compactScale) < 0.0015);
  }
  assert.ok(navMotion.pressInDuration >= 600);
  assert.ok(navMotion.pressOutDuration >= 1000);
});

test('radial glint stays centered on every icon and reaches all panel corners', () => {
  for (const width of [276, 346, 400]) {
    for (let index = 0; index < 5; index++) {
      const origin = 9 + ((width - 18) / 5) * (index + 0.5);
      const layout = getNavGlintLayout(origin, width);
      assert.ok(Math.abs(layout.left + layout.radius - origin) < 1e-9);
      assert.ok(Math.abs(layout.top + layout.radius - 32) < 1e-9);
      assert.equal(layout.diameter, layout.radius * 2);
      for (const [x, y] of [[0, 0], [width, 0], [0, 64], [width, 64]]) {
        assert.ok(Math.hypot(x - origin, y - 32) <= layout.radius + 1e-9);
      }
    }
  }
});

test('glint expands and disappears quickly without a hold stage', () => {
  assert.ok(navMotion.glintDuration <= 400);
  assert.ok(navMotion.glintFillAt * navMotion.glintDuration <= 250);
  assert.ok(navMotion.reducedFeedbackDuration <= navMotion.glintDuration);
  assert.equal('glintHoldUntil' in navMotion, false);
});

test('glint geometry clamps taps to the panel and handles initial zero width', () => {
  assert.deepEqual(getNavGlintLayout(100, 0), { width: 0, origin: 0, radius: 0, diameter: 0, left: 0, top: 32 });
  assert.equal(getNavGlintLayout(-10, 346).origin, 0);
  assert.equal(getNavGlintLayout(400, 346).origin, 346);
});

test('reduced motion never disables compact mode or its return to full size', () => {
  for (const reduceMotion of [true, false]) {
    assert.equal(getNavScrollAnimation(true, reduceMotion).toValue, 1);
    assert.equal(getNavScrollAnimation(false, reduceMotion).toValue, 0);
    assert.ok(getNavScrollAnimation(true, reduceMotion).duration > 0);
  }
  assert.ok(getNavScrollAnimation(true, true).duration < getNavScrollAnimation(true, false).duration);
});

test('shared indicator is larger and remains centered under all five icons', () => {
  for (const width of [276, 346, 400]) {
    const { slotWidth, indicatorWidth, indicatorLeft } = getNavItemLayout(width);
    assert.ok(indicatorWidth > Math.min(62, slotWidth - 6));
    assert.ok(navLayout.indicatorHeight > 44);
    for (let index = 0; index < navLayout.itemCount; index++) {
      const left = indicatorLeft + index * slotWidth;
      const center = left + indicatorWidth / 2;
      const iconCenter = navLayout.horizontalPadding + (index + 0.5) * slotWidth;
      assert.ok(Math.abs(center - iconCenter) < 1e-9);
      assert.ok(left >= 0);
      assert.ok(left + indicatorWidth <= width);
    }
  }
});

test('indicator layout stays finite before the initial native layout event', () => {
  assert.equal(getNavItemLayout(0).indicatorWidth, 0);
  assert.equal(getNavItemLayout(0).slotWidth, 0);
});
