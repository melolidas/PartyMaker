import { useMemo, useRef, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { FlatList, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { GestureDetector, type NativeGesture } from 'react-native-gesture-handler';
import { photos } from '../assets';
import { PartyIcon } from '../components/icons/PartyIcon';
import { Screen } from '../components/Screen';
import { useHomeExperience } from '../features/home/HomeExperienceProvider';
import { LobbyExtroversionIndicator } from '../features/home/LobbyExtroversionIndicator';
import { DemoLobby, demoLobbies, getLobbyMembers, isLobbyJoined } from '../features/home/lobbies';
import { searchLobbies } from '../features/search/searchLobbies';
import { useI18n } from '../i18n/LocalizationProvider';
import { colors } from '../theme';

type Props = {
  active: boolean;
  onClose: () => void;
  onSelectLobby: (lobby: DemoLobby) => void;
  scrollGesture: NativeGesture;
};

export function SearchScreen({ active, onClose, onSelectLobby, scrollGesture }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const input = useRef<TextInput>(null);
  const list = useRef<FlatList<DemoLobby>>(null);
  const results = useMemo(() => searchLobbies(demoLobbies, query, t), [query, t]);
  const changeQuery = (value: string) => {
    setQuery(value);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  };
  const clear = () => {
    changeQuery('');
    input.current?.focus();
  };

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView testID="search-screen" style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable
            testID="search-back"
            accessibilityRole="button"
            accessibilityLabel={t('search.back')}
            disabled={!active}
            tabIndex={active ? 0 : -1}
            onPress={onClose}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Feather name="chevron-left" size={25} color={colors.white} />
          </Pressable>
          <Text accessibilityRole="header" style={styles.title}>{t('search.title')}</Text>
        </View>

        <View style={[styles.inputRow, inputFocused && styles.inputFocused]}>
          <PartyIcon name="search" size={22} color={colors.muted} />
          <TextInput
            ref={input}
            testID="search-input"
            accessibilityLabel={t('search.input')}
            placeholder={t('search.placeholder')}
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={changeQuery}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            editable={active}
            tabIndex={active ? 0 : -1}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            keyboardAppearance="dark"
            selectionColor={colors.white}
            maxLength={100}
            style={styles.input}
          />
          {query.length > 0 ? (
            <Pressable
              testID="search-clear"
              accessibilityRole="button"
              accessibilityLabel={t('search.clear')}
              disabled={!active}
              tabIndex={active ? 0 : -1}
              onPress={clear}
              style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
            >
              <Feather name="x" size={18} color={colors.text} />
            </Pressable>
          ) : null}
        </View>

        <GestureDetector gesture={scrollGesture} touchAction="pan-y">
          <FlatList
            ref={list}
            testID="search-results"
            style={styles.list}
            contentContainerStyle={styles.listContent}
            data={results}
            extraData={active}
            keyExtractor={(lobby) => lobby.id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            directionalLockEnabled
            showsVerticalScrollIndicator={false}
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListHeaderComponent={
              <View style={styles.resultsHeading}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>{t(query.trim() ? 'search.results' : 'search.allLobbies')}</Text>
                <Text testID="search-result-count" accessibilityLiveRegion="polite" style={styles.count}>{results.length}</Text>
              </View>
            }
            ListEmptyComponent={
              <View testID="search-empty" style={styles.empty}>
                <View style={styles.emptyIcon}><PartyIcon name="search" size={30} color={colors.muted} /></View>
                <Text style={styles.emptyTitle}>{t('search.emptyTitle')}</Text>
                <Text style={styles.emptyDescription}>{t('search.emptyDescription')}</Text>
                <Pressable accessibilityRole="button" disabled={!active} tabIndex={active ? 0 : -1} onPress={clear} style={({ pressed }) => [styles.resetButton, pressed && styles.pressed]}>
                  <Text style={styles.resetText}>{t('search.clear')}</Text>
                </Pressable>
              </View>
            }
            renderItem={({ item }) => <SearchResult lobby={item} active={active} onPress={() => onSelectLobby(item)} />}
          />
        </GestureDetector>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function SearchResult({ lobby, active, onPress }: { lobby: DemoLobby; active: boolean; onPress: () => void }) {
  const { t } = useI18n();
  const { session } = useHomeExperience();
  const joined = isLobbyJoined(lobby, session);
  return (
    <Pressable
      testID={`search-result-${lobby.id}`}
      accessibilityRole="button"
      accessibilityLabel={t(lobby.titleKey)}
      accessibilityHint={t('home.openLobby')}
      disabled={!active}
      tabIndex={active ? 0 : -1}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Image source={photos[lobby.photo]} style={styles.photo} accessible={false} />
      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}>
          <Text numberOfLines={1} style={styles.cardTitle}>{t(lobby.titleKey)}</Text>
          <LobbyExtroversionIndicator lobby={lobby} size={32} />
        </View>
        <Text numberOfLines={1} style={styles.venue}>{lobby.placeKey ? t(lobby.placeKey) : lobby.place}</Text>
        <Text numberOfLines={1} style={styles.meta}>{t(lobby.metaKey)}</Text>
        <View style={styles.cardFooter}>
          {joined ? <Text style={styles.joined}>{t('home.joined')}</Text> : <View />}
          <View style={styles.members}>
            <Feather name="users" size={12} color={colors.muted} />
            <Text style={styles.memberCount}>{getLobbyMembers(lobby, session)} / {lobby.capacity}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 22 },
  backButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.white, fontSize: 26, lineHeight: 32, fontWeight: '800', letterSpacing: -0.7 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, marginHorizontal: 18, paddingLeft: 17, paddingRight: 5, marginBottom: 24, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 27 },
  inputFocused: { borderColor: '#454E53' },
  input: { flex: 1, minWidth: 0, color: colors.white, fontSize: 16, paddingVertical: 14, paddingRight: 8, ...Platform.select({ web: { outlineStyle: 'solid' as const, outlineWidth: 0, outlineColor: 'transparent' } }) },
  clearButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 18, paddingBottom: 30, flexGrow: 1 },
  resultsHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  count: { color: colors.muted, fontSize: 12, fontWeight: '600', backgroundColor: colors.surfaceRaised, minWidth: 28, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 5, textAlign: 'center', overflow: 'hidden' },
  separator: { height: 10 },
  card: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 20, padding: 12, minHeight: 112 },
  photo: { width: 64, height: 74, borderRadius: 14, backgroundColor: colors.surfaceRaised },
  cardBody: { flex: 1, minWidth: 0, gap: 5 },
  cardTitleRow: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 7 },
  cardTitle: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  venue: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  meta: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  joined: { flexShrink: 1, color: colors.success, fontSize: 10, lineHeight: 15 },
  members: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  memberCount: { color: colors.muted, fontSize: 10, fontVariant: ['tabular-nums'] },
  empty: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 28, paddingBottom: 20 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  emptyDescription: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 260 },
  resetButton: { minHeight: 44, paddingHorizontal: 20, justifyContent: 'center', marginTop: 18, borderRadius: 22, backgroundColor: colors.surfaceRaised },
  resetText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
