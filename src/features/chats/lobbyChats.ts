import { TranslationKey } from '../../i18n/translations';
import { DemoLobby, HomeSession, demoLobbies, isLobbyJoined } from '../home/lobbies';

export type LobbyChat = {
  lobby: DemoLobby;
  previewKey: TranslationKey;
  timeKey?: TranslationKey;
};

export type ChatStatus = 'active' | 'inactive';

// Separate historical demo instances: they must not become joined Home cards.
const inactiveDemoChats: readonly LobbyChat[] = demoLobbies
  .filter((lobby) => lobby.id === 'cinema' || lobby.id === 'hike')
  .map((lobby) => ({
    lobby: { ...lobby, id: `inactive-${lobby.id}`, startsAfterMs: -7 * 24 * 60 * 60 * 1000, isYours: true },
    previewKey: lobby.id === 'cinema' ? 'chats.cinemaFinished' : 'chats.hikeFinished',
    timeKey: lobby.id === 'cinema' ? 'common.yesterday' : 'chats.lastWeek',
  }));

export function getLobbyChatGroups(session: HomeSession): Record<ChatStatus, readonly LobbyChat[]> {
  // In this prototype, status is explicit. Starting an event is not ending it.
  return { active: getLobbyChats(session), inactive: inactiveDemoChats };
}

// Membership, not the event start time, determines which chats stay in the list.
// These are presentation-only previews: no messages are sent or received yet.
export function getLobbyChats(session: HomeSession): LobbyChat[] {
  return demoLobbies.filter((lobby) => isLobbyJoined(lobby, session)).map((lobby) => {
    if (lobby.id === 'beer') return { lobby, previewKey: 'chats.beerPreview', timeKey: 'time.2m' };
    if (lobby.id === 'cs2') return { lobby, previewKey: 'chats.cs2Preview', timeKey: 'time.15m' };
    return { lobby, previewKey: 'chats.noMessages' };
  });
}
