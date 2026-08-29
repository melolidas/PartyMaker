import { ReactNode } from 'react';
import {
  Image,
  ImageSourcePropType,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius } from '../theme';

type PillProps = {
  children: ReactNode;
  active?: boolean;
  onPress?: () => void;
};

export function Pill({ children, active = false, onPress }: PillProps) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, active && styles.pillActive]}>
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{children}</Text>
    </Pressable>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? <Text style={styles.sectionAction}>{action}</Text> : null}
    </View>
  );
}

type AvatarProps = {
  image?: ImageSourcePropType;
  label?: string;
  size?: number;
};

export function Avatar({ image, label = 'K', size = 38 }: AvatarProps) {
  if (image) {
    return <Image source={image} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }

  return (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarLabel, { fontSize: size * 0.38 }]}>{label}</Text>
    </View>
  );
}

export function IconButton({
  name,
  onPress,
  size = 20,
  style,
}: {
  name: React.ComponentProps<typeof Feather>['name'];
  onPress?: () => void;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.iconButton, style]}>
      <Feather name={name} size={size} color={colors.text} />
    </Pressable>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 34,
    paddingHorizontal: 13,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  pillActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  pillText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '500',
  },
  pillTextActive: {
    color: colors.black,
    fontWeight: '700',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 13,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  sectionAction: {
    color: colors.text,
    fontSize: 13,
  },
  avatarFallback: {
    backgroundColor: '#2B3033',
    borderWidth: 1,
    borderColor: '#454B4F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLabel: {
    color: colors.text,
    fontWeight: '800',
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
});
