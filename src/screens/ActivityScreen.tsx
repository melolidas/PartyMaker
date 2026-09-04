import { Image, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { photos } from '../assets';
import { Avatar } from '../components/Primitives';
import { Screen } from '../components/Screen';
import { useI18n } from '../i18n/LocalizationProvider';
import { TranslationKey } from '../i18n/translations';
import { colors } from '../theme';

type Notification = {
  user: string;
  text: TranslationKey;
  context: TranslationKey;
  time: TranslationKey;
  image?: keyof typeof photos;
  dot?: boolean;
};

const groups: { title: TranslationKey; items: Notification[] }[] = [
  {
    title: 'activity.new',
    items: [
      { user: 'alex', text: 'activity.joinedMale', context: 'demo.beer', time: 'time.2m', dot: true },
      {
        user: 'marina',
        text: 'activity.commentedFemale',
        context: 'demo.pizza',
        time: 'time.15m',
        image: 'party',
      },
      { user: 'dan', text: 'activity.likedMale', context: 'demo.pizza', time: 'time.23m', image: 'party' },
      { user: 'john', text: 'activity.invited', context: 'demo.cs2', time: 'time.35m', image: 'cinema' },
    ],
  },
  {
    title: 'common.today',
    items: [
      { user: 'kate', text: 'activity.joinedFemale', context: 'demo.basketball', time: 'time.1h' },
      {
        user: 'tim',
        text: 'activity.commentedMale',
        context: 'demo.hikingMountains',
        time: 'time.2h',
        image: 'hiking',
      },
      { user: 'anna', text: 'activity.likedFemale', context: 'demo.hikingMountains', time: 'time.3h', image: 'hiking' },
    ],
  },
  {
    title: 'common.yesterday',
    items: [
      { user: 'max', text: 'activity.joinedMale', context: 'demo.cinema', time: 'common.yesterday' },
    ],
  },
];

export function ActivityScreen() {
  const { t } = useI18n();
  return (
    <Screen>
      <Text style={styles.title}>{t('nav.activity')}</Text>
      {groups.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text style={styles.groupTitle}>{t(group.title)}</Text>
          <View style={styles.groupLine} />
          {group.items.map((item) => (
            <NotificationRow key={`${item.user}-${item.time}`} item={item} />
          ))}
        </View>
      ))}
    </Screen>
  );
}

function NotificationRow({ item }: { item: Notification }) {
  const { t } = useI18n();
  return (
    <View style={styles.row}>
      <View>
        <Avatar label={item.user.slice(0, 1).toUpperCase()} size={43} />
        {item.dot ? <View style={styles.onlineDot} /> : null}
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.message}>
          <Text style={styles.user}>{item.user}</Text> {t(item.text)}
        </Text>
        <View style={styles.contextRow}>
          <Text style={styles.context}>{t(item.context)}</Text>
          <Text style={styles.time}>{t(item.time)}</Text>
        </View>
      </View>
      {item.image ? (
        <Image source={photos[item.image]} style={styles.preview} />
      ) : (
        <Feather name="more-vertical" size={18} color={colors.muted} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.6,
    marginBottom: 16,
  },
  group: {
    marginBottom: 20,
  },
  groupTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
  },
  groupLine: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  row: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  onlineDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    right: 0,
    bottom: 1,
    borderRadius: 4,
    backgroundColor: colors.text,
    borderWidth: 2,
    borderColor: colors.background,
  },
  rowBody: {
    flex: 1,
    paddingVertical: 10,
    gap: 5,
  },
  message: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  user: {
    fontWeight: '800',
  },
  contextRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  context: {
    color: colors.text,
    fontSize: 11,
  },
  time: {
    color: colors.muted,
    fontSize: 11,
  },
  preview: {
    width: 43,
    height: 43,
    borderRadius: 8,
  },
});
