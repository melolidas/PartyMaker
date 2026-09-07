const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createChatSwipeController } = require('../.expo/chat-tests/features/chats/chatSwipeController.js');

const event = (translationX, translationY = 0, velocityX = 0, numberOfPointers = 1) => ({
  translationX, translationY, velocityX, numberOfPointers,
});

function fixture(reduced = false) {
  let position = 0;
  let closed = 0;
  let activeAnimation;
  const animations = [];
  const swipe = createChatSwipeController({
    getWidth: () => 390,
    getReduceMotion: () => reduced,
    getPosition: () => position,
    setPosition: (value) => { position = value; },
    stopAnimation: () => {
      const previous = activeAnimation;
      activeAnimation = undefined;
      previous?.complete(false);
    },
    animateTo: (target, duration, complete) => {
      activeAnimation = { target, duration, complete };
      animations.push(activeAnimation);
    },
    onClose: () => { closed += 1; },
  });
  return {
    swipe, animations,
    get position() { return position; },
    get closed() { return closed; },
    showPosition(value) { position = value; },
    finish(finished = true) {
      const animation = activeAnimation;
      assert.ok(animation, 'there must be an active animation');
      activeAnimation = undefined;
      if (finished) position = animation.target;
      animation.complete(finished);
    },
  };
}

test('native start/update/end closes after a short edge swipe, including zero pointers on release', () => {
  const f = fixture();
  f.swipe.start(event(8));
  assert.equal(f.position, 8);
  f.swipe.update(event(64, 8));
  assert.equal(f.position, 64);
  f.swipe.end(event(64, 8, 0, 0), true);
  f.swipe.cancel(); // RNGH onFinalize follows onEnd.
  assert.equal(f.animations.at(-1).target, 390);
  f.finish();
  assert.equal(f.closed, 1);
});

test('native activation and release suffice even if JS receives no intermediate updates', () => {
  const f = fixture();
  f.swipe.start(event(8));
  f.swipe.end(event(80, 6, 0, 0), true);
  f.finish();
  assert.equal(f.closed, 1);
});

test('Reduce Motion does not disable native edge-swipe dismissal', () => {
  const f = fixture(true);
  f.swipe.start(event(7));
  f.swipe.end(event(70, 6, 0, 0), true);
  assert.equal(f.animations.at(-1).duration, 120);
  f.finish();
  assert.equal(f.closed, 1);
});

test('a failed vertical native recognizer does not move or dismiss the screen', () => {
  const f = fixture();
  f.swipe.cancel();
  f.swipe.end(event(3, 160, 0, 0), false);
  assert.equal(f.position, 0);
  assert.equal(f.animations.length, 0);
  assert.equal(f.closed, 0);
});

test('a tiny gesture snaps back and leaves another attempt available', () => {
  const f = fixture();
  f.swipe.start(event(8));
  f.swipe.end(event(20, 2, 0, 0), true);
  f.swipe.cancel();
  assert.equal(f.animations.at(-1).target, 0);
  f.finish();
  assert.equal(f.position, 0);
  assert.equal(f.closed, 0);
  f.swipe.start(event(8));
  f.swipe.end(event(80, 0, 0, 0), true);
  f.finish();
  assert.equal(f.closed, 1);
});

test('an immediate retry interrupts snap-back and ignores its delayed completion', () => {
  const f = fixture();
  f.swipe.start(event(8));
  f.swipe.update(event(30));
  f.swipe.end(event(30, 0, 0, 0), true);
  const oldAnimation = f.animations.at(-1);
  f.showPosition(24);
  f.swipe.start(event(6));
  assert.equal(f.position, 30);
  oldAnimation.complete(true);
  f.swipe.update(event(40));
  assert.equal(f.position, 64);
  f.swipe.end(event(40, 0, 0, 0), true);
  f.finish();
  assert.equal(f.closed, 1);
});

test('additional fingers and OS cancellation cannot dismiss a chat', () => {
  for (const cancel of [f => f.swipe.update(event(100, 0, 0, 2)), f => f.swipe.cancel()]) {
    const f = fixture();
    f.swipe.start(event(8));
    f.swipe.update(event(100));
    cancel(f);
    f.swipe.end(event(100, 0, 0, 0), true);
    f.finish();
    assert.equal(f.closed, 0);
    assert.equal(f.position, 0);
  }
});

test('a cancelled completion animation cannot strand an already-confirmed dismissal', () => {
  const f = fixture();
  f.swipe.start(event(8));
  f.swipe.end(event(80, 0, 0, 0), true);
  f.finish(false);
  assert.equal(f.closed, 1);
});

test('Back and repeated close requests share a single dismissal', () => {
  for (const reduced of [false, true]) {
    const f = fixture(reduced);
    f.swipe.close();
    f.swipe.close();
    if (!reduced) {
      assert.equal(f.animations.length, 1);
      f.finish();
    }
    f.swipe.close();
    f.animations.at(-1)?.complete(true);
    assert.equal(f.closed, 1);
  }
});

test('unmount invalidates pending callbacks and stops further gesture effects', () => {
  const f = fixture();
  f.swipe.start(event(8));
  f.swipe.end(event(80, 0, 0, 0), true);
  const oldAnimation = f.animations.at(-1);
  f.swipe.dispose();
  oldAnimation.complete(true);
  f.swipe.start(event(8));
  f.swipe.end(event(80, 0, 0, 0), true);
  f.swipe.close();
  assert.equal(f.closed, 0);
  assert.equal(f.animations.length, 1);
});

test('rotation cancels an unfinished drag without disabling subsequent swipes', () => {
  const f = fixture();
  f.swipe.start(event(8));
  f.swipe.update(event(40));
  f.swipe.reset();
  assert.equal(f.position, 0);
  f.swipe.start(event(8));
  f.swipe.end(event(80, 0, 0, 0), true);
  f.finish();
  assert.equal(f.closed, 1);
});

test('a retained page can be reset and swiped again after an inner navigation pop', () => {
  const f = fixture();
  for (let count = 1; count <= 2; count++) {
    f.swipe.reset();
    assert.equal(f.position, 0);
    f.swipe.start(event(8));
    f.swipe.end(event(80, 0, 0, 0), true);
    f.finish();
    assert.equal(f.closed, count);
  }
});
