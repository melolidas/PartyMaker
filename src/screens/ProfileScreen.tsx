import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { photos } from '../assets';
import { IconButton, Pill } from '../components/Primitives';
import { Screen } from '../components/Screen';
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
  return (
    <Screen contentContainerStyle={styles.content}>
      <View style={styles.topBar}>
        <View />
        <IconButton name="settings" />
      </View>

      <View style={styles.profileHeader}>
        <View style={styles.avatarWrap}>
          <Image source={photos.party} style={styles.avatar} />
          <Pressable style={styles.editButton}>
            <Feather name="edit-2" size={13} color={colors.text} />
          </Pressable>
        </View>
        <View style={styles.identity}>
          <Text style={styles.name}>Khalid</Text>
          <Text style={styles.location}>Bishkek, Kyrgyzstan</Text>
        </View>
      </View>

      <View style={styles.interests}>
        <Pill>🎮 Gaming</Pill>
        <Pill>⚽ Sport</Pill>
        <Pill>🍕 Food</Pill>
        <Pill>🎬 Movies</Pill>
      </View>

      <View style={styles.stats}>
        <Stat value="24" label="Moments" />
        <Stat value="18" label="Lobbies" />
        <Stat value="128" label="Likes" />
      </View>

      <View style={styles.tabs}>
        <Pressable style={[styles.tab, styles.tabActive]}>
          <Text style={styles.tabTextActive}>Moments</Text>
        </Pressable>
        <Pressable style={styles.tab}>
          <Text style={styles.tabText}>Lobbies</Text>
        </Pressable>
      </View>

      <View style={styles.gallery}>
        {gallery.map((image, index) => (
          <Image key={index} source={image} style={styles.galleryImage} />
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
    marginLeft: 18,
    gap: 5,
  },
  name: {
    color: colors.text,
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  location: {
    color: colors.muted,
    fontSize: 12,
  },
  interests: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 6,
    marginTop: 22,
  },
  stats: {
    flexDirection: 'row',
    marginVertical: 22,
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
  galleryImage: {
    width: '32.55%',
    aspectRatio: 1,
    borderRadius: radius.small,
    backgroundColor: colors.surface,
  },
});
