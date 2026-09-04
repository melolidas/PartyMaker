import { TranslationKey } from '../../i18n/translations';

export type DemoLobby = {
  id: string;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  metaKey: TranslationKey;
  category: 'drinks' | 'gaming' | 'food' | 'sport' | 'movies' | 'outdoors';
  photo: 'party' | 'basketball' | 'cinema' | 'hiking';
  place: string;
  placeKey?: TranslationKey;
  startsAfterMs: number;
  members: number;
  capacity: number;
  groupExtroversionLevel: number;
  isYours?: boolean;
};

const MINUTE = 60 * 1000;
export const demoLobbies: readonly DemoLobby[] = [
  { id: 'beer', titleKey: 'demo.beer', descriptionKey: 'demo.lobbyDescription', metaKey: 'demo.beerMeta', category: 'drinks', photo: 'party', place: 'Bar Campus', startsAfterMs: 180 * MINUTE, members: 4, capacity: 6, groupExtroversionLevel: 8, isYours: true },
  { id: 'cs2', titleKey: 'demo.cs2', descriptionKey: 'demo.cs2Description', metaKey: 'demo.cs2Meta', category: 'gaming', photo: 'cinema', place: '', placeKey: 'home.online', startsAfterMs: 300 * MINUTE, members: 3, capacity: 5, groupExtroversionLevel: 4, isYours: true },
  { id: 'pizza', titleKey: 'demo.pizza', descriptionKey: 'demo.pizzaDescription', metaKey: 'demo.pizzaMeta', category: 'food', photo: 'party', place: 'Chanti Pizza', startsAfterMs: 135 * MINUTE, members: 3, capacity: 6, groupExtroversionLevel: 6.5 },
  { id: 'basketball', titleKey: 'demo.basketball', descriptionKey: 'demo.basketballDescription', metaKey: 'demo.basketballMeta', category: 'sport', photo: 'basketball', place: 'Arena North', startsAfterMs: 45 * MINUTE, members: 7, capacity: 10, groupExtroversionLevel: 9.5 },
  { id: 'cinema', titleKey: 'demo.cinema', descriptionKey: 'demo.cinemaDescription', metaKey: 'demo.cinemaMeta', category: 'movies', photo: 'cinema', place: 'IMAX Bishkek Park', startsAfterMs: 330 * MINUTE, members: 4, capacity: 6, groupExtroversionLevel: 5 },
  { id: 'hike', titleKey: 'demo.hike', descriptionKey: 'demo.hikeDescription', metaKey: 'demo.hikeMeta', category: 'outdoors', photo: 'hiking', place: '', placeKey: 'demo.hikePlace', startsAfterMs: 27 * 60 * MINUTE, members: 3, capacity: 5, groupExtroversionLevel: 2.5 },
];

export type HomeSession = { startedAt: number; joinedIds: readonly string[] };
export function isLobbyJoined(lobby: DemoLobby, session: HomeSession): boolean {
  return Boolean(lobby.isYours || session.joinedIds.includes(lobby.id));
}

export function getJoinedLobbies(lobbies: readonly DemoLobby[], session: HomeSession): DemoLobby[] {
  return lobbies.filter((lobby) => isLobbyJoined(lobby, session));
}

export function getLobbyMembers(lobby: DemoLobby, session: HomeSession): number {
  return lobby.members + (!lobby.isYours && session.joinedIds.includes(lobby.id) ? 1 : 0);
}

export function joinDemoLobby(session: HomeSession, lobby: DemoLobby, now: number): HomeSession {
  if (isLobbyJoined(lobby, session)
    || getLobbyMembers(lobby, session) >= lobby.capacity
    || now >= session.startedAt + lobby.startsAfterMs) return session;
  return { ...session, joinedIds: [...session.joinedIds, lobby.id] };
}
