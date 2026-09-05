import { useContext, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Outfit_600SemiBold } from '@expo-google-fonts/outfit/600SemiBold';
import { useFonts } from 'expo-font';
import { Screen } from '../components/Screen';
import { PartyIcon } from '../components/icons/PartyIcon';
import { LiveChatsModal } from '../features/chats/LiveChatsModal';
import { LiveLobbyFeed } from '../features/home/LiveLobbyFeed';
import { CancelledLobbyNotice, LiveLobbyDetails } from '../features/home/LiveLobbyDetails';
import { PersonalLobbiesScreen } from './PersonalLobbiesScreen';
import { SearchModal } from '../features/search/SearchModal';
import { useI18n } from '../i18n/LocalizationProvider';
import { colors } from '../theme';
import { NavScrollContext } from '../navigation/NavScrollContext';

export function HomeScreen({ initialLobbyId = null, onInitialLobbyConsumed, onCreate }: {
  initialLobbyId?: string | null; onInitialLobbyConsumed?: () => void; onCreate?: () => void;
} = {}) {
  const { t } = useI18n();
  const [brandFontLoaded] = useFonts({ Outfit_600SemiBold });
  const [selectedLobbyId, setSelectedLobbyId] = useState<string | null>(initialLobbyId);
  useEffect(() => { if (initialLobbyId) onInitialLobbyConsumed?.(); }, [initialLobbyId, onInitialLobbyConsumed]);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [personalOpen, setPersonalOpen] = useState(false);
  const setNavCompact = useContext(NavScrollContext);
  const showPersonal = (open: boolean) => {
    setNavCompact(false);
    setPersonalOpen(open);
  };
  const [searchOpen, setSearchOpen] = useState(false);
  if (personalOpen) return <PersonalLobbiesScreen onClose={() => showPersonal(false)} onCreate={onCreate} />;

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
            onPress={() => setChatsOpen(true)}
            style={({ pressed }) => [styles.chatButton, pressed && styles.pressed]}
          >
            <PartyIcon name="send" size={23} color={colors.black} />
          </Pressable>
        </View>

        {cancelled ? <CancelledLobbyNotice onDismiss={() => setCancelled(false)} /> : null}
        <LiveLobbyFeed onSelect={setSelectedLobbyId} />
        <LiveLobbyFeed scope="mine" compact onSelect={setSelectedLobbyId} onViewAll={() => showPersonal(true)} onCreate={onCreate} />

      </Screen>
      {selectedLobbyId ? <LiveLobbyDetails key={selectedLobbyId} id={selectedLobbyId} onClose={() => setSelectedLobbyId(null)} onCancelled={() => setCancelled(true)} /> : null}
      {chatsOpen ? <LiveChatsModal onClose={() => setChatsOpen(false)} /> : null}
      {searchOpen ? <SearchModal onClose={() => setSearchOpen(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 2, marginBottom: 4 },
  brand: { flex: 1, minWidth: 0, color: colors.white, fontSize: 28, lineHeight: 36, letterSpacing: -0.8, textAlign: 'center', includeFontPadding: false },
  brandFont: { fontFamily: 'Outfit_600SemiBold' },
  brandFallback: { fontWeight: '600' },
  searchButton: { flexShrink: 0, width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  chatButton: { flexShrink: 0, width: 46, height: 46, borderRadius: 23, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  cardMeta: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  pressed: { opacity: 0.72 },
});
