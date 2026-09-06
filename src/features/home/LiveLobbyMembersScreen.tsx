import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { uuid } from 'expo-modules-core';
import { getLobbyInvalidation } from '../../api/lobbyInvalidation';
import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n/LocalizationProvider';
import { colors, radius } from '../../theme';
import { AvatarImage } from '../profile/AvatarImage';
import { emptyMembers, LobbyMembersStore } from './lobbyMembers';

/** Page content only: the caller owns the existing details Modal. */
export function LiveLobbyMembersScreen({ lobbyId, onBack, onAccessLost }: {
  lobbyId: string; onBack: () => void; onAccessLost: () => void;
}) {
  const { lobbyApi, user, storageRecoveryRequired } = useAuth();
  const { t } = useI18n();
  const account = storageRecoveryRequired ? null : user?.id ?? null;
  const store = useMemo(() => new LobbyMembersStore((id, after) => lobbyApi.listLobbyMembers(id, after)), [lobbyApi]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const accessLost = useRef(onAccessLost); accessLost.current = onAccessLost;
  useEffect(() => {
    const unsubscribe = getLobbyInvalidation(lobbyApi).subscribe(store.invalidate);
    store.setContext(account, lobbyId);
    return () => { unsubscribe(); store.setContext(null, lobbyId); };
  }, [store, lobbyApi, account, lobbyId]);
  const current = snapshot.account === account && snapshot.id === lobbyId ? snapshot : emptyMembers(account, lobbyId);
  useEffect(() => {
    // Recheck details directly; never emit another invalidation/reload cycle.
    if (account && current.error === 'access') accessLost.current();
  }, [account, current.error]);
  const busy = current.loading || current.loadingMore;
  // Context stays local. Public image URLs contain only an opaque retry attempt.
  const imageAttempt = useMemo(() => uuid.v4(), [account, lobbyId, current.imageRevision]);
  const back = () => { store.setContext(null, lobbyId); onBack(); };
  return <View testID="members-screen" style={styles.page}>
    <View style={styles.header}>
      <Pressable testID="members-back" accessibilityRole="button" onPress={back}><Text style={styles.link}>{t('liveChat.back')}</Text></Pressable>
      <Text accessibilityRole="header" style={styles.title}>{t('members.title')}</Text>
    </View>
    <Pressable testID="members-refresh" accessibilityRole="button" disabled={!account || busy} onPress={() => void store.reload()}>
      <Text style={styles.link}>{t('lobbies.reload')}</Text>
    </Pressable>
    {current.loading ? <ActivityIndicator testID="members-loading" color={colors.text} /> : null}
    {current.error ? <View testID="members-error" style={styles.notice}>
      <Text style={styles.muted}>{t(current.error === 'access' ? 'members.accessLost' : current.error === 'page' ? 'members.pageError' : 'members.error')}</Text>
      <Pressable testID="members-retry" accessibilityRole="button" disabled={!account || busy} onPress={() => void (current.error === 'page' ? store.loadMore() : store.reload())}>
        <Text style={styles.link}>{t('auth.retry')}</Text>
      </Pressable>
    </View> : null}
    {account && !current.loading && !current.error && !current.items.length ? <Text testID="members-empty" style={styles.muted}>{t('members.empty')}</Text> : null}
    <FlatList testID="members-list" style={styles.list} contentContainerStyle={styles.content} data={current.items} keyExtractor={row => row.user.id}
      renderItem={({ item }) => <View testID={`member-${item.user.id}`} style={styles.row}>
        <AvatarImage avatar={item.user.avatar} size={48} reloadKey={imageAttempt} />
        <View style={styles.body}>
          <Text style={styles.name}>{item.user.displayName}</Text>
          <Text style={styles.muted}>@{item.user.handle}</Text>
          <View style={styles.badges}>
            {item.isOrganizer ? <Text style={styles.badge}>{t('members.organizer')}</Text> : null}
            {item.user.id === account ? <Text style={styles.badge}>{t('members.you')}</Text> : null}
          </View>
        </View>
      </View>}
      ListFooterComponent={current.nextCursor ? <Pressable testID="members-more" accessibilityRole="button" disabled={busy} onPress={() => void store.loadMore()}>
        {current.loadingMore ? <ActivityIndicator color={colors.text} /> : <Text style={styles.link}>{t('lobbies.loadMore')}</Text>}
      </Pressable> : null} />
  </View>;
}
const styles = StyleSheet.create({
  page: { flex: 1, gap: 12 }, header: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  title: { flex: 1, color: colors.text, fontSize: 22, fontWeight: '700' }, link: { color: colors.text, paddingVertical: 10 },
  list: { flex: 1 }, content: { gap: 12, paddingBottom: 20 }, notice: { gap: 8 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 12, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border },
  body: { flex: 1, gap: 4 }, name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 }, badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badge: { color: colors.text, fontSize: 12 },
});
