import { ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Keyboard, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, type NativeGesture } from 'react-native-gesture-handler';
import { colors } from '../../theme';
import { chatPanActivation } from './chatSwipe';
import { createChatSwipeController } from './chatSwipeController';

type Props = {
  name: 'chats' | 'conversation' | 'search' | 'your-lobbies';
  active?: boolean;
  edgeOnly?: boolean;
  onClose: () => void;
  onBackReady: (close: () => void) => void;
  children: (close: () => void, scrollGesture: NativeGesture) => ReactNode;
};

/** A native swipeable page, shared by chats and search. */
export function SwipeBackPage({ name, active = true, edgeOnly = false, onClose, onBackReady, children }: Props) {
  const { width } = useWindowDimensions();
  const translateX = useRef(new Animated.Value(0)).current;
  const closeCallback = useRef(onClose);
  const viewportWidth = useRef(width);
  const reduceMotion = useRef(true);
  const visibleOffset = useRef(0);
  // Even without callbacks, RNGH defaults a Native gesture to Reanimated.
  // Expo Go includes its native module, but this app does not initialize its
  // JS runtime. Keep event dispatch on JS, like the back gesture below.
  // Recognition and ScrollView arbitration still happen natively.
  const scrollGesture = useMemo(() => Gesture.Native().runOnJS(true).withTestId(`${name}-native-scroll`), [name]);

  const swipe = useMemo(() => createChatSwipeController({
    getWidth: () => viewportWidth.current,
    getReduceMotion: () => reduceMotion.current,
    getPosition: () => visibleOffset.current,
    setPosition: (position) => {
      visibleOffset.current = position;
      translateX.setValue(position);
    },
    stopAnimation: () => translateX.stopAnimation(),
    animateTo: (position, duration, complete) => {
      Animated.timing(translateX, {
        toValue: position,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
        isInteraction: false,
      }).start(({ finished }) => complete(finished));
    },
    onClose: () => {
      Keyboard.dismiss();
      closeCallback.current();
    },
  }), [translateX]);

  const close = useCallback(() => {
    Keyboard.dismiss();
    swipe.close();
  }, [swipe]);

  useEffect(() => {
    const listener = translateX.addListener(({ value }) => { visibleOffset.current = value; });
    return () => translateX.removeListener(listener);
  }, [translateX]);

  useEffect(() => { closeCallback.current = onClose; }, [onClose]);

  useEffect(() => {
    viewportWidth.current = width;
    swipe.reset();
  }, [width, swipe]);

  useEffect(() => {
    swipe.reset();
    if (active) onBackReady(close);
  }, [active, close, onBackReady, swipe]);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) reduceMotion.current = enabled;
    }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      reduceMotion.current = enabled;
    });
    return () => {
      mounted = false;
      subscription?.remove();
      swipe.dispose();
    };
  }, [swipe]);

  const backGesture = useMemo(() => Gesture.Pan()
    .withTestId(`${name}-native-back`)
    .enabled(active)
    // Pages with text inputs navigate from the edge only, leaving horizontal
    // text selection available in the composer and search field.
    .hitSlop(edgeOnly ? { left: 0, width: 28 } : 0)
    .activeOffsetX(chatPanActivation.activeOffsetX)
    .failOffsetX(chatPanActivation.failOffsetX)
    .failOffsetY(chatPanActivation.failOffsetY)
    .maxPointers(chatPanActivation.maxPointers)
    .shouldCancelWhenOutside(false)
    .blocksExternalGesture(scrollGesture)
    .runOnJS(true)
    .onStart(swipe.start)
    .onUpdate(swipe.update)
    .onEnd(swipe.end)
    .onFinalize(() => swipe.cancel())
    .onTouchesDown((event) => { if (event.numberOfTouches > 1) swipe.cancel(); }), [active, edgeOnly, name, scrollGesture, swipe]);

  return (
    <GestureDetector gesture={backGesture} touchAction="pan-y" userSelect={edgeOnly ? 'auto' : 'none'}>
      <Animated.View
        collapsable={false}
        testID={`${name}-swipe-surface`}
        style={[styles.surface, { transform: [{ translateX }] }]}
        pointerEvents={active ? 'auto' : 'none'}
        accessibilityViewIsModal={active}
        accessibilityElementsHidden={!active}
        importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
        aria-hidden={!active}
        onAccessibilityEscape={close}
      >
        {children(close, scrollGesture)}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  surface: { ...StyleSheet.absoluteFill, backgroundColor: colors.background },
});
