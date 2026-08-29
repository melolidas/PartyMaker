import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, shadows } from '../theme';
import { RouteName } from '../types';

type IconName = React.ComponentProps<typeof Feather>['name'];

type Props = {
  active: RouteName;
  onChange: (route: RouteName) => void;
};

const items: { route: RouteName; label: string; icon: IconName }[] = [
  { route: 'home', label: 'Home', icon: 'home' },
  { route: 'moments', label: 'Moments', icon: 'camera' },
  { route: 'create', label: '', icon: 'plus' },
  { route: 'activity', label: 'Activity', icon: 'bell' },
  { route: 'profile', label: 'Profile', icon: 'user' },
];

export function BottomNav({ active, onChange }: Props) {
  return (
    <View style={styles.wrapper}>
      <View style={styles.nav}>
        {items.map((item) => {
          const selected = active === item.route;
          const create = item.route === 'create';
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={create ? 'Create lobby' : item.label}
              key={item.route}
              onPress={() => onChange(item.route)}
              style={[styles.item, create && styles.createSlot]}
            >
              <View style={create ? styles.createButton : undefined}>
                <Feather
                  name={item.icon}
                  size={create ? 29 : 21}
                  color={create ? colors.black : selected ? colors.white : colors.muted}
                  strokeWidth={create ? 1.6 : selected ? 2.3 : 1.7}
                />
              </View>
              {!create ? (
                <Text style={[styles.label, selected && styles.labelActive]}>{item.label}</Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingBottom: 9,
  },
  nav: {
    height: 72,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(13, 16, 17, 0.97)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    ...shadows.soft,
  },
  item: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  createSlot: {
    justifyContent: 'flex-start',
    paddingTop: 8,
  },
  createButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '500',
  },
  labelActive: {
    color: colors.white,
    fontWeight: '700',
  },
});
