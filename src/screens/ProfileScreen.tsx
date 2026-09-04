import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import { LinearGradient } from 'expo-linear-gradient';
import { AccessibilityInfo, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { photos } from '../assets';
import { IconButton } from '../components/Primitives';
import { Screen } from '../components/Screen';
import { ExtroversionGauge } from '../features/profile/ExtroversionGauge';
import {
  DEFAULT_EXTROVERSION_LEVEL,
  EXTROVERSION_STORAGE_KEY,
  getExtroversionBand,
  getExtroversionVisual,
  normalizeExtroversionLevel,
  parseStoredExtroversionLevel,
} from '../features/profile/extroversion';
import { useI18n } from '../i18n/LocalizationProvider';
import { TranslationKey } from '../i18n/translations';
import { colors, radius } from '../theme';

const gallery = [
  photos.party,
  photos.basketball,
  photos.hiking,
  photos.party,
  photos.cinema,
  photos.party,
  photos.hiking,
  photos.basketball,
  photos.cinema,
];

export function ProfileScreen() {
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const gaugeSize = 56;
  const [level, setLevel] = useState(DEFAULT_EXTROVERSION_LEVEL);
  const [draftLevel, setDraftLevel] = useState(DEFAULT_EXTROVERSION_LEVEL);
  const [editing, setEditing] = useState(false);
  const visibleLevel = editing ? draftLevel : level;
  const visual = getExtroversionVisual(visibleLevel);
  const band = getExtroversionBand(visibleLevel);
  const bandKey: Record<typeof band, TranslationKey> = {
    introvert: 'profile.introvert',
    ambivert: 'profile.ambivert',
    extrovert: 'profile.extrovert',
  };
  const bandLabel = t(bandKey[band]);
  const gaugeLabel = `${t('profile.extroversion')}: ${bandLabel}`;

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(EXTROVERSION_STORAGE_KEY)
      .then((storedLevel) => {
        if (!mounted) return;
        const savedLevel = parseStoredExtroversionLevel(storedLevel);
        setLevel(savedLevel);
        setDraftLevel(savedLevel);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const openEditor = () => {
    setDraftLevel(level);
    setEditing(true);
  };

  const cancelEditor = () => {
    setDraftLevel(level);
    setEditing(false);
  };

  const saveLevel = () => {
    const nextLevel = normalizeExtroversionLevel(draftLevel);
    setLevel(nextLevel);
    setDraftLevel(nextLevel);
    setEditing(false);
    void AsyncStorage.setItem(EXTROVERSION_STORAGE_KEY, String(nextLevel)).catch(() => {});
    AccessibilityInfo.announceForAccessibility(t('profile.saved'));
  };

  return (
    <Screen contentContainerStyle={styles.content}>
      <View style={styles.topBar}>
        <View />
        <IconButton name="settings" accessibilityLabel={t('a11y.settings')} />
      </View>

      <View style={styles.profileHeader}>
        <View style={styles.avatarWrap}>
          <Image source={photos.party} style={styles.avatar} />
          <Pressable style={styles.editButton} accessibilityRole="button" accessibilityLabel={t('a11y.editProfile')}>
            <Feather name="edit-2" size={13} color={colors.text} />
          </Pressable>
        </View>
        <View style={styles.identity}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={[styles.name, width < 360 && styles.nameCompact]}>{t('demo.profileName')}</Text>
          <Text numberOfLines={2} style={styles.location}>{t('demo.profileLocation')}</Text>
        </View>
        <View style={styles.extroversionSummary}>
          <ExtroversionGauge
            testID="profile-extroversion-gauge"
            level={visibleLevel}
            size={gaugeSize}
            accessibilityLabel={gaugeLabel}
          />
          <View style={styles.gaugeFooter}>
            <Pressable
              testID="profile-edit-extroversion"
              accessibilityRole="button"
              accessibilityLabel={t(editing ? 'profile.cancelExtroversion' : 'profile.editExtroversion')}
              onPress={editing ? cancelEditor : openEditor}
              style={({ pressed }) => [styles.editExtroversionButton, pressed && styles.pressed]}
            >
              <Text style={styles.editExtroversionText}>{t(editing ? 'profile.cancelExtroversion' : 'profile.editExtroversion')}</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {editing ? (
        <View testID="extroversion-editor" style={styles.extroversionEditor}>
          <View style={styles.editorHeader}>
            <View style={styles.editorHeading}>
              <Text style={styles.editorTitle}>{t('profile.extroversion')}</Text>
              <Text testID="extroversion-band" style={[styles.editorBand, { color: visual.color }]}>{bandLabel}</Text>
            </View>
          </View>

          <View style={styles.sliderShell}>
            <LinearGradient
              pointerEvents="none"
              colors={['#47C7FF', '#567BFF', '#8750FF', '#D238DC', '#F72567', '#FF3B30']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.sliderSpectrum}
            />
            <Slider
              testID="extroversion-slider"
              accessibilityLabel={t('profile.extroversion')}
              accessibilityValue={{ min: 1, max: 10, now: visibleLevel, text: gaugeLabel }}
              minimumValue={1}
              maximumValue={10}
              step={0.5}
              value={draftLevel}
              onValueChange={(value) => setDraftLevel(normalizeExtroversionLevel(value))}
              minimumTrackTintColor="transparent"
              maximumTrackTintColor="transparent"
              thumbTintColor={visual.color}
              tapToSeek
              style={styles.slider}
            />
          </View>

          <View style={styles.scaleLabels}>
            <View style={styles.scaleLabelItem}>
              <Text style={styles.scaleLabel}>{t('profile.introvert')}</Text>
            </View>
            <View style={[styles.scaleLabelItem, styles.scaleLabelCenter]}>
              <Text style={styles.scaleLabel}>{t('profile.ambivert')}</Text>
            </View>
            <View style={[styles.scaleLabelItem, styles.scaleLabelRight]}>
              <Text style={styles.scaleLabel}>{t('profile.extrovert')}</Text>
            </View>
          </View>

          <View style={styles.editorActions}>
            <Pressable accessibilityRole="button" onPress={cancelEditor} style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}>
              <Text style={styles.cancelText}>{t('profile.cancelExtroversion')}</Text>
            </Pressable>
            <Pressable testID="save-extroversion" accessibilityRole="button" onPress={saveLevel} style={({ pressed }) => [styles.saveButton, { backgroundColor: visual.color }, pressed && styles.pressed]}>
              <Text style={styles.saveText}>{t('profile.saveExtroversion')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View testID="profile-stats" style={styles.stats}>
        <Stat value="24" label={t('nav.moments')} />
        <Stat value="18" label={t('common.lobbies')} />
        <Stat value="128" label={t('common.likes')} />
      </View>

      <View style={styles.tabs}>
        <Pressable style={[styles.tab, styles.tabActive]}>
          <Text style={styles.tabTextActive}>{t('nav.moments')}</Text>
        </Pressable>
        <Pressable style={styles.tab}>
          <Text style={styles.tabText}>{t('common.lobbies')}</Text>
        </Pressable>
      </View>

      <View style={styles.gallery}>
        {gallery.map((image, index) => (
          <View key={index} style={styles.galleryTile}>
            <Image source={image} style={styles.galleryImage} />
          </View>
        ))}
      </View>
    </Screen>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 12,
  },
  topBar: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    marginTop: 4,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 94,
    height: 94,
    borderRadius: 47,
    borderWidth: 1,
    borderColor: colors.border,
  },
  editButton: {
    position: 'absolute',
    right: 0,
    bottom: 2,
    width: 31,
    height: 31,
    borderRadius: 16,
    backgroundColor: '#4A4F52',
    alignItems: 'center',
    justifyContent: 'center',
  },
  identity: {
    flex: 1,
    minWidth: 0,
    marginLeft: 16,
    marginRight: 8,
    gap: 5,
  },
  name: {
    color: colors.text,
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  nameCompact: {
    fontSize: 20,
    lineHeight: 25,
  },
  location: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  extroversionSummary: {
    width: 72,
    alignItems: 'center',
    flexShrink: 0,
  },
  gaugeFooter: {
    width: '100%',
    marginTop: -3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editExtroversionButton: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  editExtroversionText: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  extroversionEditor: {
    marginHorizontal: 6,
    marginTop: 16,
    padding: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  editorHeading: {
    gap: 3,
  },
  editorTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
  },
  editorBand: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  sliderShell: {
    height: 40,
    justifyContent: 'center',
  },
  sliderSpectrum: {
    position: 'absolute',
    left: 13,
    right: 13,
    height: 7,
    borderRadius: 4,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  scaleLabels: {
    flexDirection: 'row',
    marginTop: 4,
  },
  scaleLabelItem: {
    flex: 1,
    alignItems: 'flex-start',
  },
  scaleLabelCenter: {
    alignItems: 'center',
  },
  scaleLabelRight: {
    alignItems: 'flex-end',
  },
  scaleLabel: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 14,
  },
  editorActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  cancelButton: {
    flex: 0.82,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1.18,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.7,
  },
  stats: {
    flexDirection: 'row',
    marginTop: 18,
    marginBottom: 16,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  statValue: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  statLabel: {
    color: colors.muted,
    fontSize: 12,
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.text,
  },
  tabText: {
    color: colors.muted,
    fontSize: 13,
  },
  tabTextActive: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  gallery: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  galleryTile: {
    width: '32.55%',
    aspectRatio: 1,
    borderRadius: radius.small,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  galleryImage: {
    width: '100%',
    height: '100%',
  },
});
