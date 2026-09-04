import { useState } from 'react';
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
import { LobbyCountdown } from '../features/home/LobbyCountdown';
import { LobbyPreview } from '../features/home/LobbyPreview';
import { DemoLobby, demoLobbies, getJoinedLobbies, getLobbyMembers, isLobbyJoined } from '../features/home/lobbies';
import { SearchModal } from '../features/search/SearchModal';
import { useI18n } from '../i18n/LocalizationProvider';
import { colors, radius } from '../theme';

export function HomeScreen() {
  const { t } = useI18n();
  const { session } = useHomeExperience();
  const [brandFontLoaded] = useFonts({ Outfit_600SemiBold });
  const [selectedLobby, setSelectedLobby] = useState<DemoLobby | null>(null);
  const [chatsEntry, setChatsEntry] = useState<{ initialLobby?: DemoLobby; listPage?: 'chats' | 'your-lobbies' } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const yourLobbies = getJoinedLobbies(demoLobbies, session);
  const nearbyLobbies = demoLobbies.filter((lobby) => !lobby.isYours);

  return (
    <>
      <Screen>
        <View style={styles.header}>
          <Pressable
            testID="open-search"
            accessibilityRole="button"
            accessibilityLabel={t('search.open')}
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
            accessibilityLabel={t('chats.open')}
            onPress={() => setChatsEntry({})}
            style={({ pressed }) => [styles.chatButton, pressed && styles.pressed]}
          >
            <PartyIcon name="send" size={23} color={colors.black} />
          </Pressable>
        </View>

        <SectionHeader
          title={t('home.yourLobbies')}
          action={t('common.viewAll')}
          actionTestID="view-all-your-lobbies"
          actionAccessibilityLabel={t('yourLobbies.open')}
          onActionPress={() => setChatsEntry({ listPage: 'your-lobbies' })}
          style={styles.yourSectionHeader}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.yourList}>
          {yourLobbies.map((lobby) => <MiniLobby key={lobby.id} lobby={lobby} onPress={() => setChatsEntry({ initialLobby: lobby })} />)}
        </ScrollView>

        <SectionHeader title={t('home.nearbyLobbies')} />
        <View style={styles.nearbyList}>
          {nearbyLobbies.map((lobby) => <NearbyLobby key={lobby.id} lobby={lobby} onPress={() => setSelectedLobby(lobby)} />)}
        </View>
      </Screen>
      {selectedLobby ? <LobbyPreview lobby={selectedLobby} onClose={() => setSelectedLobby(null)} /> : null}
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

function NearbyLobby({ lobby, onPress }: LobbyCardProps) {
  const { t } = useI18n();
  const { session } = useHomeExperience();
  const joined = isLobbyJoined(lobby, session);
  return (
    <Pressable
      testID={`nearby-lobby-${lobby.id}`}
      accessibilityRole="button"
      accessibilityLabel={t(lobby.titleKey)}
      accessibilityHint={t('home.openLobby')}
      onPress={onPress}
      style={({ pressed }) => [styles.nearbyCard, pressed && styles.pressed]}
    >
      <View style={styles.nearbyImageWrap}>
        <Image source={photos[lobby.photo]} style={styles.nearbyImage} />
      </View>
      <View style={styles.nearbyBody}>
        <View style={styles.lobbyTitleRow}>
          <Text style={[styles.nearbyTitle, styles.lobbyTitleText]}>{t(lobby.titleKey)}</Text>
        </View>
        <Text style={styles.nearbyPlace}>{lobby.placeKey ? t(lobby.placeKey) : lobby.place}</Text>
        <Text testID={`nearby-meta-${lobby.id}`} style={styles.cardMeta}>{t(lobby.metaKey)}</Text>
        <LobbyCountdown startsAt={session.startedAt + lobby.startsAfterMs} testID={`nearby-countdown-${lobby.id}`} />
        <View style={styles.cardFooter}>
          {joined ? (
            <View style={styles.memberRow}>
              <Feather name="check" size={12} color={colors.success} />
              <Text style={styles.joinedText}>{t('home.joined')}</Text>
            </View>
          ) : null}
          <View style={styles.memberRow}>
            <Feather name="users" size={12} color={colors.muted} />
            <Text style={styles.peopleText}>{getLobbyMembers(lobby, session)} / {lobby.capacity}</Text>
          </View>
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
  lobbyTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lobbyTitleText: { flex: 1 },
  cardSub: { color: colors.muted, fontSize: 12 },
  cardMeta: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  nearbyList: { gap: 10 },
  nearbyCard: { minHeight: 108, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'stretch', overflow: 'hidden' },
  nearbyImageWrap: { width: 96, alignSelf: 'stretch' },
  nearbyImage: { position: 'absolute', width: '100%', height: '100%' },
  nearbyBody: { flex: 1, paddingVertical: 12, paddingHorizontal: 12, gap: 5 },
  nearbyTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  nearbyPlace: { color: colors.muted, fontSize: 11 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, marginTop: 1 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  peopleText: { color: colors.text, fontSize: 11, fontWeight: '600' },
  joinedText: { color: colors.success, fontSize: 11, fontWeight: '500' },
  pressed: { opacity: 0.72 },
});
