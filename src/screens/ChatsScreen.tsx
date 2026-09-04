import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, type NativeGesture } from 'react-native-gesture-handler';
import { Feather } from '@expo/vector-icons';
import { photos } from '../assets';
import { Screen } from '../components/Screen';
import { ChatStatusDot } from '../features/chats/ChatStatusDot';
import { ChatStatus, getLobbyChatGroups, LobbyChat } from '../features/chats/lobbyChats';
import { useHomeExperience } from '../features/home/HomeExperienceProvider';
import { DemoLobby, getLobbyMembers, HomeSession } from '../features/home/lobbies';
import { useI18n } from '../i18n/LocalizationProvider';
import { colors } from '../theme';

type Props = { active?: boolean; onClose: () => void; onOpenChat: (lobby: DemoLobby) => void; scrollGesture: NativeGesture };

export function ChatsScreen({ active = true, onClose, scrollGesture, onOpenChat }: Props) {
  const { t } = useI18n();
  const { session } = useHomeExperience();
  const groups = getLobbyChatGroups(session);

  return (
    <Screen scroll={false}>
      <GestureDetector gesture={scrollGesture} touchAction="pan-y">
        <ScrollView
          testID="chats-scroll"
          style={styles.scroll}
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          directionalLockEnabled
          showsVerticalScrollIndicator={false}
        >
      <View testID="chats-screen">
        <View style={styles.header}>
          <Pressable
            testID="chats-back"
            accessibilityRole="button"
            accessibilityLabel={t('chats.back')}
            disabled={!active}
            tabIndex={active ? 0 : -1}
            onPress={onClose}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Feather name="chevron-left" size={25} color={colors.text} />
          </Pressable>
          <Text accessibilityRole="header" style={styles.title}>{t('chats.title')}</Text>
        </View>

        <View testID="chats-list" style={styles.groups}>
          <ChatSection active={active} status="active" chats={groups.active} session={session} onOpenChat={onOpenChat} />
          <ChatSection active={active} status="inactive" chats={groups.inactive} session={session} onOpenChat={onOpenChat} />
        </View>
      </View>
        </ScrollView>
      </GestureDetector>
    </Screen>
  );
}

function ChatSection({ active, status, chats, session, onOpenChat }: {
  active: boolean;
  status: ChatStatus;
  chats: readonly LobbyChat[];
  session: HomeSession;
  onOpenChat: Props['onOpenChat'];
}) {
  const { t } = useI18n();
  return (
    <View testID={`chats-${status}-section`}>
      <View
        accessibilityRole="header"
        accessibilityLabel={t(status === 'active' ? 'chats.active' : 'chats.inactive')}
        accessible
        style={styles.sectionMarker}
      >
        <ChatStatusDot status={status} />
      </View>
      <View style={styles.list}>
        {chats.map((chat) => <ChatRow key={chat.lobby.id} active={active} chat={chat} session={session} status={status} onOpenChat={onOpenChat} />)}
      </View>
    </View>
  );
}

function ChatRow({ active, chat, session, status, onOpenChat }: {
  active: boolean;
  chat: LobbyChat;
  session: HomeSession;
  status: ChatStatus;
  onOpenChat: Props['onOpenChat'];
}) {
  const { t } = useI18n();
  const { lobby } = chat;
  const place = lobby.placeKey ? t(lobby.placeKey) : lobby.place;
  const members = `${getLobbyMembers(lobby, session)} / ${lobby.capacity}`;
  const inactive = status === 'inactive';

  return (
    <Pressable
      testID={`chat-row-${lobby.id}`}
      accessibilityRole="button"
      accessibilityLabel={t(lobby.titleKey)}
      accessibilityHint={t('conversation.open')}
      disabled={!active}
      tabIndex={active ? 0 : -1}
      onPress={() => onOpenChat(lobby)}
      style={({ pressed }) => [styles.row, inactive && styles.inactiveRow, pressed && styles.pressed]}
    >
      <View style={styles.avatarWrap}>
        <Image source={photos[lobby.photo]} style={[styles.avatar, inactive && styles.inactiveAvatar]} accessible={false} />
      </View>
      <View style={styles.body}>
        <View style={styles.rowHeader}>
          <Text numberOfLines={1} style={[styles.chatTitle, inactive && styles.inactiveTitle]}>{t(lobby.titleKey)}</Text>
          {chat.timeKey ? <Text style={styles.time}>{t(chat.timeKey)}</Text> : null}
        </View>
        <Text numberOfLines={1} style={styles.preview}>{t(chat.previewKey)}</Text>
        <View style={styles.rowFooter}>
          <Text numberOfLines={1} style={styles.place}>{place}</Text>
          <View style={styles.members}>
            <Feather name="users" size={11} color={colors.muted} />
            <Text accessibilityLabel={`${t('home.participants')}: ${members}`} style={styles.memberCount}>{members}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  backButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: colors.white, fontSize: 26, lineHeight: 32, fontWeight: '800', letterSpacing: -0.7 },
  groups: { gap: 22 },
  sectionMarker: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  list: { gap: 10 },
  row: { minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  inactiveRow: { backgroundColor: '#0E1113', borderColor: colors.borderSoft },
  inactiveAvatar: { opacity: 0.55 },
  inactiveTitle: { color: '#A9AFB3' },
  avatarWrap: { width: 52, height: 52, flexShrink: 0 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surfaceRaised },
  body: { flex: 1, minWidth: 0, gap: 5 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatTitle: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  time: { flexShrink: 0, color: colors.muted, fontSize: 10, lineHeight: 15 },
  preview: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  rowFooter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  place: { flex: 1, color: colors.muted, fontSize: 10, lineHeight: 15 },
  members: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  memberCount: { color: colors.muted, fontSize: 10, lineHeight: 15, fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.7 },
});
