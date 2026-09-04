import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Platform, StyleSheet, View } from 'react-native';
import { ChatStatus } from './lobbyChats';
import { getChatPulseMotion, shouldRunChatPulse } from './chatStatusMotion';

export function ChatStatusDot({ status }: { status: ChatStatus }) {
  const active = status === 'active';
  const progress = useRef(new Animated.Value(0)).current;
  // Use a gentle brightness pulse until the device preference is known, even
  // if that query fails. Reduced Motion removes scaling and travelling rings.
  const [reduceMotion, setReduceMotion] = useState(true);
  const [appState, setAppState] = useState(AppState.currentState);
  const motion = useMemo(() => getChatPulseMotion(reduceMotion), [reduceMotion]);

  useEffect(() => {
    if (!active) return;
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    }).catch(() => {});
    const motionSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const appSubscription = AppState.addEventListener('change', setAppState);
    return () => {
      mounted = false;
      motionSubscription?.remove();
      appSubscription?.remove();
    };
  }, [active]);

  useEffect(() => {
    if (!shouldRunChatPulse(active, appState)) {
      progress.setValue(0);
      return;
    }
    progress.setValue(0);
    // A single native timing loop keeps the iPhone pulse independent of JS.
    // Every visible layer matches its starting state at the loop boundary.
    const animation = Animated.loop(Animated.timing(progress, {
      toValue: 1,
      duration: motion.duration,
      easing: Easing.linear,
      useNativeDriver: Platform.OS !== 'web',
      isInteraction: false,
    }));
    animation.start();
    return () => animation.stop();
  }, [active, appState, motion, progress]);

  if (!active) {
    return <View testID="chat-status-inactive" style={styles.frame}><View style={[styles.dot, styles.inactive]} /></View>;
  }

  return (
    <View testID="chat-status-active" style={styles.frame}>
      {!reduceMotion ? (
        <>
          <Animated.View
            testID="chat-status-halo"
            style={[
              styles.halo,
              {
                opacity: progress.interpolate({ inputRange: motion.inputRange, outputRange: motion.haloOpacity }),
                transform: [{ scale: progress.interpolate({ inputRange: motion.inputRange, outputRange: motion.haloScale }) }],
              },
            ]}
          />
          <Animated.View
            testID="chat-status-ring"
            style={[
              styles.ring,
              {
                opacity: progress.interpolate({ inputRange: motion.inputRange, outputRange: motion.ringOpacity }),
                transform: [{ scale: progress.interpolate({ inputRange: motion.inputRange, outputRange: motion.ringScale }) }],
              },
            ]}
          />
        </>
      ) : null}
      <Animated.View
        testID="chat-status-active-dot"
        style={[
          styles.dot,
          styles.active,
          {
            opacity: progress.interpolate({ inputRange: motion.inputRange, outputRange: motion.dotOpacity }),
            transform: [{ scale: progress.interpolate({ inputRange: motion.inputRange, outputRange: motion.dotScale }) }],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 16, height: 16, borderRadius: 8 },
  active: { backgroundColor: '#FF3345' },
  inactive: { backgroundColor: '#737A80' },
  halo: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: '#FF3345' },
  ring: { position: 'absolute', width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: '#FF6875' },
});
