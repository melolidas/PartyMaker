import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { getNavGlintLayout, navMotion } from '../navigation/navMotion';

type Props = {
  trigger: number;
  originX: number;
  width: number;
  reduceMotion: boolean;
};

/** A brief circular glint radiates from the icon, clipped to the whole capsule. */
export function NavPressGlint({ trigger, originX, width, reduceMotion }: Props) {
  const progress = useRef(new Animated.Value(1)).current;
  const lastTrigger = useRef(0);
  const { radius, diameter, left, top } = getNavGlintLayout(originX, width);

  useEffect(() => {
    if (trigger === 0 || width === 0 || lastTrigger.current === trigger) {
      progress.setValue(1);
      return;
    }

    // Relayout/accessibility changes may stop a wash, but must not replay a tap.
    lastTrigger.current = trigger;
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: reduceMotion ? navMotion.reducedFeedbackDuration : navMotion.glintDuration,
      easing: Easing.linear,
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion, trigger, width]);

  return (
    <View testID="nav-press-overlay" collapsable={false} style={styles.clip}>
      <Animated.View
        testID="nav-press-glint-surface"
        style={[
          styles.ripple,
          {
            left,
            top,
            width: diameter,
            height: diameter,
            borderRadius: radius,
            opacity: progress.interpolate({
              inputRange: [0, 0.1, 0.25, navMotion.glintFillAt, 1],
              outputRange: [0, 1, 0.9, 0.55, 0],
            }),
            // Uniform scale sends the light up, down and sideways from the same
            // point. It fades immediately after the initial flash, with no hold.
            transform: reduceMotion ? [] : [
              {
                scale: progress.interpolate({
                  inputRange: [0, navMotion.glintFillAt, 1],
                  outputRange: [0, 1, 1],
                  extrapolate: 'clamp',
                }),
              },
            ],
          },
        ]}
      >
        <LinearGradient
          colors={[
            'rgba(248,252,255,0.34)',
            'rgba(232,244,255,0.18)',
            'rgba(237,248,255,0.22)',
            'rgba(255,255,255,0.36)',
          ]}
          locations={[0, 0.32, 0.78, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {!reduceMotion && <View style={[styles.fronts, { borderRadius: radius }]} />}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    ...StyleSheet.absoluteFill,
    pointerEvents: 'none',
    overflow: 'hidden',
    borderRadius: 999,
    zIndex: 2,
  },
  ripple: {
    position: 'absolute',
    overflow: 'hidden',
  },
  fronts: {
    ...StyleSheet.absoluteFill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
  },
});
