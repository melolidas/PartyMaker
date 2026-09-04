import { TranslationKey } from '../../i18n/translations';
import { DemoLobby } from '../home/lobbies';

export type ConversationAuthor = 'alex' | 'john' | 'marina' | 'kate' | 'you';
export type ConversationContext = DemoLobby['category'] | 'archivedCinema' | 'archivedHike' | 'generic';

export type MockFixtureMessage = {
  id: string;
  kind: 'fixture';
  author: ConversationAuthor;
  textKey: TranslationKey;
  time: string;
};

export type MockLocalMessage = {
  id: string;
  kind: 'local';
  author: 'you';
  text: string;
  createdAt: number;
};

export type MockConversationMessage = MockFixtureMessage | MockLocalMessage;
export type MockChatThread = { draft: string; messages: readonly MockLocalMessage[] };
export type MockChatState = Readonly<Record<string, MockChatThread>>;

export const MAX_MOCK_MESSAGE_LENGTH = 2000;
const EMPTY_THREAD: MockChatThread = { draft: '', messages: [] };

type FixtureSpec = readonly [ConversationAuthor, TranslationKey, string];
const fixtures: Record<ConversationContext, readonly FixtureSpec[]> = {
  drinks: [
    ['alex', 'conversation.drinks.1', '17:02'],
    ['marina', 'conversation.drinks.2', '17:04'],
    ['you', 'conversation.drinks.3', '17:05'],
    ['alex', 'conversation.drinks.4', '17:06'],
    ['marina', 'conversation.drinks.5', '17:08'],
  ],
  gaming: [
    ['john', 'conversation.gaming.1', '18:10'],
    ['alex', 'conversation.gaming.2', '18:11'],
    ['you', 'conversation.gaming.3', '18:12'],
    ['john', 'conversation.gaming.4', '18:14'],
    ['alex', 'conversation.gaming.5', '18:15'],
  ],
  food: [
    ['marina', 'conversation.food.1', '16:20'],
    ['kate', 'conversation.food.2', '16:22'],
    ['you', 'conversation.food.3', '16:23'],
    ['marina', 'conversation.food.4', '16:24'],
    ['kate', 'conversation.food.5', '16:25'],
  ],
  sport: [
    ['alex', 'conversation.sport.1', '15:10'],
    ['john', 'conversation.sport.2', '15:12'],
    ['you', 'conversation.sport.3', '15:13'],
    ['alex', 'conversation.sport.4', '15:15'],
    ['john', 'conversation.sport.5', '15:16'],
  ],
  movies: [
    ['marina', 'conversation.movies.1', '18:01'],
    ['kate', 'conversation.movies.2', '18:03'],
    ['you', 'conversation.movies.3', '18:04'],
    ['marina', 'conversation.movies.4', '18:06'],
    ['kate', 'conversation.movies.5', '18:07'],
  ],
  outdoors: [
    ['kate', 'conversation.outdoors.1', '19:10'],
    ['alex', 'conversation.outdoors.2', '19:12'],
    ['you', 'conversation.outdoors.3', '19:14'],
    ['kate', 'conversation.outdoors.4', '19:15'],
    ['alex', 'conversation.outdoors.5', '19:17'],
  ],
  archivedCinema: [
    ['marina', 'conversation.archivedCinema.1', '22:14'],
    ['kate', 'conversation.archivedCinema.2', '22:16'],
    ['you', 'conversation.archivedCinema.3', '22:17'],
    ['marina', 'conversation.archivedCinema.4', '22:20'],
    ['kate', 'conversation.archivedCinema.5', '22:21'],
  ],
  archivedHike: [
    ['kate', 'conversation.archivedHike.1', '17:34'],
    ['alex', 'conversation.archivedHike.2', '17:36'],
    ['you', 'conversation.archivedHike.3', '17:38'],
    ['kate', 'conversation.archivedHike.4', '17:41'],
    ['alex', 'conversation.archivedHike.5', '17:42'],
  ],
  generic: [
    ['alex', 'conversation.generic.1', '17:02'],
    ['marina', 'conversation.generic.2', '17:04'],
    ['you', 'conversation.generic.3', '17:05'],
    ['alex', 'conversation.generic.4', '17:06'],
  ],
};

export function getMockConversationContext(lobby: Pick<DemoLobby, 'id' | 'category'>): ConversationContext {
  // Historical meetings are distinct chats, not aliases of the upcoming ones.
  if (lobby.id === 'inactive-cinema') return 'archivedCinema';
  if (lobby.id === 'inactive-hike') return 'archivedHike';
  return Object.prototype.hasOwnProperty.call(fixtures, lobby.category) ? lobby.category : 'generic';
}

export function getMockConversation(lobby: Pick<DemoLobby, 'id' | 'category'>): readonly MockFixtureMessage[] {
  const context = getMockConversationContext(lobby);
  return fixtures[context].map(([author, textKey, time], index) => ({
    id: `${lobby.id}-fixture-${index}`,
    kind: 'fixture',
    author,
    textKey,
    time,
  }));
}

export function getMockChatThread(state: MockChatState, lobbyId: string): MockChatThread {
  return Object.prototype.hasOwnProperty.call(state, lobbyId) ? state[lobbyId] : EMPTY_THREAD;
}

export function updateMockChatDraft(state: MockChatState, lobbyId: string, value: string): MockChatState {
  const thread = getMockChatThread(state, lobbyId);
  const draft = value.slice(0, MAX_MOCK_MESSAGE_LENGTH);
  if (draft === thread.draft) return state;
  return { ...state, [lobbyId]: { ...thread, draft } };
}

export function sendMockChatMessage(state: MockChatState, lobbyId: string, now: number): MockChatState {
  const thread = getMockChatThread(state, lobbyId);
  const text = thread.draft.slice(0, MAX_MOCK_MESSAGE_LENGTH).trim();
  if (!text) return state;
  const message: MockLocalMessage = {
    id: `${lobbyId}-local-${now}-${thread.messages.length}`,
    kind: 'local',
    author: 'you',
    text,
    createdAt: now,
  };
  return { ...state, [lobbyId]: { draft: '', messages: [...thread.messages, message] } };
}
