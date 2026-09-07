import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { getLobbyInvalidation } from '../../api/lobbyInvalidation';
import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n/LocalizationProvider';
import { colors, radius } from '../../theme';
import { emptyHomeFeed, HomeFeedStore, type HomeFeedTab } from './homeFeed';
import { LiveLobbyCard } from './LiveLobbyCard';

export function HomeLobbyFeed({ onSelect }: { onSelect: (id: string) => void }) {
  const { lobbyApi, user, status, storageRecoveryRequired } = useAuth();
  const { t } = useI18n();
  const [tab, setTab] = useState<HomeFeedTab>('recommended');
  const account = status === 'authenticated' && !storageRecoveryRequired ? user?.id ?? null : null;
  // Separate stores; leaving a tab invalidates that opening. Mine is a stable sibling.
  const stores = useMemo(() => ({ recommended: new HomeFeedStore(lobbyApi, 'recommended'), all: new HomeFeedStore(lobbyApi, 'all') }), [lobbyApi]);
  const store = stores[tab];
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    const unsubscribe = getLobbyInvalidation(lobbyApi).subscribe(() => { void store.reload(); });
    store.setAccount(account);
    return () => { unsubscribe(); store.setAccount(null); };
  }, [store, account, lobbyApi]);
  const state = snapshot.account === account ? snapshot : emptyHomeFeed(account);
  return <View testID="home-feed" style={styles.section}>
    <View testID="home-feed-tabs" style={styles.heading}>
      <View style={styles.tabs}>
        {(['recommended', 'all'] as const).map(value => <Pressable key={value} testID={`home-tab-${value}`} accessibilityRole="tab"
          accessibilityState={{ selected: tab === value }} aria-selected={tab === value}
          onPress={() => { if (tab !== value) { store.setAccount(null); setTab(value); } }} style={styles.tab}>
          <Text style={[styles.tabText, tab === value && styles.selectedText]}>{t(value === 'recommended' ? 'home.recommendedTab' : 'home.allTab')}</Text>
          <View style={[styles.underline, tab === value && styles.selectedLine]} />
        </Pressable>)}
      </View>
      <Pressable testID="home-feed-refresh" accessibilityRole="button" accessibilityLabel={t('home.refreshFeed')}
        disabled={!account || state.status === 'loading'} onPress={() => void store.reload()} style={styles.refresh}>
        <Feather name="refresh-cw" size={18} color={colors.muted} />
      </Pressable>
    </View>
    {state.status === 'loading' ? <View testID="home-feed-loading" style={styles.message}><ActivityIndicator color={colors.text} /></View> : null}
    {state.status === 'ready' && !state.items.length ? <Text testID="home-feed-empty" style={styles.note}>{t('home.feedEmpty')}</Text> : null}
    {state.items.map(lobby => <LiveLobbyCard key={lobby.id} lobby={lobby} onPress={() => onSelect(lobby.id)} />)}
    {state.error ? <View testID="home-feed-error" style={styles.message}>
      <Text accessibilityLiveRegion="polite" style={styles.note}>{t(state.status === 'ready' ? 'home.feedPageError' : 'home.feedError')}</Text>
      <Pressable testID="home-feed-retry" accessibilityRole="button" onPress={() => void (state.status === 'error' ? store.reload() : store.loadMore())} style={styles.button}>
        <Text style={styles.buttonText}>{t('home.feedRetry')}</Text>
      </Pressable>
    </View> : null}
    {state.status === 'ready' && state.nextCursor && !state.error ? <Pressable testID="home-feed-more" accessibilityRole="button" disabled={state.loadingMore}
      onPress={() => void store.loadMore()} style={styles.button}>
      {state.loadingMore ? <ActivityIndicator color={colors.text} /> : <Text style={styles.buttonText}>{t('lobbies.loadMore')}</Text>}
    </Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, marginBottom: 24 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tabs: { flexDirection: 'row', alignItems: 'center', gap: 16, flex: 1 },
  tab: { paddingVertical: 10, alignItems: 'center', flexShrink: 1 },
  tabText: { color: colors.muted, fontSize: 16, fontWeight: '600' },
  selectedText: { color: colors.text },
  underline: { width: 22, height: 2, marginTop: 6, borderRadius: 1 },
  selectedLine: { backgroundColor: colors.text },
  refresh: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  note: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  message: { alignItems: 'center', gap: 12, paddingVertical: 12 },
  button: { padding: 14, alignItems: 'center', borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  buttonText: { color: colors.text, fontWeight: '600' },
});
