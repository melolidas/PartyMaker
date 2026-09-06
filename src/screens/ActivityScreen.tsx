import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { uuid } from 'expo-modules-core';
import { useAuth } from '../auth/AuthProvider';
import { Screen } from '../components/Screen';
import { ActivityStore, emptyActivity } from '../features/activity/activity';
import { LiveLobbyDetails } from '../features/home/LiveLobbyDetails';
import { AvatarImage } from '../features/profile/AvatarImage';
import { useI18n } from '../i18n/LocalizationProvider';
import { colors } from '../theme';

export function ActivityScreen() {
  const { t, language } = useI18n();
  const { lobbyApi, user, storageRecoveryRequired } = useAuth();
  const account = storageRecoveryRequired ? null : user?.id ?? null;
  const store = useMemo(() => new ActivityStore(lobbyApi), [lobbyApi]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [selection, setSelection] = useState<{ account: string; id: string } | null>(null);
  const activeSelection = useRef(selection); activeSelection.current = selection;
  useEffect(() => {
    setSelection(null); store.setAccount(account);
    return () => { activeSelection.current = null; store.setAccount(null); };
  }, [account, store]);
  const current = snapshot.account === account ? snapshot : emptyActivity(account);
  const busy = current.loading || current.loadingMore;
  const imageAttempt = useMemo(() => uuid.v4(), [account, current.imageRevision]);
  return <>
    <Screen>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>{t('nav.activity')}</Text>
        <Pressable testID="activity-refresh" accessibilityRole="button" disabled={!account || busy} onPress={() => void store.reload()}><Text style={styles.link}>{t('lobbies.reload')}</Text></Pressable>
      </View>
      <Text style={styles.hint}>{t('activity.history')}</Text>
      {current.loading ? <ActivityIndicator testID="activity-loading" color={colors.text} /> : null}
      {current.error ? <View testID="activity-error" style={styles.notice}>
        <Text style={styles.hint}>{t(current.error === 'page' ? 'activity.pageError' : 'activity.error')}</Text>
        <Pressable testID="activity-retry" accessibilityRole="button" disabled={!account || busy} onPress={() => void (current.error === 'page' ? store.loadMore() : store.reload())}><Text style={styles.link}>{t('auth.retry')}</Text></Pressable>
      </View> : null}
      {account && !current.loading && !current.error && !current.items.length ? <Text testID="activity-empty" style={styles.notice}>{t('activity.empty')}</Text> : null}
      {current.items.map(item => <View testID={`notification-${item.id}`} key={item.id} style={styles.row}>
        <AvatarImage avatar={item.actor?.avatar ?? null} size={43} reloadKey={imageAttempt} />
        <View style={styles.body}>
          <Text style={styles.message}>{t('activity.joinEvent')} <Text style={styles.user}>{item.actor?.displayName ?? t('activity.unknownActor')}</Text></Text>
          {item.actor ? <Text style={styles.hint}>@{item.actor.handle}</Text> : null}
          <Text style={styles.message}>{item.lobby?.title ?? t('activity.unavailableLobby')}</Text>
          <Text style={styles.hint}>{new Date(item.createdAt).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Text>
          {!item.readAt ? <Text testID={`unread-${item.id}`} style={styles.unread}>{t('activity.unread')}</Text> : <Text testID={`read-${item.id}`} style={styles.hint}>{t('activity.read')}</Text>}
          {current.readErrors[item.id] ? <Text testID={`read-error-${item.id}`} accessibilityLiveRegion="polite" style={styles.hint}>{t(current.readErrors[item.id] === 'unavailable' ? 'activity.unavailableNotification' : 'activity.readUnconfirmed')}</Text> : null}
          <View style={styles.actions}>
            {!item.readAt ? <Pressable testID={`mark-read-${item.id}`} accessibilityRole="button" disabled={!account || !!current.marking[item.id] || current.readErrors[item.id] === 'unavailable'} onPress={() => void store.markRead(item.id)}>
              {current.marking[item.id] ? <ActivityIndicator color={colors.text} /> : <Text style={styles.link}>{t(current.readErrors[item.id] ? 'activity.retryRead' : 'activity.markRead')}</Text>}
            </Pressable> : null}
            {item.lobby ? <Pressable testID={`notification-lobby-${item.id}`} accessibilityRole="button" disabled={!account}
              onPress={() => { if (account && item.lobby) setSelection({ account, id: item.lobby.id }); }}><Text style={styles.link}>{t('activity.openLobby')}</Text></Pressable> : null}
          </View>
        </View>
      </View>)}
      {current.nextCursor ? <Pressable testID="activity-more" accessibilityRole="button" disabled={!account || busy} onPress={() => void store.loadMore()}>
        {current.loadingMore ? <ActivityIndicator color={colors.text} /> : <Text style={styles.link}>{t('lobbies.loadMore')}</Text>}
      </Pressable> : null}
    </Screen>
    {account && selection?.account === account ? <LiveLobbyDetails key={`${account}:${selection.id}`} id={selection.id} onClose={() => {
      if (activeSelection.current !== selection) return;
      activeSelection.current = null; setSelection(null); void store.reload();
    }} /> : null}
  </>;
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.6 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18 }, notice: { color: colors.muted, paddingVertical: 18 },
  link: { color: colors.text, paddingVertical: 10, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  body: { flex: 1, gap: 5 }, message: { color: colors.text, fontSize: 13, lineHeight: 18 }, user: { fontWeight: '800' },
  unread: { color: colors.text, fontSize: 12, fontWeight: '700' }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
});
