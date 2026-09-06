import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getLobbyInvalidation } from '../../api/lobbyInvalidation';
import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n/LocalizationProvider';
import { colors, radius } from '../../theme';
import { emptyLobbyFeed, LobbyFeedStore } from './lobbyFeed';
import { LiveLobbyCard } from './LiveLobbyCard';

export function LobbyRecommendations({ onSelect }: { onSelect: (id: string) => void }) {
  const { lobbyApi, user, status, storageRecoveryRequired } = useAuth();
  const { t } = useI18n();
  const account = status === 'authenticated' && !storageRecoveryRequired ? user?.id ?? null : null;
  // Reuse request-generation protection, but never share pages/state with all or mine.
  // Recommendations are a bounded, unpaginated response, not a filtered catalog page.
  const store = useMemo(() => new LobbyFeedStore(async () => ({
    ...await lobbyApi.listLobbyRecommendations(), nextCursor: null,
  })), [lobbyApi]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    const unsubscribe = getLobbyInvalidation(lobbyApi).subscribe(() => { void store.reload(); });
    store.setAccount(account);
    return () => { unsubscribe(); store.setAccount(null); };
  }, [store, account, lobbyApi]);
  const state = snapshot.account === account ? snapshot : emptyLobbyFeed(account);
  return <View testID="lobby-recommendations" style={styles.section}>
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={styles.title}>{t('recommendations.title')}</Text>
      <Pressable testID="recommendations-refresh" accessibilityRole="button" accessibilityLabel={t('recommendations.refresh')}
        disabled={!account || state.status === 'loading'} onPress={() => void store.reload()}>
        <Text style={styles.note}>{t('lobbies.reload')}</Text>
      </Pressable>
    </View>
    <Text style={styles.note}>{t('recommendations.explanation')}</Text>
    {state.status === 'loading' ? <View testID="recommendations-loading" style={styles.message}>
      <ActivityIndicator color={colors.text} /><Text style={styles.note}>{t('lobbies.loading')}</Text>
    </View> : null}
    {state.status === 'ready' && !state.items.length ? <Text testID="recommendations-empty" style={styles.note}>{t('recommendations.empty')}</Text> : null}
    {state.status === 'error' ? <View testID="recommendations-error" style={styles.message}>
      <Text accessibilityLiveRegion="polite" style={styles.note}>{t('recommendations.error')}</Text>
      <Pressable testID="recommendations-retry" accessibilityRole="button" onPress={() => void store.reload()} style={styles.button}>
        <Text style={styles.buttonText}>{t('auth.retry')}</Text>
      </Pressable>
    </View> : null}
    {state.items.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards}>
      {state.items.map(lobby => <LiveLobbyCard key={lobby.id} lobby={lobby} compact onPress={() => onSelect(lobby.id)} />)}
    </ScrollView> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, marginTop: 18, marginBottom: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, color: colors.text, fontSize: 20, fontWeight: '700' },
  note: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  message: { alignItems: 'center', gap: 12, paddingVertical: 12 },
  cards: { gap: 10 },
  button: { padding: 14, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  buttonText: { color: colors.text, fontWeight: '600' },
});
