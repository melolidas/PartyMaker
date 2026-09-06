import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthProvider';
import { IconButton } from '../components/Primitives';
import { Screen } from '../components/Screen';
import { CREATE_LOBBY_TIME_ZONE, CreateLobbyFormStore, emptyLobbyForm } from '../features/home/createLobbyForm';
import { useI18n } from '../i18n/LocalizationProvider';
import { colors, radius } from '../theme';

export function CreateLobbyScreen({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useI18n();
  const { lobbyApi, status, user, storageRecoveryRequired } = useAuth();
  const account = status === 'authenticated' && !storageRecoveryRequired ? user?.id ?? null : null;
  const store = useMemo(() => new CreateLobbyFormStore(input => lobbyApi.createLobby(input), onCreated), [lobbyApi, onCreated]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    store.setAccount(account);
    return () => store.setAccount(null);
  }, [store, account]);
  const state = snapshot.account === account ? snapshot : emptyLobbyForm(account);
  const { fields, submitting } = state;
  const editable = !!account && !submitting && snapshot.account === account;

  return <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Screen contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <IconButton name="x" accessibilityLabel={t('a11y.close')} onPress={onClose} />
        <Text accessibilityRole="header" style={styles.headerTitle}>{t('nav.create')}</Text>
        <View style={styles.headerSpacer} />
      </View>
      <View style={styles.unavailable}>
        <Feather name="image" size={25} color={colors.muted} />
        <Text style={styles.note}>{t('create.mediaUnavailable')}</Text>
      </View>

      <View style={styles.inputCard}>
        <Text style={styles.label}>{t('create.title')}</Text>
        <TextInput testID="create-title" accessibilityLabel={t('create.title')} value={fields.title} editable={editable}
          onChangeText={title => store.update({ title })} style={styles.input} placeholderTextColor={colors.subtle} />
        <Text style={styles.counter}>{Array.from(fields.title.trim()).length}/40</Text>
      </View>
      <View style={styles.inputCard}>
        <Text style={styles.label}>{t('create.description')}</Text>
        <TextInput testID="create-description" accessibilityLabel={t('create.description')} value={fields.description} editable={editable}
          onChangeText={description => store.update({ description })} multiline style={[styles.input, styles.description]} />
        <Text style={styles.counter}>{Array.from(fields.description.trim()).length}/200</Text>
      </View>
      <View style={styles.inputCard}>
        <Text style={styles.label}>{t('create.format')}</Text>
        <View style={styles.choices}>
          {[false, true].map(isOnline => <Pressable key={String(isOnline)} testID={isOnline ? 'create-online' : 'create-offline'}
            accessibilityRole="radio" accessibilityLabel={t(isOnline ? 'home.online' : 'create.offline')} disabled={!editable}
            accessibilityState={{ checked: fields.isOnline === isOnline, disabled: !editable }}
            onPress={() => store.update({ isOnline })} style={[styles.choice, fields.isOnline === isOnline && styles.selected]}>
            <Text style={[styles.choiceText, fields.isOnline === isOnline && styles.selectedText]}>{t(isOnline ? 'home.online' : 'create.offline')}</Text>
          </Pressable>)}
        </View>
      </View>
      {!fields.isOnline ? <View style={styles.inputCard}>
        <Text style={styles.label}>{t('create.venue')}</Text>
        <TextInput testID="create-venue" accessibilityLabel={t('create.venue')} value={fields.venueName} editable={editable}
          onChangeText={venueName => store.update({ venueName })} style={styles.input} />
      </View> : null}
      <View style={styles.inputCard}>
        <Text style={styles.label}>{t('create.date')}</Text>
        <TextInput testID="create-date" accessibilityLabel={t('create.date')} placeholder="YYYY-MM-DD" placeholderTextColor={colors.subtle}
          value={fields.date} editable={editable} autoCapitalize="none" onChangeText={date => store.update({ date })} style={styles.input} />
        <Text style={styles.label}>{t('create.time')}</Text>
        <TextInput testID="create-time" accessibilityLabel={t('create.time')} placeholder="HH:MM" placeholderTextColor={colors.subtle}
          value={fields.time} editable={editable} onChangeText={time => store.update({ time })} style={styles.input} />
        <Text testID="create-timezone" style={styles.note}>{t('create.timeZone')}: {CREATE_LOBBY_TIME_ZONE} (UTC+06:00)</Text>
      </View>
      <View style={styles.inputCard}>
        <Text style={styles.label}>{t('create.maxPeople')}</Text>
        <TextInput testID="create-capacity" accessibilityLabel={t('create.maxPeople')} keyboardType="number-pad" value={fields.capacity} editable={editable}
          onChangeText={capacity => store.update({ capacity })} style={styles.input} />
        <Text style={styles.note}>{t('create.organizerPlace')}</Text>
      </View>
      {state.error ? <Text testID="create-error" accessibilityLiveRegion="polite" style={styles.error}>{t(state.error)}</Text> : null}
      <Pressable testID="create-submit" disabled={!editable} accessibilityRole="button" accessibilityState={{ disabled: !editable, busy: submitting }}
        accessibilityLabel={t('nav.create')} onPress={() => void store.submit()} style={[styles.primaryButton, !editable && styles.disabled]}>
        {submitting ? <ActivityIndicator color={colors.black} /> : <Text style={styles.primaryText}>{t('nav.create')}</Text>}
      </Pressable>
    </Screen>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 36 },
  header: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  headerTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  headerSpacer: { width: 38 },
  unavailable: { borderRadius: radius.medium, borderWidth: 1, borderStyle: 'dashed', borderColor: '#3A4043', alignItems: 'center', padding: 20, gap: 9, marginBottom: 14 },
  inputCard: { minHeight: 70, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radius.medium, padding: 14, marginBottom: 10 },
  label: { color: colors.muted, fontSize: 12, marginBottom: 8 },
  input: { color: colors.text, fontSize: 14, lineHeight: 20, minHeight: 36, paddingVertical: 6 },
  description: { minHeight: 68, textAlignVertical: 'top' },
  counter: { color: colors.subtle, fontSize: 11, textAlign: 'right' },
  note: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { borderRadius: radius.pill, borderColor: colors.border, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  choiceText: { color: colors.text, fontSize: 13 },
  selected: { backgroundColor: colors.text },
  selectedText: { color: colors.black },
  error: { color: '#F0AAA6', fontSize: 13, lineHeight: 20, marginVertical: 12 },
  primaryButton: { height: 54, backgroundColor: colors.text, borderRadius: radius.small, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  primaryText: { color: colors.black, fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.55 },
});
