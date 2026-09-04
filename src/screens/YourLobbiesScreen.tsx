import { Feather } from '@expo/vector-icons';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, type NativeGesture } from 'react-native-gesture-handler';
import { photos } from '../assets';
import { Screen } from '../components/Screen';
import { useHomeExperience } from '../features/home/HomeExperienceProvider';
import { LobbyCountdown } from '../features/home/LobbyCountdown';
import { LobbyExtroversionIndicator } from '../features/home/LobbyExtroversionIndicator';
import { DemoLobby, demoLobbies, getJoinedLobbies, getLobbyMembers } from '../features/home/lobbies';
import { useI18n } from '../i18n/LocalizationProvider';
import { colors } from '../theme';

type Props = {
  active: boolean;
  onClose: () => void;
  onOpenChat: (lobby: DemoLobby) => void;
  scrollGesture: NativeGesture;
};

export function YourLobbiesScreen({ active, onClose, onOpenChat, scrollGesture }: Props) {
  const { t } = useI18n();
  const { session } = useHomeExperience();
  const lobbies = getJoinedLobbies(demoLobbies, session);

  return (
    <Screen scroll={false}>
      <View testID="your-lobbies-screen" style={styles.page}>
        <View style={styles.header}>
          <Pressable
            testID="your-lobbies-back"
            accessibilityRole="button"
            accessibilityLabel={t('conversation.backToHome')}
            disabled={!active}
            tabIndex={active ? 0 : -1}
            onPress={onClose}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Feather name="chevron-left" size={25} color={colors.white} />
          </Pressable>
          <Text accessibilityRole="header" style={styles.title}>{t('home.yourLobbies')}</Text>
          <Text testID="your-lobbies-count" accessibilityLabel={`${t('common.lobbies')}: ${lobbies.length}`} style={styles.count}>{lobbies.length}</Text>
        </View>

        <GestureDetector gesture={scrollGesture} touchAction="pan-y">
          <FlatList
            testID="your-lobbies-list"
            style={styles.list}
            contentContainerStyle={styles.listContent}
            data={lobbies}
            extraData={active}
            keyExtractor={(lobby) => lobby.id}
            showsVerticalScrollIndicator={false}
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
            directionalLockEnabled
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            renderItem={({ item }) => <JoinedLobbyCard lobby={item} active={active} onPress={() => onOpenChat(item)} />}
            ListEmptyComponent={
              <View testID="your-lobbies-empty" style={styles.empty}>
                <View style={styles.emptyIcon}><Feather name="users" size={28} color={colors.muted} /></View>
                <Text style={styles.emptyTitle}>{t('yourLobbies.emptyTitle')}</Text>
                <Text style={styles.emptyDescription}>{t('yourLobbies.emptyDescription')}</Text>
              </View>
            }
          />
        </GestureDetector>
      </View>
    </Screen>
  );
}

function JoinedLobbyCard({ lobby, active, onPress }: { lobby: DemoLobby; active: boolean; onPress: () => void }) {
  const { t } = useI18n();
  const { session } = useHomeExperience();
  return (
    <Pressable
      testID={`all-your-lobby-${lobby.id}`}
      accessibilityRole="button"
      accessibilityLabel={t(lobby.titleKey)}
      accessibilityHint={t('conversation.open')}
      disabled={!active}
      tabIndex={active ? 0 : -1}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Image source={photos[lobby.photo]} style={styles.photo} accessible={false} />
      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}>
          <Text numberOfLines={2} style={styles.cardTitle}>{t(lobby.titleKey)}</Text>
          <LobbyExtroversionIndicator lobby={lobby} size={34} />
          <Feather name="chevron-right" size={16} color={colors.muted} />
        </View>
        <Text style={styles.venue}>{lobby.placeKey ? t(lobby.placeKey) : lobby.place}</Text>
        <Text style={styles.meta}>{t(lobby.metaKey)}</Text>
        <LobbyCountdown startsAt={session.startedAt + lobby.startsAfterMs} testID={`all-your-countdown-${lobby.id}`} />
        <View style={styles.members}>
          <Feather name="users" size={12} color={colors.muted} />
          <Text style={styles.memberCount}>{getLobbyMembers(lobby, session)} / {lobby.capacity}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 22 },
  backButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: colors.white, fontSize: 26, lineHeight: 32, fontWeight: '800', letterSpacing: -0.7 },
  count: { minWidth: 30, overflow: 'hidden', borderRadius: 15, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: colors.surfaceRaised, color: colors.muted, fontSize: 13, lineHeight: 18, textAlign: 'center', fontVariant: ['tabular-nums'] },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 18, paddingBottom: 32, flexGrow: 1 },
  separator: { height: 12 },
  card: { flexDirection: 'row', alignItems: 'stretch', minHeight: 150, padding: 12, gap: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 22 },
  photo: { width: 82, height: 116, alignSelf: 'center', borderRadius: 14, backgroundColor: colors.surfaceRaised },
  cardBody: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 7 },
  cardTitleRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 7 },
  cardTitle: { flex: 1, color: colors.text, fontSize: 16, lineHeight: 21, fontWeight: '700' },
  venue: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  meta: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  members: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  memberCount: { color: colors.text, fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  empty: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 48 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  emptyDescription: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 270 },
  pressed: { opacity: 0.7 },
});
