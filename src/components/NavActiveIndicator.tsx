import { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet } from 'react-native';
import { easeNavMotion, getNavItemLayout, navLayout, navMotion } from '../navigation/navMotion';

type Props = {
  index: number;
  width: number;
  reduceMotion: boolean;
};

/** One persistent pill travels through every slot; individual buttons have no fill. */
export function NavActiveIndicator({ index, width, reduceMotion }: Props) {
  const position = useRef(new Animated.Value(index)).current;
  const { slotWidth, indicatorWidth, indicatorLeft } = getNavItemLayout(width);

  useEffect(() => {
    const animation = Animated.timing(position, {
      toValue: index,
      duration: reduceMotion ? navMotion.reducedLayoutDuration : navMotion.selectionDuration,
      easing: easeNavMotion,
      useNativeDriver: Platform.OS !== 'web',
    });
    // Do not reset the starting position: rapid taps redirect the moving pill.
    animation.start();
    return () => animation.stop();
  }, [index, position, reduceMotion]);

  return (
    <Animated.View
      testID="nav-active-indicator"
      style={[
        styles.indicator,
        {
          left: indicatorLeft,
          width: indicatorWidth,
          opacity: width > 0 ? 1 : 0,
          transform: [{ translateX: Animated.multiply(position, slotWidth) }],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  indicator: {
    pointerEvents: 'none',
    position: 'absolute',
    top: 6,
    height: navLayout.indicatorHeight,
    borderRadius: navLayout.indicatorHeight / 2,
    backgroundColor: '#383C3F',
  },
});
