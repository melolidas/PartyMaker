import { useEffect, type ReactNode } from 'react';
import { BackHandler, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../../i18n/LocalizationProvider';
import { colors, radius } from '../../theme';

/** Chat uses an overlay in its current Modal; creation can own a standalone Modal. */
export function RolePopup({ children, onBack, label, standalone = false }: { children: ReactNode; onBack: () => void; label: string; standalone?: boolean }) {
  const { t } = useI18n();
  useEffect(() => {
    Keyboard.dismiss();
    const back = () => { onBack(); return true; };
    const subscription = BackHandler.addEventListener('hardwareBackPress', back);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        // RN Web's parent Modal also listens on keyup: consume that same event,
        // not keydown followed by a second parent-modal Back for one key press.
        if (event.type === 'keyup') onBack();
      }
    };
    if (Platform.OS === 'web') { window.addEventListener('keydown', key, true); window.addEventListener('keyup', key, true); }
    return () => { subscription.remove(); if (Platform.OS === 'web') { window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', key, true); } };
  }, [onBack]);
  const content = <KeyboardAvoidingView testID="role-popup" style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    accessibilityViewIsModal onAccessibilityEscape={onBack} role="dialog" aria-modal aria-label={label}>
    <View style={styles.sheet}>
      <Pressable testID="role-popup-back" accessibilityRole="button" accessibilityLabel={t('roles.back')} onPress={onBack} style={styles.back}><Text style={styles.text}>{t('roles.back')}</Text></Pressable>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>{children}</ScrollView>
    </View>
  </KeyboardAvoidingView>;
  // CreateLobbyScreen has no Modal; chat callers already own one and use the overlay only.
  return standalone ? <Modal transparent animationType="fade" onRequestClose={onBack}>{content}</Modal> : content;
}
const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 30, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 16 },
  sheet: { maxHeight: '90%', borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  content: { padding: 16, gap: 16 }, back: { alignSelf: 'flex-start', padding: 14 }, text: { color: colors.text, fontSize: 14 },
});
