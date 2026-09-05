import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n/LocalizationProvider';
import { colors, radius } from '../../theme';
import { emptyLobbyFeed, LobbyFeedStore } from './lobbyFeed';
import { LiveLobbyCard } from './LiveLobbyCard';

export function LiveLobbyFeed({ onSelect }: { onSelect: (id: string) => void }) {
  const { lobbyApi, user, status, storageRecoveryRequired } = useAuth();
  const { t } = useI18n();
  const account = status === 'authenticated' && !storageRecoveryRequired ? user?.id ?? null : null;
  const store = useMemo(() => new LobbyFeedStore((after) => lobbyApi.listLobbies(after)), [lobbyApi]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    store.setAccount(account);
    return () => store.setAccount(null);
  }, [store, account]);
  // Do not show even one render of the previous account while effects clean up.
  const state = snapshot.account === account ? snapshot : emptyLobbyFeed(account);

  return (
    <View testID="live-lobby-feed" style={styles.list}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>{t('lobbies.upcoming')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('lobbies.reload')} disabled={!account || state.status === 'loading' || state.loadingMore} onPress={() => void store.reload()}>
          <Text style={styles.muted}>{t('lobbies.reload')}</Text>
        </Pressable>
      </View>
      {state.status === 'loading' ? <View testID="lobbies-loading" style={styles.message}><ActivityIndicator color={colors.text} /><Text style={styles.muted}>{t('lobbies.loading')}</Text></View> : null}
      {state.status === 'ready' && state.items.length === 0 ? <Text testID="lobbies-empty" style={styles.messageText}>{t('lobbies.empty')}</Text> : null}
      {state.items.map((lobby) => <LiveLobbyCard key={lobby.id} lobby={lobby} onPress={() => onSelect(lobby.id)} />)}
      {state.error ? <View testID="lobbies-error" style={styles.message}>
        <Text accessibilityLiveRegion="polite" style={styles.messageText}>{t('lobbies.loadError')}</Text>
        <Pressable accessibilityRole="button" onPress={() => void (state.status === 'error' ? store.reload() : store.loadMore())} style={styles.button}><Text style={styles.buttonText}>{t('auth.retry')}</Text></Pressable>
      </View> : null}
      {state.status === 'ready' && state.nextCursor && !state.error ? <Pressable testID="lobbies-load-more" accessibilityRole="button" disabled={state.loadingMore} onPress={() => void store.loadMore()} style={styles.button}>
        {state.loadingMore ? <ActivityIndicator color={colors.text} /> : <Text style={styles.buttonText}>{t('lobbies.loadMore')}</Text>}
      </Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12, marginTop: 18, marginBottom: 24 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, color: colors.text, fontSize: 20, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 12 },
  message: { alignItems: 'center', gap: 12, paddingVertical: 18 },
  messageText: { color: colors.muted, fontSize: 14, lineHeight: 21, paddingVertical: 12 },
  button: { alignItems: 'center', padding: 14, borderRadius: radius.medium, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.surface },
  buttonText: { color: colors.text, fontWeight: '600' },
});
