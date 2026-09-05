import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Outfit_600SemiBold } from '@expo-google-fonts/outfit/600SemiBold';
import { useFonts } from 'expo-font';
import { photos } from '../assets';
import { SectionHeader } from '../components/Primitives';
import { Screen } from '../components/Screen';
import { PartyIcon } from '../components/icons/PartyIcon';
import { ChatsModal } from '../features/chats/ChatsModal';
import { useHomeExperience } from '../features/home/HomeExperienceProvider';
import { LobbyExtroversionIndicator } from '../features/home/LobbyExtroversionIndicator';
import { LobbyCountdown } from '../features/home/LobbyCountdown';
import { LiveLobbyFeed } from '../features/home/LiveLobbyFeed';
import { LiveLobbyDetails } from '../features/home/LiveLobbyDetails';
import { DemoLobby, demoLobbies, getJoinedLobbies, getLobbyMembers } from '../features/home/lobbies';
import { SearchModal } from '../features/search/SearchModal';
import { useI18n } from '../i18n/LocalizationProvider';
import { colors, radius } from '../theme';

export function HomeScreen({ initialLobbyId = null, onInitialLobbyConsumed }: {
  initialLobbyId?: string | null; onInitialLobbyConsumed?: () => void;
} = {}) {
  const { t } = useI18n();
  const { session } = useHomeExperience();
  const [brandFontLoaded] = useFonts({ Outfit_600SemiBold });
  const [selectedLobbyId, setSelectedLobbyId] = useState<string | null>(initialLobbyId);
  useEffect(() => { if (initialLobbyId) onInitialLobbyConsumed?.(); }, [initialLobbyId, onInitialLobbyConsumed]);
  const [chatsEntry, setChatsEntry] = useState<{ initialLobby?: DemoLobby; listPage?: 'chats' | 'your-lobbies' } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const yourLobbies = getJoinedLobbies(demoLobbies, session);

  return (
    <>
      <Screen>
        <View style={styles.header}>
          <Pressable
            testID="open-search"
            accessibilityRole="button"
            accessibilityLabel={`${t('search.open')} · ${t('lobbies.demo')}`}
            onPress={() => setSearchOpen(true)}
            style={({ pressed }) => [styles.searchButton, pressed && styles.pressed]}
          >
            <PartyIcon name="search" size={24} color={colors.white} />
          </Pressable>
          <Text
            testID="home-brand"
            accessibilityRole="header"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            maxFontSizeMultiplier={1.2}
            style={[styles.brand, brandFontLoaded ? styles.brandFont : styles.brandFallback]}
          >
            Party Maker
          </Text>
          <Pressable
            testID="open-chats"
            accessibilityRole="button"
            accessibilityLabel={`${t('chats.open')} · ${t('lobbies.demo')}`}
            onPress={() => setChatsEntry({})}
            style={({ pressed }) => [styles.chatButton, pressed && styles.pressed]}
          >
            <PartyIcon name="send" size={23} color={colors.black} />
          </Pressable>
        </View>

        <Text style={styles.cardMeta}>{t('lobbies.demoTools')}</Text>
        <LiveLobbyFeed onSelect={setSelectedLobbyId} />
        <SectionHeader
          title={`${t('home.yourLobbies')} · ${t('lobbies.demo')}`}
          action={t('common.viewAll')}
          actionTestID="view-all-your-lobbies"
          actionAccessibilityLabel={t('yourLobbies.open')}
          onActionPress={() => setChatsEntry({ listPage: 'your-lobbies' })}
          style={styles.yourSectionHeader}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.yourList}>
          {yourLobbies.map((lobby) => <MiniLobby key={lobby.id} lobby={lobby} onPress={() => setChatsEntry({ initialLobby: lobby })} />)}
        </ScrollView>

      </Screen>
      {selectedLobbyId ? <LiveLobbyDetails key={selectedLobbyId} id={selectedLobbyId} onClose={() => setSelectedLobbyId(null)} /> : null}
      {chatsEntry ? <ChatsModal {...chatsEntry} onClose={() => setChatsEntry(null)} /> : null}
      {searchOpen ? <SearchModal onClose={() => setSearchOpen(false)} /> : null}
    </>
  );
}

type LobbyCardProps = { lobby: DemoLobby; onPress: () => void };

function MiniLobby({ lobby, onPress }: LobbyCardProps) {
  const { t } = useI18n();
  const { session } = useHomeExperience();
  return (
    <Pressable
      testID={`your-lobby-${lobby.id}`}
      accessibilityRole="button"
      accessibilityLabel={t(lobby.titleKey)}
      accessibilityHint={t('conversation.open')}
      onPress={onPress}
      style={({ pressed }) => [styles.miniCard, pressed && styles.pressed]}
    >
      <Image source={photos[lobby.photo]} style={styles.miniImage} />
      <View style={styles.miniBody}>
        <View style={styles.lobbyTitleRow}>
          <Text style={[styles.cardTitle, styles.lobbyTitleText]}>{t(lobby.titleKey)}</Text>
          <LobbyExtroversionIndicator lobby={lobby} size={32} />
        </View>
        <Text style={styles.cardSub}>{lobby.placeKey ? t(lobby.placeKey) : lobby.place}</Text>
        <Text testID={`your-meta-${lobby.id}`} style={styles.cardMeta}>{t(lobby.metaKey)}</Text>
        <LobbyCountdown startsAt={session.startedAt + lobby.startsAfterMs} testID={`your-countdown-${lobby.id}`} />
        <View style={styles.memberRow}>
          <Feather name="users" size={12} color={colors.muted} />
          <Text style={styles.peopleText}>{getLobbyMembers(lobby, session)} / {lobby.capacity}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 2, marginBottom: 4 },
  brand: { flex: 1, minWidth: 0, color: colors.white, fontSize: 28, lineHeight: 36, letterSpacing: -0.8, textAlign: 'center', includeFontPadding: false },
  brandFont: { fontFamily: 'Outfit_600SemiBold' },
  brandFallback: { fontWeight: '600' },
  yourSectionHeader: { marginTop: 0, marginBottom: 10 },
  searchButton: { flexShrink: 0, width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  chatButton: { flexShrink: 0, width: 46, height: 46, borderRadius: 23, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  yourList: { gap: 10, paddingRight: 18 },
  miniCard: { width: 174, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', backgroundColor: colors.surface },
  miniImage: { width: '100%', height: 84 },
  miniBody: { padding: 12, gap: 6 },
  cardTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  lobbyTitleRow: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 7 },
  lobbyTitleText: { flex: 1 },
  cardSub: { color: colors.muted, fontSize: 12 },
  cardMeta: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  peopleText: { color: colors.text, fontSize: 11, fontWeight: '600' },
  pressed: { opacity: 0.72 },
});
