import {
  Image,
  ImageSourcePropType,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { photos } from '../assets';
import { IconButton, Pill, SectionHeader } from '../components/Primitives';
import { Screen } from '../components/Screen';
import { colors, radius } from '../theme';

const nearby = [
  {
    title: 'Pizza & chill',
    description: "Let's eat some pizza",
    place: 'Chanti Pizza',
    meta: 'Today 19:00  ·  2.1 km',
    people: '3 / 6',
    image: photos.party,
  },
  {
    title: 'Basketball',
    description: 'Need 2 more players',
    place: 'Arena North',
    meta: 'Today 18:00  ·  1.3 km',
    people: '7 / 10',
    image: photos.basketball,
  },
  {
    title: 'Cinema night',
    description: 'Superman (2025)',
    place: 'IMAX Bishkek Park',
    meta: 'Tomorrow 20:30  ·  3.4 km',
    people: '4 / 6',
    image: photos.cinema,
  },
  {
    title: 'Weekend hike',
    description: 'Mountain views & coffee',
    place: 'Ala-Archa',
    meta: 'Sat 08:30  ·  32 km',
    people: '3 / 5',
    image: photos.hiking,
  },
];

export function HomeScreen() {
  return (
    <Screen>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Find people.</Text>
          <Text style={styles.title}>Do something together.</Text>
        </View>
        <View style={styles.headerActions}>
          <IconButton name="bell" />
          <IconButton name="sliders" />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
        <Pill active>All</Pill>
        <Pill>🍺 Drinks</Pill>
        <Pill>🎮 Gaming</Pill>
        <Pill>⚽ Sport</Pill>
        <Pill>🎬 Movies</Pill>
      </ScrollView>

      <SectionHeader title="Your lobbies" action="View all" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.yourList}
      >
        <MiniLobby image={photos.party} title="Beer tonight 🍺" subtitle="Bar Campus" meta="20:00  ·  4 / 6" />
        <MiniLobby image={photos.cinema} title="CS2 squad" subtitle="Inferno only" meta="22:00  ·  3 / 5" />
      </ScrollView>

      <SectionHeader title="Nearby lobbies" />
      <View style={styles.nearbyList}>
        {nearby.map((item) => (
          <NearbyLobby key={item.title} {...item} />
        ))}
      </View>
    </Screen>
  );
}

function MiniLobby({
  image,
  title,
  subtitle,
  meta,
}: {
  image: ImageSourcePropType;
  title: string;
  subtitle: string;
  meta: string;
}) {
  return (
    <View style={styles.miniCard}>
      <Image source={image} style={styles.miniImage} />
      <View style={styles.miniBody}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSub}>{subtitle}</Text>
        <Text style={styles.cardMeta}>{meta}</Text>
      </View>
    </View>
  );
}

function NearbyLobby({
  image,
  title,
  description,
  place,
  meta,
  people,
}: {
  image: ImageSourcePropType;
  title: string;
  description: string;
  place: string;
  meta: string;
  people: string;
}) {
  return (
    <View style={styles.nearbyCard}>
      <Image source={image} style={styles.nearbyImage} />
      <View style={styles.nearbyBody}>
        <Text style={styles.nearbyTitle}>{title}</Text>
        <Text style={styles.nearbyDescription}>{description}</Text>
        <Text style={styles.nearbyPlace}>{place}</Text>
        <Text style={styles.cardMeta}>{meta}</Text>
      </View>
      <View style={styles.people}>
        <Feather name="users" size={12} color={colors.muted} />
        <Text style={styles.peopleText}>{people}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    lineHeight: 29,
    letterSpacing: -0.7,
    fontWeight: '800',
  },
  headerActions: {
    flexDirection: 'row',
    marginTop: 2,
  },
  pills: {
    paddingRight: 18,
  },
  yourList: {
    gap: 10,
    paddingRight: 18,
  },
  miniCard: {
    width: 174,
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  miniImage: {
    width: '100%',
    height: 84,
  },
  miniBody: {
    padding: 12,
    gap: 4,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  cardSub: {
    color: colors.text,
    fontSize: 12,
  },
  cardMeta: {
    color: colors.muted,
    fontSize: 11,
  },
  nearbyList: {
    gap: 10,
  },
  nearbyCard: {
    minHeight: 102,
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
  },
  nearbyImage: {
    width: 102,
    height: 102,
  },
  nearbyBody: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 2,
  },
  nearbyTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  nearbyDescription: {
    color: colors.text,
    fontSize: 11,
  },
  nearbyPlace: {
    color: colors.muted,
    fontSize: 11,
  },
  people: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: 12,
    paddingBottom: 12,
  },
  peopleText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
});
