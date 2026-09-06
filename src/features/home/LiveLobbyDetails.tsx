import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getLobbyInvalidation } from '../../api/lobbyInvalidation';
import { emptyLobbyDetails, LobbyDetailsStore, membershipAction } from './lobbyDetails';
import { ApiClientError } from '../../api/errors';
import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n/LocalizationProvider';
import { colors, radius } from '../../theme';
import { LiveLobbyMetadata, LobbyCategoryPlaceholder } from './LiveLobbyCard';
import { useHomeClock } from './HomeExperienceProvider';
import { LiveLobbyChatScreen } from '../chats/LiveLobbyChatScreen';
import { LiveLobbyMembersScreen } from './LiveLobbyMembersScreen';

export function LiveLobbyDetails({ id, onClose, onCancelled }: { id: string; onClose: () => void; onCancelled?: () => void }) {
  const { lobbyApi, user, storageRecoveryRequired } = useAuth();
  const { t } = useI18n();
  const now = useHomeClock();
  const account = storageRecoveryRequired ? null : user?.id ?? null;
  const [chat, setChat] = useState<{ account: string; id: string; title: string } | null>(null);
  const chatOpen = !!account && chat?.account === account && chat.id === id;
  const [members, setMembers] = useState<{ account: string; id: string } | null>(null);
  const membersOpen = !!account && members?.account === account && members.id === id;
  const store = useMemo(() => new LobbyDetailsStore(lobbyApi), [lobbyApi]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const notified = useRef(false);
  useEffect(() => {
    const unsubscribe = getLobbyInvalidation(lobbyApi).subscribe(() => { void store.reload(); });
    store.setContext(account, id);
    notified.current = false;
    setChat(null);
    setMembers(null);
    return () => { unsubscribe(); store.setContext(null, id); };
  }, [store, lobbyApi, account, id]);
  const current = snapshot.account === account && snapshot.id === id ? snapshot : emptyLobbyDetails(account, id);
  useEffect(() => {
    if (account && current.cancelled && !notified.current) {
      notified.current = true; onCancelled?.(); onClose();
    }
  }, [account, current.cancelled, onCancelled, onClose]);
  const lobby = current.lobby;
  const intent = lobby ? membershipAction(lobby, now) : null;
  const busy = current.loading || current.mutating;
  const backToDetails = () => { setChat(null); setMembers(null); void store.reload(); };
  return <Modal visible transparent animationType="fade" onRequestClose={chatOpen || membersOpen ? backToDetails : onClose}>
    <View style={styles.overlay}>
      <View style={[styles.sheet, (chatOpen || membersOpen) && styles.chatSheet]}>
        {membersOpen ? <LiveLobbyMembersScreen lobbyId={id} onBack={backToDetails} onAccessLost={() => void store.reload()} />
          : chatOpen ? <LiveLobbyChatScreen lobbyId={id} title={chat.title} onBack={backToDetails} onAccessLost={() => void store.reload()} /> : <>
        <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>{current.cancelTarget?.title ?? lobby?.title ?? t('lobbies.details')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose}><Text style={styles.close}>{t('common.close')}</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {current.cancelTarget ? <View testID="cancel-confirmation" style={styles.content}>
            <Text style={styles.description}>{t('cancel.warning')}</Text>
            {current.cancelError ? <Text testID="cancel-error" accessibilityLiveRegion="polite" style={styles.muted}>{t(current.cancelError)}</Text> : null}
            {current.cancelPhase === 'confirm' && lobby && Date.parse(lobby.startsAt) <= now ? <Text testID="cancel-started" style={styles.muted}>{t('cancel.started')}</Text> : null}
            {current.cancelPhase === 'confirm' ? <Pressable testID="cancel-decline" accessibilityRole="button" disabled={current.mutating} onPress={store.declineCancel} style={styles.action}>
              <Text style={styles.close}>{t('cancel.decline')}</Text>
            </Pressable> : null}
            <Pressable testID="cancel-confirm" accessibilityRole="button"
              disabled={current.mutating || (current.cancelPhase === 'confirm' && (!lobby || Date.parse(lobby.startsAt) <= now))}
              onPress={() => void store.confirmCancel()} style={styles.action}>
              {current.mutating ? <ActivityIndicator testID="cancel-busy" color={colors.text} /> : <Text style={styles.close}>{t(current.cancelPhase === 'retry' ? 'cancel.retry' : 'cancel.action')}</Text>}
            </Pressable>
          </View> : null}
          {current.loading && !lobby ? <ActivityIndicator testID="lobby-details-loading" color={colors.text} /> : null}
          {current.error ? <View testID="lobby-details-error" style={styles.content}>
            <Text style={styles.muted}>{t(current.error instanceof ApiClientError && current.error.code === 'LOBBY_NOT_FOUND' ? 'lobbies.notFound' : 'lobbies.loadError')}</Text>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void store.reload()}><Text style={styles.close}>{t('auth.retry')}</Text></Pressable>
          </View> : null}
          {lobby && !current.cancelTarget && !current.cancelled ? <>
            <LobbyCategoryPlaceholder category={lobby.category} />
            <LiveLobbyMetadata lobby={lobby} />
            <Text testID="live-lobby-description" style={styles.description}>{lobby.description}</Text>
            {intent?.reason ? <Text testID="membership-reason" style={styles.muted}>{t(intent.reason)}</Text> : null}
            {current.actionError ? <Text testID="membership-error" accessibilityLiveRegion="polite" style={styles.muted}>{t(current.actionError)}</Text> : null}
            <Pressable testID="membership-action" disabled={busy || !!current.error || !intent?.action} accessibilityRole="button"
              accessibilityState={{ disabled: busy || !!current.error || !intent?.action, busy }}
              onPress={() => void store.changeMembership()} style={[styles.action, (busy || !!current.error || !intent?.action) && styles.dimmed]}>
              {current.mutating ? <ActivityIndicator color={colors.text} /> : <Text style={styles.close}>{t(intent?.label ?? 'membership.unavailable')}</Text>}
            </Pressable>
            <Pressable testID="membership-refresh" disabled={busy} accessibilityRole="button" onPress={() => void store.reload()}>
              <Text style={styles.close}>{t(current.loading ? 'membership.checking' : 'lobbies.reload')}</Text>
            </Pressable>
            {lobby.isOrganizer ? <>
              <Pressable testID="cancel-open" accessibilityRole="button" disabled={busy || !!current.error || Date.parse(lobby.startsAt) <= now}
                onPress={store.requestCancel} style={[styles.action, Date.parse(lobby.startsAt) <= now && styles.dimmed]}>
                <Text style={styles.close}>{t('cancel.action')}</Text>
              </Pressable>
              {Date.parse(lobby.startsAt) <= now ? <Text testID="cancel-started" style={styles.muted}>{t('cancel.started')}</Text> : null}
            </> : null}
            <Pressable testID="members-open" disabled={busy || !!current.error || !account || lobby.membershipStatus !== 'JOINED'} accessibilityRole="button"
              onPress={account && !busy && !current.error && lobby.membershipStatus === 'JOINED' ? () => setMembers({ account, id }) : undefined} style={styles.action}>
              <Text style={styles.close}>{t('members.title')}</Text>
            </Pressable>
            {lobby.membershipStatus !== 'JOINED' ? <Text testID="members-join-first" style={styles.muted}>{t('members.joinFirst')}</Text> : null}
            <Pressable testID="live-chat-open" disabled={busy || !!current.error || !account || lobby.membershipStatus !== 'JOINED'} accessibilityRole="button"
              accessibilityState={{ disabled: busy || !!current.error || !account || lobby.membershipStatus !== 'JOINED' }} style={styles.action}
              onPress={account && !busy && !current.error && lobby.membershipStatus === 'JOINED' ? () => setChat({ account, id, title: lobby.title }) : undefined}>
              <Text style={styles.close}>{t(lobby.membershipStatus === 'JOINED' ? 'liveChat.open' : 'liveChat.joinFirst')}</Text>
            </Pressable>
          </> : null}
        </ScrollView>
        </>}
      </View>
    </View>
  </Modal>;
}

/** Non-modal receipt on the source screen, shown only after the cancel POST confirms. */
export function CancelledLobbyNotice({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useI18n();
  return <View testID="cancel-success" accessibilityLiveRegion="polite" style={styles.notice}>
    <Text style={styles.description}>{t('cancel.success')}</Text>
    <Pressable accessibilityRole="button" onPress={onDismiss}><Text style={styles.close}>{t('common.close')}</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  notice: { padding: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium },
  overlay: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.75)' },
  sheet: { maxHeight: '85%', width: '100%', maxWidth: 520, alignSelf: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.large, padding: 20 },
  chatSheet: { height: '85%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  title: { flex: 1, color: colors.text, fontSize: 22, fontWeight: '700' },
  close: { color: colors.text, fontSize: 13, paddingVertical: 10 },
  content: { gap: 16 },
  description: { color: colors.text, fontSize: 15, lineHeight: 23 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  dimmed: { opacity: 0.6 },
  action: { padding: 3, alignItems: 'center', borderColor: colors.border, borderWidth: 1, borderRadius: radius.medium },
  disabled: { opacity: 0.6, padding: 13, alignItems: 'center', borderColor: colors.border, borderWidth: 1, borderRadius: radius.medium },
});
