import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LobbyHistoryItem } from '../../api/lobbyTypes';
import { getLobbyInvalidation } from '../../api/lobbyInvalidation';
import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n/LocalizationProvider';
import { colors, radius } from '../../theme';
import { formatLobbyStartsAt } from '../home/lobbyFeed';
import { LobbyCategoryPlaceholder } from '../home/LiveLobbyCard';
import { emptyLobbyHistory, LobbyHistoryStore } from './lobbyHistory';

export function LobbyHistoryCard({ lobby }: { lobby: LobbyHistoryItem }) {
  const { t, language } = useI18n();
  return <View testID={`history-lobby-${lobby.id}`} style={styles.card}>
    <LobbyCategoryPlaceholder category={lobby.category} compact />
    <View style={styles.body}>
      <Text style={styles.title}>{lobby.title}</Text>
      <Text style={styles.text}>{lobby.description}</Text>
      <Text style={styles.muted}>{formatLobbyStartsAt(lobby, language) ?? t('lobbies.dateUnavailable')}</Text>
      <Text style={styles.text}>{lobby.isOnline ? t('home.online') : lobby.venueName ?? t('lobbies.venueUnavailable')}</Text>
      <Text style={styles.muted}>{t(lobby.isOrganizer ? 'history.organizer' : 'history.participant')}</Text>
    </View>
  </View>;
}

/** No nested vertical scroller: the existing Profile Screen owns scrolling. */
export function LobbyHistory() {
  const { lobbyApi, status, user, storageRecoveryRequired } = useAuth();
  const { t } = useI18n();
  const account = status === 'authenticated' && !storageRecoveryRequired ? user?.id ?? null : null;
  const store = useMemo(() => new LobbyHistoryStore(after => lobbyApi.listLobbyHistory(after)), [lobbyApi]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const currentAccount = useRef(account); currentAccount.current = account;
  useEffect(() => {
    store.setAccount(account);
    const unsubscribe = getLobbyInvalidation(lobbyApi).subscribe(() => { void store.reload(); });
    return () => { unsubscribe(); store.setAccount(null); };
  }, [account, lobbyApi, store]);
  const state = snapshot.account === account ? snapshot : emptyLobbyHistory(account);
  const current = () => !!account && currentAccount.current === account && store.getSnapshot().account === account;
  const reload = () => { if (current()) void store.reload(); };
  const more = () => { if (current()) void store.loadMore(); };
  return <View testID="profile-lobby-history" style={styles.list}>
    <Text accessibilityRole="header" style={styles.title}>{t('history.title')}</Text>
    <Text style={styles.muted}>{t('history.explanation')}</Text>
    <Pressable testID="history-refresh" accessibilityRole="button" disabled={!account || state.status === 'loading'} onPress={reload} style={styles.button}><Text style={styles.text}>{t('lobbies.reload')}</Text></Pressable>
    {state.status === 'loading' ? <View testID="history-loading"><ActivityIndicator color={colors.text} /><Text style={styles.muted}>{t('history.loading')}</Text></View> : null}
    {state.status === 'ready' && !state.items.length ? <Text testID="history-empty" style={styles.muted}>{t('history.empty')}</Text> : null}
    {state.items.map(lobby => <LobbyHistoryCard key={lobby.id} lobby={lobby} />)}
    {state.error ? <View testID="history-error" style={styles.body}>
      <Text accessibilityLiveRegion="polite" style={styles.muted}>{t(state.status === 'error' ? 'history.error' : 'history.pageError')}</Text>
      <Pressable testID="history-retry" accessibilityRole="button" onPress={state.status === 'error' ? reload : more} style={styles.button}><Text style={styles.text}>{t('auth.retry')}</Text></Pressable>
    </View> : null}
    {state.status === 'ready' && state.nextCursor && !state.error ? <Pressable testID="history-more" accessibilityRole="button" disabled={state.loadingMore} onPress={more} style={styles.button}>
      {state.loadingMore ? <ActivityIndicator color={colors.text} /> : <Text style={styles.text}>{t('lobbies.loadMore')}</Text>}
    </Pressable> : null}
  </View>;
}
const styles = StyleSheet.create({
  list: { gap: 14, marginVertical: 18, marginHorizontal: 6 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium, overflow: 'hidden', backgroundColor: colors.surface },
  body: { padding: 14, gap: 9 },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  text: { color: colors.text, fontSize: 14, lineHeight: 20 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  button: { padding: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium },
});
