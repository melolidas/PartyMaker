import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { uuid } from 'expo-modules-core';
import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n/LocalizationProvider';
import { getLobbyInvalidation } from '../../api/lobbyInvalidation';
import { colors, radius } from '../../theme';
import { emptyLiveChat, LiveLobbyChatStore, validMessageBody } from './liveLobbyChat';

/** Rendered INSIDE the existing details Modal, not a new native modal. */
export function LiveLobbyChatScreen({ lobbyId, title, onBack, onAccessLost }: {
  lobbyId: string; title: string; onBack: () => void; onAccessLost: () => void;
}) {
  const { lobbyApi, user, storageRecoveryRequired } = useAuth();
  const { t, language } = useI18n();
  const account = storageRecoveryRequired ? null : user?.id ?? null;
  const lost = useRef(onAccessLost); lost.current = onAccessLost;
  const store = useMemo(() => new LiveLobbyChatStore(lobbyApi, () => uuid.v4(), () => lost.current()), [lobbyApi]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    store.setContext(account, lobbyId);
    const unsubscribe = getLobbyInvalidation(lobbyApi).subscribe(store.invalidate);
    return () => { unsubscribe(); store.setContext(null, lobbyId); };
  }, [store, account, lobbyId, lobbyApi]);
  const current = snapshot.account === account && snapshot.lobbyId === lobbyId ? snapshot : emptyLiveChat(account, lobbyId);
  const sendDisabled = !account || !current.loaded || current.loading || current.blocked || current.sending || !!current.pending || !validMessageBody(current.draft);
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.header}>
      <Pressable testID="live-chat-back" accessibilityRole="button" onPress={onBack}><Text style={styles.link}>{t('liveChat.back')}</Text></Pressable>
      <Text accessibilityRole="header" style={styles.title} numberOfLines={2}>{title}</Text>
    </View>
    <Text style={styles.muted}>{t('liveChat.manual')}</Text>
    {!current.blocked ? <Pressable testID="live-chat-refresh" accessibilityRole="button" disabled={current.loading || !account} onPress={() => void store.reload()}>
      <Text style={styles.link}>{t('lobbies.reload')}</Text>
    </Pressable> : null}
    {current.loading ? <ActivityIndicator testID="live-chat-loading" color={colors.text} /> : null}
    {current.error ? <View testID="live-chat-error" accessibilityLiveRegion="polite">
      <Text style={styles.muted}>{t(current.error)}</Text>
      {!current.blocked ? <Pressable testID="live-chat-retry" accessibilityRole="button" disabled={current.loading || current.loadingOlder}
        onPress={() => void (current.error === 'liveChat.olderError' ? store.loadOlder() : store.reload())}><Text style={styles.link}>{t('auth.retry')}</Text></Pressable> : null}
    </View> : null}
    {current.loaded && !current.loading && !current.error && !current.items.length ? <Text testID="live-chat-empty" style={styles.muted}>{t('liveChat.empty')}</Text> : null}
    <FlatList testID="live-chat-history" style={styles.history} contentContainerStyle={styles.messages} data={current.items} keyExtractor={item => item.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={current.nextCursor && !current.blocked ? <Pressable testID="live-chat-older" accessibilityRole="button"
        disabled={current.loading || current.loadingOlder} onPress={() => void store.loadOlder()}>
        {current.loadingOlder ? <ActivityIndicator color={colors.text} /> : <Text style={styles.link}>{t('liveChat.older')}</Text>}
      </Pressable> : null}
      renderItem={({ item }) => <View style={[styles.bubble, item.author.id === account && styles.own]}>
        <Text style={styles.author}>{item.author.displayName} · @{item.author.handle}</Text>
        <Text testID="live-chat-message-body" selectable style={styles.body}>{item.body}</Text>
        <Text style={styles.time}>{new Date(item.createdAt).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Text>
      </View>} />
    {current.sendError ? <View testID="live-chat-send-error" accessibilityLiveRegion="polite">
      <Text style={styles.muted}>{t(current.sendError)}</Text>
      {current.pending ? <>
        <Text style={styles.muted} numberOfLines={2}>{t('liveChat.retryText')}: {current.pending.input.body}</Text>
        <View style={styles.header}>
          <Pressable testID="live-chat-send-retry" accessibilityRole="button" disabled={current.sending || current.loading} onPress={() => void store.retrySend()}><Text style={styles.link}>{t('liveChat.retrySend')}</Text></Pressable>
          <Pressable testID="live-chat-discard-retry" accessibilityRole="button" disabled={current.sending} onPress={store.discardRetry}><Text style={styles.muted}>{t('liveChat.discardRetry')}</Text></Pressable>
        </View>
      </> : null}
    </View> : null}
    {!current.blocked ? <View style={styles.composer}>
      <TextInput testID="live-chat-draft" accessibilityLabel={t('liveChat.message')} placeholder={t('liveChat.message')} placeholderTextColor={colors.muted}
        style={styles.input} multiline value={current.draft} onChangeText={store.setDraft} editable={!!account} />
      <Pressable testID="live-chat-send" accessibilityRole="button" accessibilityLabel={t('liveChat.send')}
        accessibilityState={{ disabled: sendDisabled, busy: current.sending }} disabled={sendDisabled} onPress={() => void store.send()} style={sendDisabled && styles.dimmed}>
        {current.sending ? <ActivityIndicator testID="live-chat-sending" color={colors.text} /> : <Text style={styles.link}>{t('liveChat.send')}</Text>}
      </Pressable>
    </View> : null}
    {!validMessageBody(current.draft) && current.draft.trim() ? <Text style={styles.muted}>{t('liveChat.invalidBody')}</Text> : null}
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, gap: 8 }, header: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  title: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '600' }, link: { color: colors.text, paddingVertical: 10, fontSize: 14 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 18 }, history: { flex: 1 }, messages: { gap: 12, paddingVertical: 12 },
  bubble: { alignSelf: 'flex-start', maxWidth: '92%', backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium, padding: 12, gap: 6 },
  own: { alignSelf: 'flex-end', backgroundColor: 'rgba(255,255,255,0.08)' }, author: { color: colors.muted, fontSize: 11 },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 }, time: { color: colors.muted, fontSize: 10, alignSelf: 'flex-end' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderColor: colors.border, paddingTop: 10 },
  input: { flex: 1, minHeight: 44, maxHeight: 100, color: colors.text, backgroundColor: colors.background, borderRadius: radius.medium, padding: 12, fontSize: 15 },
  dimmed: { opacity: 0.45 },
});
