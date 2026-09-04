import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { GestureDetector, NativeGesture } from 'react-native-gesture-handler';
import { photos } from '../assets';
import { Screen } from '../components/Screen';
import { useMockChat } from '../features/chats/MockChatProvider';
import {
  ConversationAuthor,
  getMockConversation,
  MAX_MOCK_MESSAGE_LENGTH,
  MockConversationMessage,
} from '../features/chats/mockConversation';
import { useHomeExperience } from '../features/home/HomeExperienceProvider';
import { DemoLobby, getLobbyMembers } from '../features/home/lobbies';
import { useI18n } from '../i18n/LocalizationProvider';
import { TranslationKey } from '../i18n/translations';
import { colors } from '../theme';

type Props = {
  lobby: DemoLobby;
  onBack: () => void;
  backLabel?: string;
  scrollGesture?: NativeGesture;
};

const authorKeys: Record<ConversationAuthor, TranslationKey> = {
  alex: 'conversation.author.alex',
  john: 'conversation.author.john',
  marina: 'conversation.author.marina',
  kate: 'conversation.author.kate',
  you: 'conversation.author.you',
};

const authorColors: Record<ConversationAuthor, string> = {
  alex: '#B5C9BE',
  john: '#A9BFD0',
  marina: '#D4BFAF',
  kate: '#BCB5D2',
  you: colors.text,
};

export function LobbyChatScreen({ lobby, onBack, backLabel, scrollGesture }: Props) {
  const { t } = useI18n();
  const { session } = useHomeExperience();
  const { draft, messages: localMessages, setDraft, sendMessage } = useMockChat(lobby.id);
  const list = useRef<FlatList<MockConversationMessage>>(null);
  const stickToBottom = useRef(true);
  const revealSentMessage = useRef(false);
  const contentHeightBeforeSend = useRef(0);
  const listMeasurements = useRef({ contentHeight: 0, viewportHeight: 0 });
  const scrollFrame = useRef<number | null>(null);
  const fixtureMessages = useMemo(() => getMockConversation(lobby), [lobby.id, lobby.category]);
  const messages = useMemo(() => [...fixtureMessages, ...localMessages], [fixtureMessages, localMessages]);
  const canSend = draft.trim().length > 0;
  const archived = lobby.id.startsWith('inactive-');
  const place = lobby.placeKey ? t(lobby.placeKey) : lobby.place;
  const archivedDate = lobby.id === 'inactive-hike' ? t('chats.lastWeek') : t('common.yesterday');
  const members = getLobbyMembers(lobby, session);

  const scrollToMeasuredBottom = useCallback(() => {
    if (!stickToBottom.current && !revealSentMessage.current) return;
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      if (!stickToBottom.current && !revealSentMessage.current) return;
      const { contentHeight, viewportHeight } = listMeasurements.current;
      if (viewportHeight <= 0) return;
      // FlatList.scrollToEnd can still use stale cell frames just after a send.
      // Native layout measurements include the new bubble and bottom padding.
      list.current?.scrollToOffset({ offset: Math.max(0, contentHeight - viewportHeight), animated: false });
      // Clearing the composer can resize the viewport before the new message
      // is measured. Keep the send intent until content has actually grown.
      if (contentHeight > contentHeightBeforeSend.current) revealSentMessage.current = false;
    });
  }, []);

  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', scrollToMeasuredBottom);
    return () => {
      subscription.remove();
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    };
  }, [scrollToMeasuredBottom]);

  useEffect(() => {
    if (revealSentMessage.current) scrollToMeasuredBottom();
  }, [localMessages.length, scrollToMeasuredBottom]);

  const handleBack = () => {
    Keyboard.dismiss();
    onBack();
  };
  const handleSend = () => {
    if (!canSend) return;
    stickToBottom.current = true;
    contentHeightBeforeSend.current = listMeasurements.current.contentHeight;
    revealSentMessage.current = true;
    sendMessage();
    AccessibilityInfo.announceForAccessibility(t('conversation.sentLocally'));
  };

  const messageList = (
    <FlatList
      ref={list}
      testID="conversation-messages"
      data={messages}
      keyExtractor={(message) => message.id}
      style={styles.messages}
      contentContainerStyle={styles.messageContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      onScroll={({ nativeEvent }) => {
        // Content growth may emit a scroll event before our scheduled offset.
        // It must not cancel the intent to reveal the message just added.
        if (scrollFrame.current === null && !revealSentMessage.current) {
          stickToBottom.current = nativeEvent.contentSize.height - nativeEvent.contentOffset.y - nativeEvent.layoutMeasurement.height < 80;
        }
      }}
      onScrollBeginDrag={() => {
        // Explicit scrolling takes priority over automatic follow-to-bottom.
        revealSentMessage.current = false;
        if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
        scrollFrame.current = null;
      }}
      scrollEventThrottle={16}
      onContentSizeChange={(_width, height) => {
        listMeasurements.current.contentHeight = height;
        scrollToMeasuredBottom();
      }}
      onLayout={({ nativeEvent }) => {
        listMeasurements.current.viewportHeight = nativeEvent.layout.height;
        scrollToMeasuredBottom();
      }}
      ListHeaderComponent={<ConversationDivider text={t('conversation.sampleMessages')} />}
      renderItem={({ item, index }) => (
        <View>
          {index === fixtureMessages.length ? <ConversationDivider text={t('conversation.localMessages')} /> : null}
          <MessageBubble message={item} />
        </View>
      )}
    />
  );

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView
        testID="lobby-chat-screen"
        behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}
        style={styles.page}
      >
        <View style={styles.header}>
          <Pressable
            testID="conversation-back"
            accessibilityRole="button"
            accessibilityLabel={backLabel ?? t('conversation.backToChats')}
            onPress={handleBack}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Feather name="chevron-left" size={25} color={colors.text} />
          </Pressable>
          <Image source={photos[lobby.photo]} style={styles.headerAvatar} accessible={false} />
          <View style={styles.headerText}>
            <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>{t(lobby.titleKey)}</Text>
            <Text style={styles.subtitle}>{t('home.participants')}: {members}</Text>
          </View>
          <View style={styles.demoBadge}>
            <Text style={styles.demoBadgeText}>{t('conversation.demoTag')}</Text>
          </View>
        </View>

        <View style={styles.contextWrap}>
          <View testID="conversation-context" style={styles.contextCard}>
            <Image source={photos[lobby.photo]} style={styles.contextPhoto} accessible={false} />
            <View style={styles.contextText}>
              <View style={styles.contextEyebrowRow}>
                <Text style={styles.contextEyebrow}>{t(archived ? 'conversation.archive' : 'conversation.plan')}</Text>
              </View>
              <Text style={styles.contextPlace} numberOfLines={1}>{place || t(lobby.titleKey)}</Text>
              <Text style={styles.contextMeta} numberOfLines={2}>{archived ? archivedDate : t(lobby.metaKey)}</Text>
            </View>
            <Feather name={archived ? 'archive' : 'map-pin'} size={17} color={colors.subtle} />
          </View>
        </View>

        {scrollGesture ? <GestureDetector gesture={scrollGesture} touchAction="pan-y">{messageList}</GestureDetector> : messageList}

        <View style={styles.composerArea}>
          <View style={styles.composer}>
            <TextInput
              testID="conversation-input"
              accessibilityLabel={t('conversation.messageInput')}
              accessibilityHint={t('conversation.demoNote')}
              placeholder={t('conversation.placeholder')}
              placeholderTextColor={colors.muted}
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={MAX_MOCK_MESSAGE_LENGTH}
              selectionColor="#BCCDC3"
              textAlignVertical="top"
              style={styles.input}
            />
            <Pressable
              testID="conversation-send"
              accessibilityRole="button"
              accessibilityLabel={t('conversation.send')}
              accessibilityState={{ disabled: !canSend }}
              disabled={!canSend}
              onPress={handleSend}
              style={({ pressed }) => [styles.sendButton, canSend && styles.sendButtonReady, pressed && styles.pressed]}
            >
              <Feather name="arrow-up" size={22} color={canSend ? colors.black : colors.subtle} />
            </Pressable>
          </View>
          <View style={styles.demoNoteRow}>
            <Feather name="info" size={10} color={colors.muted} />
            <Text style={styles.demoNote}>{t('conversation.demoNote')}</Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function ConversationDivider({ text }: { text: string }) {
  return (
    <View style={styles.divider}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerText}>{text}</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

function MessageBubble({ message }: { message: MockConversationMessage }) {
  const { t, language } = useI18n();
  const mine = message.author === 'you';
  const author = t(authorKeys[message.author]);
  const text = message.kind === 'fixture' ? t(message.textKey) : message.text;
  const time = message.kind === 'fixture' ? message.time : new Date(message.createdAt).toLocaleTimeString(language === 'ru' ? 'ru-RU' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <View testID={`conversation-message-${message.id}`} style={[styles.messageRow, mine && styles.myMessageRow]}>
      {!mine ? (
        <View style={styles.authorAvatar} accessible={false}>
          <Text style={[styles.authorInitial, { color: authorColors[message.author] }]}>{author.slice(0, 1)}</Text>
        </View>
      ) : null}
      <View
        accessible
        accessibilityLabel={`${author}: ${text}. ${time}`}
        style={[styles.bubble, mine && styles.myBubble]}
      >
        {!mine ? <Text style={[styles.authorName, { color: authorColors[message.author] }]}>{author}</Text> : null}
        <Text selectable style={[styles.messageText, mine && styles.myMessageText]}>{text}</Text>
        <Text style={[styles.messageTime, mine && styles.myMessageTime]}>{time}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, width: '100%', maxWidth: 680, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 14 },
  backButton: { width: 44, height: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  headerAvatar: { width: 43, height: 43, borderRadius: 17, backgroundColor: colors.surfaceRaised },
  headerText: { flex: 1, minWidth: 0, gap: 4 },
  title: { color: colors.text, fontSize: 17, lineHeight: 21, fontWeight: '700', letterSpacing: -0.35 },
  subtitle: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  demoBadge: { backgroundColor: '#1D2422', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 5, marginRight: 5 },
  demoBadgeText: { color: '#C4D2C8', fontSize: 8, lineHeight: 11, fontWeight: '700', letterSpacing: 0.6 },
  contextWrap: { paddingHorizontal: 18, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft },
  contextCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 11, paddingRight: 15, backgroundColor: colors.surface, borderRadius: 19, borderWidth: 1, borderColor: colors.border },
  contextPhoto: { width: 53, height: 59, borderRadius: 11, backgroundColor: colors.surfaceRaised },
  contextText: { flex: 1, minWidth: 0, gap: 3 },
  contextEyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 1 },
  contextEyebrow: { color: '#9BA59F', fontSize: 8, lineHeight: 12, fontWeight: '700', letterSpacing: 1 },
  contextPlace: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  contextMeta: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  messages: { flex: 1, minHeight: 0 },
  messageContent: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 16 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 17, paddingHorizontal: 18 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  dividerText: { flexShrink: 1, color: colors.muted, fontSize: 10, lineHeight: 15, textAlign: 'center' },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 14 },
  myMessageRow: { justifyContent: 'flex-end', marginVertical: 3, marginBottom: 17 },
  authorAvatar: { width: 27, height: 27, flexShrink: 0, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#222A29', marginBottom: 1 },
  authorInitial: { fontSize: 11, fontWeight: '700' },
  bubble: { maxWidth: '82%', flexShrink: 1, backgroundColor: '#1C2225', borderRadius: 18, borderBottomLeftRadius: 5, paddingHorizontal: 13, paddingTop: 10, paddingBottom: 7 },
  myBubble: { backgroundColor: '#E7EBE4', borderBottomLeftRadius: 18, borderBottomRightRadius: 5 },
  authorName: { fontSize: 10, lineHeight: 14, fontWeight: '600', marginBottom: 4 },
  messageText: { color: '#E8EBE8', fontSize: 13, lineHeight: 20, flexShrink: 1 },
  myMessageText: { color: '#19231D' },
  messageTime: { color: '#929D9D', fontSize: 9, lineHeight: 13, marginTop: 3, alignSelf: 'flex-end', fontVariant: ['tabular-nums'] },
  myMessageTime: { color: '#647065' },
  composerArea: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSoft, backgroundColor: colors.background },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, minHeight: 54, padding: 5, paddingLeft: 2, backgroundColor: '#181E20', borderRadius: 27, borderWidth: 1, borderColor: '#293033' },
  input: { flex: 1, minWidth: 0, minHeight: 44, maxHeight: 126, color: colors.text, fontSize: 14, lineHeight: 21, paddingLeft: 15, paddingRight: 4, paddingTop: 11, paddingBottom: 11 },
  sendButton: { width: 44, height: 44, flexShrink: 0, borderRadius: 22, backgroundColor: '#252D2E', alignItems: 'center', justifyContent: 'center' },
  sendButtonReady: { backgroundColor: '#E7EBE4' },
  demoNoteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 9, paddingHorizontal: 4 },
  demoNote: { flexShrink: 1, color: colors.muted, fontSize: 9, lineHeight: 13, textAlign: 'center' },
  pressed: { opacity: 0.65 },
});
