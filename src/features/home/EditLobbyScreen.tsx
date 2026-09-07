import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Lobby, LobbyCategory } from '../../api/lobbyTypes';
import { getLobbyInvalidation } from '../../api/lobbyInvalidation';
import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n/LocalizationProvider';
import type { TranslationKey } from '../../i18n/translations';
import { colors, radius } from '../../theme';
import { LOBBY_CATEGORIES } from './createLobbyForm';
import { EditLobbyFormStore, emptyEditLobby } from './editLobbyForm';
import { useHomeClock } from './HomeExperienceProvider';

const categoryLabels: Record<LobbyCategory, TranslationKey> = {
  DRINKS: 'category.drinks', GAMING: 'category.gaming', FOOD: 'category.food',
  SPORT: 'category.sport', MOVIES: 'category.movies', OUTDOORS: 'category.outdoors',
};

/** Editor content shares the parent's Modal. Schedule never enters editable fields. */
export function EditLobbyScreen({ lobbyId, onBack, onSaved, onAccessLost }: {
  lobbyId: string; onBack: () => void; onSaved: (lobby: Lobby) => void; onAccessLost: () => void;
}) {
  const { lobbyApi, user, storageRecoveryRequired } = useAuth();
  const { t, language } = useI18n();
  const now = useHomeClock();
  const account = storageRecoveryRequired ? null : user?.id ?? null;
  const saved = useRef(onSaved); saved.current = onSaved;
  const lost = useRef(onAccessLost); lost.current = onAccessLost;
  const store = useMemo(() => new EditLobbyFormStore(lobbyApi, lobby => saved.current(lobby)), [lobbyApi]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    const unsubscribe = getLobbyInvalidation(lobbyApi).subscribe(store.invalidate);
    store.setContext(account, lobbyId);
    return () => { unsubscribe(); store.setContext(null, lobbyId); };
  }, [store, lobbyApi, account, lobbyId]);
  const current = snapshot.account === account && snapshot.id === lobbyId ? snapshot : emptyEditLobby(account, lobbyId);
  useEffect(() => { if (account && current.blocked) lost.current(); }, [account, current.blocked]);
  const started = !!current.base && Date.parse(current.base.startsAt) <= now;
  const editable = !!account && !!current.fields && !current.submitting && !current.blocked && !current.saved && !started;
  const back = () => { store.setContext(null, lobbyId); onBack(); };
  const fields = current.fields;
  return <KeyboardAvoidingView testID="edit-lobby-screen" style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.header}>
      <Pressable testID="edit-back" accessibilityRole="button" onPress={back}><Text style={styles.link}>{t('liveChat.back')}</Text></Pressable>
      <Text accessibilityRole="header" style={styles.heading}>{t('edit.title')}</Text>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {current.checking ? <ActivityIndicator testID="edit-loading" color={colors.text} /> : null}
      {current.base ? <View style={styles.card}>
        <Text style={styles.label}>{t('edit.scheduleFixed')}</Text>
        <Text testID="edit-schedule" style={styles.note}>{new Date(current.base.startsAt).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US', {
          timeZone: current.base.timeZone, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
        })} · {current.base.timeZone}</Text>
      </View> : null}
      {fields ? <>
        <View style={styles.card}>
          <Text style={styles.label}>{t('create.title')}</Text>
          <TextInput testID="edit-title" accessibilityLabel={t('create.title')} value={fields.title} editable={editable} onChangeText={title => store.update({ title })} style={styles.input} />
        </View>
        <View style={styles.card}>
          <Text style={styles.label}>{t('create.description')}</Text>
          <TextInput testID="edit-description" accessibilityLabel={t('create.description')} value={fields.description} multiline editable={editable} onChangeText={description => store.update({ description })} style={styles.input} />
        </View>
        {fields.category !== null ? <View style={styles.card}>
          <Text style={styles.label}>{t('create.category')}</Text>
          <View style={styles.choices}>{LOBBY_CATEGORIES.map(category => <Pressable key={category} testID={`edit-category-${category}`} accessibilityRole="radio"
            accessibilityState={{ checked: fields.category === category, disabled: !editable }} disabled={!editable} onPress={() => store.update({ category })}
            style={[styles.choice, fields.category === category && styles.selected]}>
            <Text style={fields.category === category ? styles.selectedText : styles.note}>{t(categoryLabels[category])}</Text>
          </Pressable>)}</View>
        </View> : null}
        <View style={styles.card}>
          <Text style={styles.label}>{t('create.maxPeople')}</Text>
          <TextInput testID="edit-capacity" accessibilityLabel={t('create.maxPeople')} keyboardType="number-pad" value={fields.capacity} editable={editable} onChangeText={capacity => store.update({ capacity })} style={styles.input} />
        </View>
        <View style={styles.card}>
          <Text style={styles.label}>{t('create.format')}</Text>
          <View style={styles.choices}>{[false, true].map(isOnline => <Pressable key={String(isOnline)} testID={isOnline ? 'edit-online' : 'edit-offline'} accessibilityRole="radio"
            accessibilityState={{ checked: fields.isOnline === isOnline, disabled: !editable }} disabled={!editable} onPress={() => store.update({ isOnline })}
            style={[styles.choice, fields.isOnline === isOnline && styles.selected]}>
            <Text style={fields.isOnline === isOnline ? styles.selectedText : styles.note}>{t(isOnline ? 'home.online' : 'create.offline')}</Text>
          </Pressable>)}</View>
        </View>
        {!fields.isOnline ? <View style={styles.card}>
          <Text style={styles.label}>{t('create.venue')}</Text>
          <TextInput testID="edit-venue" accessibilityLabel={t('create.venue')} value={fields.venueName} editable={editable} onChangeText={venueName => store.update({ venueName })} style={styles.input} />
        </View> : null}
      </> : null}
      {started || current.blocked ? <Text testID="edit-unavailable" style={styles.note}>{t('edit.unavailable')}</Text> : null}
      {current.error ? <Text testID="edit-error" accessibilityLiveRegion="polite" style={styles.error}>{t(current.error)}</Text> : null}
      {current.checkError ? <Text testID="edit-check-error" style={styles.error}>{t('edit.checkError')}</Text> : null}
      {current.checked ? <View testID="edit-checked" style={styles.card}>
        <Text style={styles.note}>{t('edit.checked')}</Text>
        <Text style={styles.note}>{current.checked.title}</Text>
        <Text style={styles.note}>{current.checked.description}</Text>
        <Text style={styles.note}>{current.checked.category !== null ? `${t(categoryLabels[current.checked.category])} · ` : ''}{t('create.maxPeople')}: {current.checked.capacity}</Text>
        <Text style={styles.note}>{current.checked.isOnline ? t('home.online') : current.checked.venueName}</Text>
      </View> : null}
      <Pressable testID="edit-check" accessibilityRole="button" disabled={!account || current.checking || current.submitting || current.saved} onPress={() => void store.check(true)}>
        <Text style={styles.link}>{t('edit.check')}</Text>
      </Pressable>
      <Pressable testID="edit-submit" accessibilityRole="button" disabled={!editable || current.checking} onPress={() => void store.submit()} style={[styles.primary, (!editable || current.checking) && styles.dimmed]}>
        {current.submitting ? <ActivityIndicator color={colors.black} /> : <Text style={styles.selectedText}>{t('edit.save')}</Text>}
      </Pressable>
    </ScrollView>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  page: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 12 },
  heading: { flex: 1, color: colors.text, fontSize: 22, fontWeight: '700' }, link: { color: colors.text, paddingVertical: 10 },
  content: { gap: 12, paddingBottom: 24 }, card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium, padding: 12, gap: 8 },
  label: { color: colors.muted, fontSize: 12 }, note: { color: colors.text, fontSize: 13, lineHeight: 19 },
  input: { color: colors.text, fontSize: 15, minHeight: 38, paddingVertical: 6 }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, padding: 10 }, selected: { backgroundColor: colors.text },
  selectedText: { color: colors.black, fontSize: 14, fontWeight: '600' }, primary: { padding: 15, borderRadius: radius.medium, alignItems: 'center', backgroundColor: colors.text },
  error: { color: '#F0AAA6', fontSize: 13, lineHeight: 20 }, dimmed: { opacity: 0.5 },
});
