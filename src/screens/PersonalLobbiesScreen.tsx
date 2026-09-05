import { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { LiveLobbyFeed } from '../features/home/LiveLobbyFeed';
import { CancelledLobbyNotice, LiveLobbyDetails } from '../features/home/LiveLobbyDetails';
import { useI18n } from '../i18n/LocalizationProvider';
import { colors } from '../theme';

// A real API route, deliberately separate from ChatsModal's legacy demo list.
export function PersonalLobbiesScreen({ onClose, onCreate }: { onClose: () => void; onCreate?: () => void }) {
  const { t } = useI18n();
  const [selectedLobbyId, setSelectedLobbyId] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => subscription.remove();
  }, [onClose]);
  return <>
    <Screen>
      <View testID="personal-lobbies-screen" style={styles.header}>
        <Pressable testID="personal-lobbies-back" accessibilityRole="button" accessibilityLabel={t('conversation.backToHome')} onPress={onClose} style={styles.back}>
          <Feather name="chevron-left" size={24} color={colors.text} />
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>{t('common.viewAll')}</Text>
      </View>
      {cancelled ? <CancelledLobbyNotice onDismiss={() => setCancelled(false)} /> : null}
      <LiveLobbyFeed scope="mine" onSelect={setSelectedLobbyId} onCreate={onCreate} />
    </Screen>
    {selectedLobbyId ? <LiveLobbyDetails key={selectedLobbyId} id={selectedLobbyId} onClose={() => setSelectedLobbyId(null)} onCancelled={() => setCancelled(true)} /> : null}
  </>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  title: { flex: 1, color: colors.text, fontSize: 26, fontWeight: '700' },
});
