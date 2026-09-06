import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../../i18n/LocalizationProvider';
import { colors } from '../../theme';
import { formatCountdown, getRemainingSeconds } from './countdown';
import { useHomeClock } from './HomeExperienceProvider';

export function LobbyCountdown({ startsAt, testID }: { startsAt: number; testID?: string }) {
  const { t } = useI18n();
  const remaining = getRemainingSeconds(startsAt, useHomeClock());
  return (
    <View style={styles.row}>
      <Feather name="clock" size={12} color={colors.muted} />
      <Text testID={testID} style={styles.text}>
        {remaining > 0 ? `${t('home.startsIn')} ${formatCountdown(remaining)}` : t('home.started')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  text: { flexShrink: 1, color: colors.muted, fontSize: 11, lineHeight: 16, fontVariant: ['tabular-nums'] },
});
