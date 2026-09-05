import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuthenticatedAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n/LocalizationProvider';
import { colors, radius } from '../../theme';
import { AvatarEditorStore } from './avatarEditorState';
import { AvatarImage } from './AvatarImage';

export function AvatarEditor({ onClose }: { onClose: () => void }) {
  const { user, storageRecoveryRequired, uploadAvatar, refreshAvatar } = useAuthenticatedAuth();
  const { t } = useI18n();
  const account = storageRecoveryRequired ? null : user.id;
  const store = useMemo(() => new AvatarEditorStore({
    upload: uploadAvatar, refresh: refreshAvatar,
    pick: async () => {
      // Called directly from a user gesture on web. No camera/microphone or broad library scan.
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false,
        allowsEditing: false, quality: 1, exif: false, base64: false });
      return result.canceled ? null : result.assets[0] ?? null;
    },
  }), [uploadAvatar, refreshAvatar]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => { store.setContext(account); return () => store.setContext(null); }, [store, account]);
  const current = state.account === account && !!account;
  const close = () => { store.setContext(null); onClose(); };
  return <Modal visible transparent animationType="fade" onRequestClose={close}>
    <View style={styles.overlay}><View style={styles.sheet}>
      <View style={styles.header}><Text style={styles.title}>{t('avatar.change')}</Text><Pressable testID="avatar-close" accessibilityRole="button" onPress={close}><Text style={styles.text}>{t('common.close')}</Text></Pressable></View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.muted}>{t('avatar.public')}</Text>
        <Text style={styles.muted}>{t('avatar.requirements')}</Text>
        {current ? <View style={styles.confirmed}><Text style={styles.muted}>{t('avatar.current')}</Text><AvatarImage avatar={user.avatar} size={64} /></View> : null}
        {current && state.draft ? <Image testID="avatar-preview" source={{ uri: state.draft.uri }} style={styles.preview} accessibilityLabel={t('avatar.preview')} /> : null}
        <Pressable testID="avatar-pick" accessibilityRole="button" disabled={!current || !!state.busy} onPress={() => void store.choose()} style={styles.button}><Text style={styles.text}>{t('avatar.choose')}</Text></Pressable>
        {current && state.draft ? <>
          <Pressable testID="avatar-upload" accessibilityRole="button" disabled={!!state.busy} onPress={() => void store.upload()} style={styles.button}><Text style={styles.text}>{t(state.uncertain ? 'avatar.retry' : 'avatar.upload')}</Text></Pressable>
          <Pressable testID="avatar-discard" accessibilityRole="button" disabled={!!state.busy} onPress={store.discard} style={styles.button}><Text style={styles.text}>{t('common.cancel')}</Text></Pressable>
        </> : null}
        <Pressable testID="avatar-refresh" accessibilityRole="button" disabled={!current || !!state.busy} onPress={() => void store.refresh()} style={styles.button}><Text style={styles.text}>{t('avatar.refresh')}</Text></Pressable>
        {current && state.busy ? <ActivityIndicator testID="avatar-busy" color={colors.text} /> : null}
        {current && state.error ? <Text testID="avatar-error" accessibilityLiveRegion="polite" style={styles.error}>{t(state.error)}</Text> : null}
        {current && state.saved ? <Text testID="avatar-saved" accessibilityLiveRegion="polite" style={styles.text}>{t('avatar.saved')}</Text> : null}
        {current && state.checked ? <Text testID="avatar-checked" style={styles.muted}>{t('avatar.checked')}</Text> : null}
      </ScrollView>
    </View></View>
  </Modal>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, padding: 20, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.75)' },
  sheet: { maxHeight: '85%', padding: 20, maxWidth: 440, width: '100%', alignSelf: 'center', borderRadius: radius.large, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 18 },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', flex: 1 },
  content: { gap: 14 }, text: { color: colors.text, fontSize: 14 }, muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  confirmed: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  error: { color: '#FFB2AD', fontSize: 13, lineHeight: 19 },
  preview: { width: 180, height: 180, borderRadius: 90, alignSelf: 'center' },
  button: { padding: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium },
});
