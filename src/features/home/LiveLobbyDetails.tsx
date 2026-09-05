import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getLobbyInvalidation } from '../../api/lobbyInvalidation';
import { emptyLobbyDetails, LobbyDetailsStore, membershipAction } from './lobbyDetails';
import { ApiClientError } from '../../api/errors';
import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n/LocalizationProvider';
import { colors, radius } from '../../theme';
import { LiveLobbyMetadata, LobbyCategoryPlaceholder } from './LiveLobbyCard';

export function LiveLobbyDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const { lobbyApi, user, storageRecoveryRequired } = useAuth();
  const { t } = useI18n();
  const account = storageRecoveryRequired ? null : user?.id ?? null;
  const store = useMemo(() => new LobbyDetailsStore(lobbyApi), [lobbyApi]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    const unsubscribe = getLobbyInvalidation(lobbyApi).subscribe(() => { void store.reload(); });
    store.setContext(account, id);
    return () => { unsubscribe(); store.setContext(null, id); };
  }, [store, lobbyApi, account, id]);
  const current = snapshot.account === account && snapshot.id === id ? snapshot : emptyLobbyDetails(account, id);
  const lobby = current.lobby;
  const intent = lobby ? membershipAction(lobby) : null;
  const busy = current.loading || current.mutating;
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <View style={styles.sheet}>
        <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>{lobby?.title ?? t('lobbies.details')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose}><Text style={styles.close}>{t('common.close')}</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {current.loading && !lobby ? <ActivityIndicator testID="lobby-details-loading" color={colors.text} /> : null}
          {current.error ? <View testID="lobby-details-error" style={styles.content}>
            <Text style={styles.muted}>{t(current.error instanceof ApiClientError && current.error.code === 'LOBBY_NOT_FOUND' ? 'lobbies.notFound' : 'lobbies.loadError')}</Text>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void store.reload()}><Text style={styles.close}>{t('auth.retry')}</Text></Pressable>
          </View> : null}
          {lobby ? <>
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
            <Pressable disabled accessibilityRole="button" accessibilityState={{ disabled: true }} style={styles.disabled}><Text style={styles.muted}>{t('lobbies.chatUnavailable')}</Text></Pressable>
          </> : null}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.75)' },
  sheet: { maxHeight: '85%', width: '100%', maxWidth: 520, alignSelf: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.large, padding: 20 },
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
