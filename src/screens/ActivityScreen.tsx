import { Image, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { photos } from '../assets';
import { Avatar } from '../components/Primitives';
import { Screen } from '../components/Screen';
import { colors } from '../theme';

type Notification = {
  user: string;
  text: string;
  context: string;
  time: string;
  image?: keyof typeof photos;
  dot?: boolean;
};

const groups: { title: string; items: Notification[] }[] = [
  {
    title: 'New',
    items: [
      { user: 'alex', text: 'joined your lobby', context: 'Beer tonight', time: '2m', dot: true },
      {
        user: 'marina',
        text: 'commented on your moment',
        context: 'Pizza & chill',
        time: '15m',
        image: 'party',
      },
      { user: 'dan', text: 'liked your moment', context: 'Pizza & chill', time: '23m', image: 'party' },
      { user: 'john', text: 'invited you to join', context: 'CS2 squad', time: '35m', image: 'cinema' },
    ],
  },
  {
    title: 'Today',
    items: [
      { user: 'kate', text: 'joined your lobby', context: 'Basketball', time: '1h' },
      {
        user: 'tim',
        text: 'commented on your moment',
        context: 'Hiking mountains',
        time: '2h',
        image: 'hiking',
      },
      { user: 'anna', text: 'liked your moment', context: 'Hiking mountains', time: '3h', image: 'hiking' },
    ],
  },
  {
    title: 'Yesterday',
    items: [
      { user: 'max', text: 'joined your lobby', context: 'Cinema night', time: 'Yesterday' },
    ],
  },
];

export function ActivityScreen() {
  return (
    <Screen>
      <Text style={styles.title}>Activity</Text>
      {groups.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text style={styles.groupTitle}>{group.title}</Text>
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
  return (
    <View style={styles.row}>
      <View>
        <Avatar label={item.user.slice(0, 1).toUpperCase()} size={43} />
        {item.dot ? <View style={styles.onlineDot} /> : null}
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.message}>
          <Text style={styles.user}>{item.user}</Text> {item.text}
        </Text>
        <View style={styles.contextRow}>
          <Text style={styles.context}>{item.context}</Text>
          <Text style={styles.time}>{item.time}</Text>
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
