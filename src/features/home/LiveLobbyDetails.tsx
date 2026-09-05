import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Lobby } from '../../api/lobbyTypes';
import { ApiClientError } from '../../api/errors';
import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n/LocalizationProvider';
import { colors, radius } from '../../theme';
import { LiveLobbyMetadata, LobbyCategoryPlaceholder } from './LiveLobbyCard';

export function LiveLobbyDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const { lobbyApi, user, storageRecoveryRequired } = useAuth();
  const { t } = useI18n();
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ account: string; id: string; lobby?: Lobby; error?: unknown } | null>(null);
  const account = storageRecoveryRequired ? null : user?.id;
  useEffect(() => {
    let active = true;
    setResult(null);
    if (account) void lobbyApi.getLobby(id).then(
      (lobby) => { if (active) setResult({ account, id, lobby }); },
      (error: unknown) => { if (active) setResult({ account, id, error }); },
    );
    return () => { active = false; };
  }, [lobbyApi, account, id, retry]);
  const current = account && result?.account === account && result.id === id ? result : null;
  const lobby = current?.lobby;
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <View style={styles.sheet}>
        <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>{lobby?.title ?? t('lobbies.details')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose}><Text style={styles.close}>{t('common.close')}</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {!current ? <ActivityIndicator testID="lobby-details-loading" color={colors.text} /> : null}
          {current?.error ? <View testID="lobby-details-error" style={styles.content}>
            <Text style={styles.muted}>{t(current.error instanceof ApiClientError && current.error.code === 'LOBBY_NOT_FOUND' ? 'lobbies.notFound' : 'lobbies.loadError')}</Text>
            <Pressable accessibilityRole="button" onPress={() => setRetry((value) => value + 1)}><Text style={styles.close}>{t('auth.retry')}</Text></Pressable>
          </View> : null}
          {lobby ? <>
            <LobbyCategoryPlaceholder category={lobby.category} />
            <LiveLobbyMetadata lobby={lobby} />
            <Text testID="live-lobby-description" style={styles.description}>{lobby.description}</Text>
            <Text style={styles.muted}>{t('lobbies.readOnly')}</Text>
            <Pressable disabled accessibilityRole="button" accessibilityState={{ disabled: true }} style={styles.disabled}><Text style={styles.muted}>{t('lobbies.joinUnavailable')}</Text></Pressable>
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
  disabled: { opacity: 0.6, padding: 13, alignItems: 'center', borderColor: colors.border, borderWidth: 1, borderRadius: radius.medium },
});
