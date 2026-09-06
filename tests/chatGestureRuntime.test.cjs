const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { NativeGesture } = require('../node_modules/react-native-gesture-handler/lib/commonjs/handlers/gestures/nativeGesture.js');
const { PanGesture } = require('../node_modules/react-native-gesture-handler/lib/commonjs/handlers/gestures/panGesture.js');
const { chatPanActivation } = require('../.expo/chat-tests/features/chats/chatSwipe.js');

const filename = path.join(__dirname, '../src/features/chats/SwipeBackPage.tsx');
const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const Gesture = { Native: () => new NativeGesture(), Pan: () => new PanGesture() };

// Evaluate the production useMemo callback with real RNGH gesture builders.
// Mocked gestures or a duplicated test factory would miss its native event route.
function buildProductionGesture(variableName, scope) {
  const matches = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variableName) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(matches.length, 1, `expected one production ${variableName} declaration`);
  const initializer = matches[0].initializer;
  assert.ok(initializer && ts.isCallExpression(initializer));
  assert.equal(initializer.expression.getText(source), 'useMemo');
  const callback = initializer.arguments[0];
  assert.ok(callback && ts.isArrowFunction(callback));
  const javascript = ts.transpileModule(`(${callback.getText(source)})()`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return vm.runInNewContext(javascript, { Gesture, ...scope }, { filename, timeout: 1000 });
}

function inBridgelessRuntime(check) {
  const previous = Object.getOwnPropertyDescriptor(global, 'RN$Bridgeless');
  Object.defineProperty(global, 'RN$Bridgeless', { configurable: true, writable: true, value: true });
  try {
    check();
  } finally {
    if (previous) Object.defineProperty(global, 'RN$Bridgeless', previous);
    else delete global.RN$Bridgeless;
  }
}

test('negative control: an unconfigured callback-free Native gesture selects Reanimated on Fabric', () => {
  inBridgelessRuntime(() => {
    const previousConfiguration = Gesture.Native().withTestId('conversation-native-scroll');
    assert.deepEqual(previousConfiguration.handlers.isWorklet, []);
    assert.equal(previousConfiguration.shouldUseReanimated, true);
  });
});

for (const name of ['chats', 'conversation', 'search', 'your-lobbies']) {
  test(`${name}: the production scroll gesture dispatches through JS without a Reanimated runtime`, () => {
    inBridgelessRuntime(() => {
      const scrollGesture = buildProductionGesture('scrollGesture', { name });
      assert.ok(scrollGesture instanceof NativeGesture);
      assert.equal(scrollGesture.config.testId, `${name}-native-scroll`);
      assert.equal(scrollGesture.config.runOnJS, true);
      assert.equal(scrollGesture.shouldUseReanimated, false);
    });
  });

  test(`${name}: back and native scroll retain their relationship with JS event dispatch`, () => {
    inBridgelessRuntime(() => {
      const scrollGesture = buildProductionGesture('scrollGesture', { name });
      const swipe = { start() {}, update() {}, end() {}, cancel() {} };
      const edgeOnly = name !== 'chats';
      const backGesture = buildProductionGesture('backGesture', {
        name, active: true, edgeOnly, scrollGesture, chatPanActivation, swipe,
      });
      assert.ok(backGesture instanceof PanGesture);
      assert.equal(backGesture.config.runOnJS, true);
      assert.equal(backGesture.shouldUseReanimated, false);
      assert.deepEqual(backGesture.config.blocksHandlers, [scrollGesture]);
      assert.equal(backGesture.config.failOffsetYStart, chatPanActivation.failOffsetY[0]);
      assert.equal(backGesture.config.failOffsetYEnd, chatPanActivation.failOffsetY[1]);
      assert.equal(backGesture.config.maxPointers, 1);
      if (edgeOnly) {
        assert.equal(backGesture.config.hitSlop.left, 0);
        assert.equal(backGesture.config.hitSlop.width, 28);
      } else {
        assert.equal(backGesture.config.hitSlop, 0);
      }
    });
  });
}
