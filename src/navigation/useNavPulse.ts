import { useCallback, useEffect, useRef } from 'react';
import { Animated, Platform } from 'react-native';
import { easeNavMotion, navMotion } from './navMotion';

/** A full, visible inflate/hold/deflate cycle, independent of scroll motion. */
export function useNavPulse(reduceMotion: boolean) {
  const progress = useRef(new Animated.Value(0)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);

  const pulse = useCallback((onComplete?: () => void) => {
    animation.current?.stop();
    if (reduceMotion) {
      progress.setValue(0);
      onComplete?.();
      return;
    }

    // Repeated taps continue from the current size instead of snapping to zero.
    animation.current = Animated.sequence([
      Animated.timing(progress, {
        toValue: 1,
        duration: navMotion.pressInDuration,
        easing: easeNavMotion,
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.delay(navMotion.pressHoldDuration),
      Animated.timing(progress, {
        toValue: 0,
        duration: navMotion.pressOutDuration,
        easing: easeNavMotion,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]);
    animation.current.start(({ finished }) => {
      // Interrupted taps must not trigger an outdated navigation callback.
      if (finished) onComplete?.();
    });
  }, [progress, reduceMotion]);

  useEffect(() => {
    if (reduceMotion) {
      animation.current?.stop();
      progress.setValue(0);
    }
    return () => animation.current?.stop();
  }, [progress, reduceMotion]);

  return { progress, pulse };
}
