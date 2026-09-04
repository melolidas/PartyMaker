import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { photos } from '../assets';
import { IconButton } from '../components/Primitives';
import { Screen } from '../components/Screen';
import { useI18n } from '../i18n/LocalizationProvider';
import { colors, radius } from '../theme';

type IconName = React.ComponentProps<typeof Feather>['name'];

export function CreateLobbyScreen({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const title = t('demo.beer');
  const description = t('demo.lobbyDescription');
  return (
    <Screen contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <IconButton name="x" accessibilityLabel={t('a11y.close')} onPress={onClose} />
        <Text style={styles.headerTitle}>{t('nav.create')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.photoRow}>
        <View style={styles.selectedPhoto}>
          <Image source={photos.party} style={styles.photoImage} />
        </View>
        <Pressable style={styles.addPhoto}>
          <Feather name="camera" size={25} color={colors.text} />
          <Text style={styles.addPhotoText}>{t('create.addPhoto')}</Text>
        </Pressable>
      </View>

      <View style={styles.inputCard}>
        <Text style={styles.label}>{t('create.title')}</Text>
        <View style={styles.inlineValue}>
          <Text style={[styles.value, styles.titleValue]}>{title}</Text>
          <Text style={styles.counter}>{Array.from(title).length}/40</Text>
        </View>
      </View>

      <View style={[styles.inputCard, styles.descriptionCard]}>
        <Text style={styles.label}>{t('create.description')}</Text>
        <Text style={styles.value}>{description}</Text>
        <Text style={styles.counterBottom}>{Array.from(description).length}/200</Text>
      </View>

      <View style={styles.inputCard}>
        <Text style={styles.label}>{t('create.category')}</Text>
        <FieldRow text={t('category.drinks')} />
      </View>

      <View style={styles.groupCard}>
        <FieldRow icon="map-pin" text="Bar Campus" hint={t('create.location')} />
        <View style={styles.groupDivider} />
        <FieldRow icon="calendar" text={t('demo.todayAug25')} />
        <View style={styles.groupDivider} />
        <FieldRow icon="clock" text={t('create.time')} muted />
      </View>

      <View style={styles.peopleCard}>
        <View style={styles.peopleTop}>
          <View style={styles.peopleLabel}>
            <Feather name="users" size={17} color={colors.muted} />
            <Text style={styles.peopleText}>{t('create.maxPeople')}</Text>
          </View>
          <View style={styles.counterControl}>
            <Pressable style={styles.circleButton} accessibilityRole="button" accessibilityLabel={t('a11y.fewerPeople')}>
              <Feather name="minus" size={17} color={colors.text} />
            </Pressable>
            <Text style={styles.count}>6</Text>
            <Pressable style={styles.circleButton} accessibilityRole="button" accessibilityLabel={t('a11y.morePeople')}>
              <Feather name="plus" size={17} color={colors.text} />
            </Pressable>
          </View>
        </View>
        <Text style={styles.minimum}>{t('create.minimum')}</Text>
      </View>

      <Pressable style={styles.primaryButton}>
        <Text style={styles.primaryText}>{t('nav.create')}</Text>
      </Pressable>
    </Screen>
  );
}

function FieldRow({
  icon,
  text,
  hint,
  muted,
}: {
  icon?: IconName;
  text: string;
  hint?: string;
  muted?: boolean;
}) {
  return (
    <View style={styles.fieldRow}>
      {icon ? <Feather name={icon} size={17} color={colors.muted} /> : null}
      <View style={styles.fieldTextWrap}>
        {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
        <Text style={[styles.fieldText, muted && styles.mutedText]}>{text}</Text>
      </View>
      <Feather name="chevron-right" size={19} color={colors.text} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 36,
  },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  headerSpacer: {
    width: 38,
  },
  photoRow: {
    height: 138,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  selectedPhoto: {
    flex: 1.35,
    height: '100%',
    borderRadius: radius.medium,
    overflow: 'hidden',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  addPhoto: {
    flex: 1,
    borderRadius: radius.medium,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#3A4043',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  addPhotoText: {
    color: colors.muted,
    fontSize: 12,
  },
  inputCard: {
    minHeight: 70,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.medium,
    padding: 14,
    marginBottom: 10,
  },
  descriptionCard: {
    minHeight: 104,
    paddingBottom: 30,
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    marginBottom: 8,
  },
  inlineValue: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleValue: {
    flex: 1,
  },
  value: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  counter: {
    color: colors.subtle,
    fontSize: 11,
  },
  counterBottom: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    color: colors.subtle,
    fontSize: 11,
  },
  fieldRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  fieldTextWrap: {
    flex: 1,
    gap: 4,
  },
  fieldHint: {
    color: colors.muted,
    fontSize: 11,
  },
  fieldText: {
    color: colors.text,
    fontSize: 14,
  },
  mutedText: {
    color: colors.muted,
  },
  groupCard: {
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  groupDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: 28,
  },
  peopleCard: {
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surface,
    padding: 14,
    marginBottom: 34,
  },
  peopleTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  peopleLabel: {
    flex: 1,
    marginRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  peopleText: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: 13,
  },
  counterControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  circleButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22272A',
  },
  count: {
    minWidth: 12,
    color: colors.text,
    fontSize: 14,
    textAlign: 'center',
  },
  minimum: {
    color: colors.subtle,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 12,
  },
  primaryButton: {
    height: 54,
    backgroundColor: colors.text,
    borderRadius: radius.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: colors.black,
    fontSize: 15,
    fontWeight: '800',
  },
});
