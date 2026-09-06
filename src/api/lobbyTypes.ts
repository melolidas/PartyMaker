import type { Avatar } from './types';
import type { NotificationsApi } from './notificationTypes';

export type LobbyCategory = 'DRINKS' | 'GAMING' | 'FOOD' | 'SPORT' | 'MOVIES' | 'OUTDOORS';

/** User-authored strings, never translation keys or demo ids. */
export type Lobby = {
  id: string;
  title: string;
  description: string;
  category: LobbyCategory | null;
  startsAt: string;
  timeZone: string;
  isOnline: boolean;
  venueName: string | null;
  capacity: number;
  joinedCount: number;
  isJoined: boolean;
  membershipStatus: 'JOINED' | 'LEFT' | 'REMOVED' | null;
  isOrganizer: boolean;
  groupExtroversionLevel: number | null;
};

export type LobbyPage = { items: Lobby[]; nextCursor: string | null };
export type LobbyRecommendations = { items: Lobby[] };
/** Recorded JOINED participation by start time, not verified attendance/completion. */
export type LobbyHistoryItem = Pick<Lobby, 'id' | 'title' | 'description' | 'category' | 'startsAt' | 'timeZone' | 'isOnline' | 'venueName' | 'isOrganizer'>;
export type LobbyHistoryPage = { items: LobbyHistoryItem[]; nextCursor: string | null };
export type LobbyScope = 'all' | 'mine';
export type CreateLobbyInput = Pick<Lobby, 'title' | 'description' | 'startsAt' | 'timeZone' | 'capacity' | 'isOnline' | 'venueName'>;
export type UpdateLobbyInput = Partial<Pick<Lobby, 'title' | 'description' | 'capacity'>> & { category?: LobbyCategory } &
  ({ isOnline: boolean; venueName: string | null } | { isOnline?: never; venueName?: never });
export type LobbyMessage = {
  id: string; lobbyId: string; body: string; createdAt: string;
  author: { id: string; displayName: string; handle: string };
};
export type LobbyMessagePage = { items: LobbyMessage[]; nextCursor: string | null };
export type SendLobbyMessageInput = { clientMessageId: string; body: string };
export type ChatSummary = {
  lobby: Pick<Lobby, 'id' | 'title' | 'category'>;
  lastMessage: null | { id: string; preview: string; createdAt: string; author: { id: string; displayName: string } };
  activityAt: string;
};
export type ChatPage = { items: ChatSummary[]; nextCursor: string | null };
export type LobbyMember = {
  user: { id: string; displayName: string; handle: string; avatar: Avatar | null };
  isOrganizer: boolean;
  joinedAt: string;
};
export type LobbyMemberPage = { items: LobbyMember[]; nextCursor: string | null };
export type CancelLobbyResult = { id: string; status: 'CANCELLED' };
export type LobbyChatApi = {
  listLobbyMessages: (id: string, before?: string) => Promise<LobbyMessagePage>;
  sendLobbyMessage: (id: string, input: SendLobbyMessageInput) => Promise<LobbyMessage>;
};
// Lobby-related Activity shares the existing authenticated transport/context.
export type LobbyApi = LobbyReadApi & LobbyChatApi & NotificationsApi & {
  listLobbyRecommendations: () => Promise<LobbyRecommendations>;
  listLobbyHistory: (after?: string) => Promise<LobbyHistoryPage>;
  updateLobby: (id: string, input: UpdateLobbyInput) => Promise<Lobby>;
  listLobbyMembers: (id: string, after?: string) => Promise<LobbyMemberPage>;
  cancelLobby: (id: string) => Promise<CancelLobbyResult>;
  listChats: (after?: string) => Promise<ChatPage>;
  createLobby: (input: CreateLobbyInput) => Promise<Lobby>;
  joinLobby: (id: string) => Promise<Lobby>;
  leaveLobby: (id: string) => Promise<Lobby>;
};
export type LobbyReadApi = {
  listLobbies: (after?: string, scope?: LobbyScope, q?: string) => Promise<LobbyPage>;
  getLobby: (id: string) => Promise<Lobby>;
};
