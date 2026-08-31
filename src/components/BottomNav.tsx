import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useNavPulse } from '../navigation/useNavPulse';
import { easeNavMotion, getNavScrollAnimation, navLayout, navMotion } from '../navigation/navMotion';
import { colors } from '../theme';
import { RouteName } from '../types';
import { GlassNavSurface } from './GlassNavSurface';
import { NavPressGlint } from './NavPressGlint';
import { NavActiveIndicator } from './NavActiveIndicator';

type NavItem = {
  route: RouteName;
  label: string;
  icon: React.ComponentProps<typeof Feather>['name'];
};

type Props = {
  active: RouteName;
  compact: boolean;
  onChange: (route: RouteName) => void;
};

const items: NavItem[] = [
  { route: 'home', label: 'Home', icon: 'home' },
  { route: 'moments', label: 'Moments', icon: 'image' },
  { route: 'create', label: 'Create lobby', icon: 'plus' },
  { route: 'activity', label: 'Activity', icon: 'bell' },
  { route: 'profile', label: 'Profile', icon: 'user' },
];

export function BottomNav({ active, compact, onChange }: Props) {
  const scrollProgress = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  const [reduceTransparency, setReduceTransparency] = useState(false);
  const [navWidth, setNavWidth] = useState(0);
  const [indicatorRoute, setIndicatorRoute] = useState(active);
  const [glint, setGlint] = useState({ trigger: 0, index: 0 });
  const { progress: pressProgress, pulse } = useNavPulse(reduceMotion);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    }).catch(() => {});
    const motionSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);

    // React Native Web does not implement the transparency accessibility API.
    const transparencySubscription = Platform.OS === 'ios'
      ? AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduceTransparency)
      : undefined;
    if (Platform.OS === 'ios') {
      AccessibilityInfo.isReduceTransparencyEnabled().then((enabled) => {
        if (mounted) setReduceTransparency(enabled);
      }).catch(() => {});
    }

    return () => {
      mounted = false;
      motionSubscription?.remove();
      transparencySubscription?.remove();
    };
  }, []);

  useEffect(() => {
    // Spread the size change across the full duration, with gentle start/end.
    const animation = Animated.timing(scrollProgress, {
      ...getNavScrollAnimation(compact, reduceMotion),
      easing: easeNavMotion,
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [compact, reduceMotion, scrollProgress]);

  useEffect(() => setIndicatorRoute(active), [active]);

  const selectTab = (next: RouteName) => {
    setIndicatorRoute(next);
    setGlint((previous) => ({
      trigger: previous.trigger + 1,
      index: items.findIndex((item) => item.route === next),
    }));
    if (next === 'create') {
      // This route hides the nav: finish its feedback before unmounting it.
      pulse(() => onChange(next));
    } else {
      pulse();
      onChange(next);
    }
  };

  return (
    <View style={styles.wrapper}>
      <Animated.View
        testID="bottom-nav-scroll"
        style={[
          styles.frame,
          {
            transform: [
              { translateY: scrollProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 2] }) },
              { scale: scrollProgress.interpolate({ inputRange: [0, 1], outputRange: [1, navMotion.compactScale] }) },
            ],
          },
        ]}
      >
        <Animated.View
          testID="bottom-nav"
          onLayout={(event) => setNavWidth(event.nativeEvent.layout.width)}
          style={[
            styles.nav,
            {
              transform: [
                { scaleX: pressProgress.interpolate({ inputRange: [0, 1], outputRange: [1, navMotion.pressScaleX] }) },
                { scaleY: pressProgress.interpolate({ inputRange: [0, 1], outputRange: [1, navMotion.pressScaleY] }) },
              ],
            },
          ]}
        >
          <GlassNavSurface reduceTransparency={reduceTransparency} />
          <NavActiveIndicator
            index={items.findIndex((item) => item.route === indicatorRoute)}
            width={navWidth}
            reduceMotion={reduceMotion}
          />
          {items.map((item) => (
            <NavButton
              key={item.route}
              item={item}
              selected={active === item.route}
              onChange={selectTab}
            />
          ))}
          {/* A separate foreground layer: button fills cannot hide the light. */}
          <NavPressGlint
            trigger={glint.trigger}
            originX={navLayout.horizontalPadding + ((navWidth - navLayout.horizontalPadding * 2) / items.length) * (glint.index + 0.5)}
            width={navWidth}
            reduceMotion={reduceMotion}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function NavButton({
  item,
  selected,
  onChange,
}: {
  item: NavItem;
  selected: boolean;
  onChange: Props['onChange'];
}) {
  const create = item.route === 'create';
  const iconColor = create ? colors.black : selected ? colors.white : '#B8BFC6';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityState={{ selected }}
      onPress={() => onChange(item.route)}
      style={styles.item}
    >
      <View
        testID={`nav-icon-${item.route}`}
        style={[
          styles.iconWrap,
          create && styles.createButton,
        ]}
      >
        {item.route === 'moments' ? (
          <Ionicons name="images-outline" size={27} color={iconColor} />
        ) : (
          <Feather name={item.icon} size={create ? 30 : 27} color={iconColor} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    pointerEvents: 'box-none',
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 16,
    paddingHorizontal: 22,
    alignItems: 'center',
  },
  frame: {
    width: '100%',
    maxWidth: 400,
    height: 64,
  },
  nav: {
    width: '100%',
    height: '100%',
    paddingHorizontal: navLayout.horizontalPadding,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    ...Platform.select({
      web: { boxShadow: '0 8px 28px rgba(0, 0, 0, 0.4)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.32,
        shadowRadius: 20,
        elevation: 12,
      },
    }),
  },
  item: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  iconWrap: {
    width: '100%',
    maxWidth: 62,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F1F3F5',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
  },
});
