import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { MasqueradeMask } from '../../components/icons/MasqueradeMask';
import { colors } from '../../theme';

export function RoleTile({ label, onPress, add = false, disabled = false, testID }: {
  label: string; onPress?: () => void; add?: boolean; disabled?: boolean; testID?: string;
}) {
  const content = <>
    <View style={styles.circle}>{add ? <Feather name="plus" size={30} color="#FFFFFF" /> : <MasqueradeMask />}</View>
    {label ? <Text style={styles.label}>{label}</Text> : null}
  </>;
  return onPress ? <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[styles.tile, disabled && styles.disabled]}>
    {content}
  </Pressable> : <View testID={testID} style={styles.tile}>{content}</View>;
}
export function RoleBadge({ name }: { name?: string }) {
  return name ? <View testID="lobby-role-badge" style={styles.badge}><MasqueradeMask size={16} /><Text style={styles.badgeText}>{name}</Text></View> : null;
}
const styles = StyleSheet.create({
  tile: { width: 88, alignItems: 'center', gap: 6 },
  circle: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  label: { color: colors.text, fontSize: 12, lineHeight: 17, textAlign: 'center', flexShrink: 1, alignSelf: 'stretch' },
  disabled: { opacity: 0.5 }, badge: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  badgeText: { color: colors.text, fontSize: 11, flexShrink: 1 },
});
