import { Feather } from '@expo/vector-icons';
import { Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { photos } from '../../assets';
import { IconButton } from '../../components/Primitives';
import { useI18n } from '../../i18n/LocalizationProvider';
import { colors, radius } from '../../theme';
import { getRemainingSeconds } from './countdown';
import { useHomeClock, useHomeExperience } from './HomeExperienceProvider';
import { LobbyCountdown } from './LobbyCountdown';
import { DemoLobby, getLobbyMembers, isLobbyJoined } from './lobbies';

export function LobbyPreview({ lobby, onClose, inline = false }: { lobby: DemoLobby; onClose: () => void; inline?: boolean }) {
  const { t } = useI18n();
  const { session, joinLobby } = useHomeExperience();
  const now = useHomeClock();
  const { height } = useWindowDimensions();
  const joined = isLobbyJoined(lobby, session);
  const members = getLobbyMembers(lobby, session);
  const startsAt = session.startedAt + lobby.startsAfterMs;
  const started = getRemainingSeconds(startsAt, now) === 0;
  const full = members >= lobby.capacity;
  const disabled = joined || started || full;
  const joinLabel = joined ? t('home.joined') : started ? t('home.started') : full ? t('home.full') : t('home.join');

  const content = (
      <View style={[styles.overlay, inline && styles.inlineOverlay]}>
        <Pressable testID="lobby-backdrop" style={styles.backdrop} onPress={onClose} accessible={false} importantForAccessibility="no" />
        <View testID="lobby-preview" style={[styles.dialog, { maxHeight: Math.max(180, height - 80) }]} accessibilityViewIsModal>
          <View style={styles.topRow}>
            <Text style={styles.eyebrow}>{t('home.demoLabel')}</Text>
            <IconButton name="x" accessibilityLabel={t('a11y.close')} onPress={onClose} />
          </View>
          <ScrollView style={styles.scroll} bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <Image source={photos[lobby.photo]} style={styles.photo} />
            <View style={styles.titleRow}>
              <Text style={styles.title}>{t(lobby.titleKey)}</Text>
            </View>
            <Text testID="lobby-description" style={styles.description}>{t(lobby.descriptionKey)}</Text>
            <View style={styles.details}>
              <View style={styles.detailRow}>
                <Feather name="map-pin" size={14} color={colors.muted} />
                <Text style={styles.detailText}>{lobby.placeKey ? t(lobby.placeKey) : lobby.place}</Text>
              </View>
              <LobbyCountdown startsAt={startsAt} testID="lobby-preview-countdown" />
              <View style={styles.detailRow}>
                <Feather name="users" size={14} color={colors.muted} />
                <Text style={styles.detailText}>{t('home.participants')}: {members} / {lobby.capacity}</Text>
              </View>
            </View>
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.button, styles.secondary, pressed && styles.pressed]}>
                <Text style={styles.secondaryText}>{joined ? t('a11y.close') : t('home.decline')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => { joinLobby(lobby); onClose(); }}
                style={({ pressed }) => [styles.button, styles.primary, disabled && styles.disabled, pressed && styles.pressed]}
              >
                <Text style={styles.primaryText}>{joinLabel}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
  );

  // Search already owns a native modal: render its preview in the same one.
  if (inline) return content;
  return (
    // Web focus trapping must not depend on animationend in a background tab.
    <Modal transparent animationType={Platform.OS === 'web' ? 'none' : 'fade'} onRequestClose={onClose} accessibilityLabel={t(lobby.titleKey)}>
      {content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 22 },
  inlineOverlay: { ...StyleSheet.absoluteFill },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.74)' },
  dialog: { width: '100%', maxWidth: 370, backgroundColor: colors.surface, borderWidth: 1, borderColor: '#343B3E', borderRadius: 24, overflow: 'hidden' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 18, paddingRight: 8, paddingVertical: 5 },
  eyebrow: { color: colors.muted, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  content: { paddingHorizontal: 18, paddingBottom: 20 },
  scroll: { flexGrow: 0 },
  photo: { width: '100%', height: 120, borderRadius: radius.small, backgroundColor: colors.surfaceRaised },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 18 },
  title: { flex: 1, color: colors.text, fontSize: 21, lineHeight: 26, fontWeight: '800' },
  description: { color: colors.text, fontSize: 14, lineHeight: 21, marginTop: 12 },
  details: { gap: 10, marginTop: 18, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  detailText: { flexShrink: 1, color: colors.muted, fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 22 },
  button: { flex: 1, minHeight: 46, borderRadius: 14, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 10 },
  primary: { backgroundColor: colors.text },
  secondary: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  primaryText: { color: colors.black, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  secondaryText: { color: colors.text, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.7 },
});
