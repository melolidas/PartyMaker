import { Image, ImageSourcePropType, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { photos } from '../assets';
import { Avatar, Divider, IconButton } from '../components/Primitives';
import { Screen } from '../components/Screen';
import { colors, radius } from '../theme';

export function MomentsScreen() {
  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Moments</Text>
        <IconButton name="share" style={styles.shareButton} />
      </View>
      <View style={styles.tabs}>
        <Pressable style={[styles.tab, styles.tabActive]}>
          <Text style={styles.tabTextActive}>For you</Text>
        </Pressable>
        <Pressable style={styles.tab}>
          <Text style={styles.tabText}>Following</Text>
        </Pressable>
      </View>
      <Divider />

      <MomentCard
        author="alex"
        label="Pizza & chill  ·  Aug 24"
        image={photos.party}
        caption="Had an amazing time! Great people, good pizza and even better vibes ✌️"
        likes="24"
        comments="7"
      />
      <MomentCard
        author="marina"
        label="Hiking mountains  ·  Aug 23"
        image={photos.hiking}
        caption="Weekend well spent ⛰️🤍"
        likes="32"
        comments="5"
      />
    </Screen>
  );
}

function MomentCard({
  author,
  label,
  image,
  caption,
  likes,
  comments,
}: {
  author: string;
  label: string;
  image: ImageSourcePropType;
  caption: string;
  likes: string;
  comments: string;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.userRow}>
        <Avatar label={author.slice(0, 1).toUpperCase()} size={36} />
        <View style={styles.userText}>
          <Text style={styles.author}>{author}</Text>
          <Text style={styles.meta}>{label}</Text>
        </View>
        <Feather name="more-horizontal" size={20} color={colors.muted} />
      </View>
      <Image source={image} style={styles.photo} />
      <Text style={styles.caption}>{caption}</Text>
      <View style={styles.actions}>
        <View style={styles.actionLeft}>
          <Action icon="heart" value={likes} />
          <Action icon="message-circle" value={comments} />
        </View>
        <Feather name="send" size={20} color={colors.text} />
      </View>
    </View>
  );
}

function Action({ icon, value }: { icon: 'heart' | 'message-circle'; value: string }) {
  return (
    <View style={styles.action}>
      <Feather name={icon} size={21} color={colors.text} />
      <Text style={styles.actionValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  shareButton: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabs: {
    flexDirection: 'row',
    marginTop: 16,
  },
  tab: {
    width: 100,
    height: 40,
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
  card: {
    paddingTop: 16,
    paddingBottom: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  userText: {
    flex: 1,
    marginLeft: 10,
    gap: 2,
  },
  author: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  meta: {
    color: colors.muted,
    fontSize: 11,
  },
  photo: {
    width: '100%',
    height: 245,
    borderRadius: radius.medium,
    backgroundColor: colors.surface,
  },
  caption: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 15,
    paddingHorizontal: 2,
  },
  actionLeft: {
    flexDirection: 'row',
    gap: 26,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  actionValue: {
    color: colors.text,
    fontSize: 13,
  },
});
