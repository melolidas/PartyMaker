import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, type NativeGesture } from 'react-native-gesture-handler';
import { Feather } from '@expo/vector-icons';
import type { ChatSummary } from '../../api/lobbyTypes';
import { Screen } from '../../components/Screen';
import { useI18n } from '../../i18n/LocalizationProvider';
import { colors } from '../../theme';
import { LobbyCategoryPlaceholder } from '../home/LiveLobbyCard';
import type { InboxState } from './liveChatInbox';

export function LiveChatsScreen({ state, active, onClose, onSelect, onRefresh, onMore, scrollGesture }: {
  state: InboxState; active: boolean; onClose: () => void; onSelect: (row: ChatSummary) => void;
  onRefresh: () => void; onMore: () => void; scrollGesture: NativeGesture;
}) {
  const { t, language } = useI18n();
  const busy = state.loading || state.loadingMore;
  return <Screen scroll={false}>
    <View style={styles.header}>
      <Pressable testID="inbox-back" accessibilityRole="button" accessibilityLabel={t('chats.back')} disabled={!active} onPress={onClose} style={styles.back}>
        <Feather name="chevron-left" size={25} color={colors.text} />
      </Pressable>
      <Text accessibilityRole="header" style={styles.title}>{t('chats.title')}</Text>
      <Pressable testID="inbox-refresh" accessibilityRole="button" disabled={!active || busy} onPress={onRefresh}><Text style={styles.link}>{t('lobbies.reload')}</Text></Pressable>
    </View>
    {state.loading ? <ActivityIndicator testID="inbox-loading" color={colors.text} /> : null}
    {state.error ? <View testID="inbox-error" style={styles.notice}>
      <Text style={styles.muted}>{t(state.error === 'page' ? 'inbox.pageError' : 'inbox.error')}</Text>
      <Pressable testID="inbox-retry" accessibilityRole="button" disabled={!active || busy} onPress={state.error === 'page' ? onMore : onRefresh}><Text style={styles.link}>{t('auth.retry')}</Text></Pressable>
    </View> : null}
    {!state.loading && !state.error && !state.items.length ? <Text testID="inbox-empty" style={styles.notice}>{t('inbox.empty')}</Text> : null}
    <GestureDetector gesture={scrollGesture} touchAction="pan-y">
      <FlatList testID="inbox-list" style={styles.list} contentContainerStyle={styles.content} data={state.items} keyExtractor={row => row.lobby.id}
        renderItem={({ item }) => <Pressable testID={`inbox-row-${item.lobby.id}`} accessibilityRole="button" accessibilityLabel={item.lobby.title}
          disabled={!active} tabIndex={active ? 0 : -1} onPress={() => onSelect(item)} style={styles.row}>
          <View style={styles.placeholder}><LobbyCategoryPlaceholder category={item.lobby.category} compact /></View>
          <View style={styles.body}>
            <Text numberOfLines={1} style={styles.rowTitle}>{item.lobby.title}</Text>
            <Text numberOfLines={2} style={styles.muted}>{item.lastMessage ? `${item.lastMessage.author.displayName}: ${item.lastMessage.preview}` : t('inbox.noMessages')}</Text>
            {item.lastMessage ? <Text style={styles.time}>{new Date(item.lastMessage.createdAt).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Text> : null}
          </View>
        </Pressable>}
        ListFooterComponent={state.nextCursor ? <Pressable testID="inbox-more" accessibilityRole="button" disabled={!active || busy} onPress={onMore} style={styles.notice}>
          {state.loadingMore ? <ActivityIndicator color={colors.text} /> : <Text style={styles.link}>{t('lobbies.loadMore')}</Text>}
        </Pressable> : null} />
    </GestureDetector>
  </Screen>;
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, margin: 18 }, title: { flex: 1, color: colors.text, fontSize: 26, fontWeight: '800' },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  link: { color: colors.text, paddingVertical: 10 }, list: { flex: 1 }, content: { paddingHorizontal: 18, paddingBottom: 32, gap: 10 },
  notice: { color: colors.muted, padding: 18 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13,
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 20 },
  placeholder: { width: 64, height: 84, borderRadius: 20, overflow: 'hidden' }, body: { flex: 1, gap: 5 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '700' }, muted: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  time: { color: colors.muted, fontSize: 10 },
});
