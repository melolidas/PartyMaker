import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Lobby, LobbyCategory } from '../../api/lobbyTypes';
import { useI18n } from '../../i18n/LocalizationProvider';
import type { TranslationKey } from '../../i18n/translations';
import { colors, radius } from '../../theme';
import { ExtroversionGauge } from '../profile/ExtroversionGauge';
import { LobbyCountdown } from './LobbyCountdown';
import { formatLobbyStartsAt } from './lobbyFeed';

const categories: Record<LobbyCategory, { label: TranslationKey; icon: keyof typeof Feather.glyphMap }> = {
  DRINKS: { label: 'category.drinks', icon: 'coffee' },
  GAMING: { label: 'category.gaming', icon: 'monitor' },
  FOOD: { label: 'category.food', icon: 'coffee' },
  SPORT: { label: 'category.sport', icon: 'activity' },
  MOVIES: { label: 'category.movies', icon: 'film' },
  OUTDOORS: { label: 'category.outdoors', icon: 'map' },
};

export function LobbyCategoryPlaceholder({ category, compact = false }: { category: LobbyCategory; compact?: boolean }) {
  const { t } = useI18n();
  const info = categories[category];
  return <View testID="lobby-category-placeholder" style={[styles.placeholder, compact && styles.compactPlaceholder]}>
    <Feather name={info.icon} color={colors.muted} size={26} />
    <Text style={styles.category}>{t(info.label)}</Text>
  </View>;
}

export function LiveLobbyMetadata({ lobby }: { lobby: Lobby }) {
  const { t, language } = useI18n();
  return <View style={styles.metadata}>
    <Text style={styles.muted}>{lobby.isOnline ? t('home.online') : lobby.venueName || t('lobbies.venueUnavailable')}</Text>
    <Text style={styles.muted}>{formatLobbyStartsAt(lobby, language) ?? t('lobbies.dateUnavailable')}</Text>
    <LobbyCountdown startsAt={Date.parse(lobby.startsAt)} testID={`live-countdown-${lobby.id}`} />
    <View style={styles.footer}>
      {lobby.isJoined ? <Text style={styles.joined}>{t('home.joined')}</Text> : null}
      <Text style={styles.muted}>{t('home.participants')}: {lobby.joinedCount} / {lobby.capacity}</Text>
    </View>
  </View>;
}

export function LiveLobbyCard({ lobby, onPress, compact = false }: { lobby: Lobby; onPress: () => void; compact?: boolean }) {
  const { t } = useI18n();
  return <Pressable testID={`live-lobby-${lobby.id}`} accessibilityRole="button" accessibilityLabel={lobby.title} accessibilityHint={t('lobbies.readOnly')} onPress={onPress} style={({ pressed }) => [styles.card, compact && styles.compactCard, pressed && styles.pressed]}>
    <LobbyCategoryPlaceholder category={lobby.category} compact={compact} />
    <View style={styles.body}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{lobby.title}</Text>
        {lobby.groupExtroversionLevel !== null ? <ExtroversionGauge size={32} level={lobby.groupExtroversionLevel} accessibilityLabel={`${t('home.groupExtroversion')}: ${lobby.groupExtroversionLevel}`} /> : null}
      </View>
      <LiveLobbyMetadata lobby={lobby} />
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  compactCard: { width: 174, flexDirection: 'column' },
  compactPlaceholder: { width: '100%', height: 84, minHeight: 84 },
  card: { flexDirection: 'row', borderRadius: radius.medium, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.surface, overflow: 'hidden' },
  placeholder: { width: 92, minHeight: 100, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 8 },
  category: { color: colors.muted, fontSize: 10, textAlign: 'center' },
  body: { flex: 1, padding: 12, gap: 5 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  metadata: { gap: 6 },
  muted: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  joined: { color: colors.success, fontSize: 11 },
  pressed: { opacity: 0.72 },
});
