import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LobbyScope } from '../../api/lobbyTypes';
import { getLobbyInvalidation } from '../../api/lobbyInvalidation';
import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n/LocalizationProvider';
import { colors, radius } from '../../theme';
import { emptyLobbyFeed, LobbyFeedStore } from './lobbyFeed';
import { LiveLobbyCard } from './LiveLobbyCard';

type Props = {
  onSelect: (id: string) => void;
  scope?: LobbyScope;
  compact?: boolean;
  onViewAll?: () => void;
  onCreate?: () => void;
};

export function LiveLobbyFeed({ onSelect, scope = 'all', compact = false, onViewAll, onCreate }: Props) {
  const { lobbyApi, user, status, storageRecoveryRequired } = useAuth();
  const { t } = useI18n();
  const account = status === 'authenticated' && !storageRecoveryRequired ? user?.id ?? null : null;
  // Each mounted list owns its pages, errors and request generation, even with the same ApiClient.
  const store = useMemo(() => new LobbyFeedStore((after) => lobbyApi.listLobbies(after, scope)), [lobbyApi, scope]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    const unsubscribe = getLobbyInvalidation(lobbyApi).subscribe(() => { void store.reload(); });
    store.setAccount(account);
    return () => { unsubscribe(); store.setAccount(null); };
  }, [store, account, lobbyApi]);
  // Do not show even one render of the previous account while effects clean up.
  const state = snapshot.account === account ? snapshot : emptyLobbyFeed(account);
  const idPrefix = scope === 'mine' ? 'mine-lobbies' : 'lobbies';
  const cards = state.items.map((lobby) => <LiveLobbyCard key={lobby.id} lobby={lobby} compact={compact} onPress={() => onSelect(lobby.id)} />);

  return (
    <View testID={scope === 'mine' ? 'live-mine-feed' : 'live-lobby-feed'} style={styles.list}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>{t(scope === 'mine' ? 'home.yourLobbies' : 'lobbies.upcoming')}</Text>
        {onViewAll ? <Pressable testID="view-all-your-lobbies" accessibilityRole="button" accessibilityLabel={t('yourLobbies.open')} onPress={onViewAll}><Text style={styles.muted}>{t('common.viewAll')}</Text></Pressable> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={t('lobbies.reload')} disabled={!account || state.status === 'loading' || state.loadingMore} onPress={() => void store.reload()}>
          <Text style={styles.muted}>{t('lobbies.reload')}</Text>
        </Pressable>
      </View>
      {scope === 'mine' ? <Text style={styles.muted}>{t('lobbies.mineUpcoming')}</Text> : null}
      {state.status === 'loading' ? <View testID={`${idPrefix}-loading`} style={styles.message}><ActivityIndicator color={colors.text} /><Text style={styles.muted}>{t('lobbies.loading')}</Text></View> : null}
      {state.status === 'ready' && state.items.length === 0 ? <View testID={`${idPrefix}-empty`}>
        <Text style={styles.messageText}>{t(scope === 'mine' ? 'lobbies.mineEmpty' : 'lobbies.empty')}</Text>
        {scope === 'mine' && onCreate ? <Pressable testID="mine-create-lobby" accessibilityRole="button" onPress={onCreate} style={styles.button}><Text style={styles.buttonText}>{t('nav.create')}</Text></Pressable> : null}
      </View> : null}
      {compact ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontal}>{cards}</ScrollView> : cards}
      {state.error ? <View testID={`${idPrefix}-error`} style={styles.message}>
        <Text accessibilityLiveRegion="polite" style={styles.messageText}>{t('lobbies.loadError')}</Text>
        <Pressable accessibilityRole="button" onPress={() => void (state.status === 'error' ? store.reload() : store.loadMore())} style={styles.button}><Text style={styles.buttonText}>{t('auth.retry')}</Text></Pressable>
      </View> : null}
      {state.status === 'ready' && state.nextCursor && !state.error ? <Pressable testID={`${idPrefix}-load-more`} accessibilityRole="button" disabled={state.loadingMore} onPress={() => void store.loadMore()} style={styles.button}>
        {state.loadingMore ? <ActivityIndicator color={colors.text} /> : <Text style={styles.buttonText}>{t('lobbies.loadMore')}</Text>}
      </Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  horizontal: { gap: 10 },
  list: { gap: 12, marginTop: 18, marginBottom: 24 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, color: colors.text, fontSize: 20, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 12 },
  message: { alignItems: 'center', gap: 12, paddingVertical: 18 },
  messageText: { color: colors.muted, fontSize: 14, lineHeight: 21, paddingVertical: 12 },
  button: { alignItems: 'center', padding: 14, borderRadius: radius.medium, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.surface },
  buttonText: { color: colors.text, fontWeight: '600' },
});
