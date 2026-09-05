export type LobbyCategory = 'DRINKS' | 'GAMING' | 'FOOD' | 'SPORT' | 'MOVIES' | 'OUTDOORS';

/** User-authored strings, never translation keys or demo ids. */
export type Lobby = {
  id: string;
  title: string;
  description: string;
  category: LobbyCategory;
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
export type LobbyScope = 'all' | 'mine';
export type CreateLobbyInput = Pick<Lobby, 'title' | 'description' | 'category' | 'startsAt' | 'timeZone' | 'capacity' | 'isOnline' | 'venueName'>;
export type LobbyMessage = {
  id: string; lobbyId: string; body: string; createdAt: string;
  author: { id: string; displayName: string; handle: string };
};
export type LobbyMessagePage = { items: LobbyMessage[]; nextCursor: string | null };
export type SendLobbyMessageInput = { clientMessageId: string; body: string };
export type LobbyChatApi = {
  listLobbyMessages: (id: string, before?: string) => Promise<LobbyMessagePage>;
  sendLobbyMessage: (id: string, input: SendLobbyMessageInput) => Promise<LobbyMessage>;
};
export type LobbyApi = LobbyReadApi & LobbyChatApi & {
  createLobby: (input: CreateLobbyInput) => Promise<Lobby>;
  joinLobby: (id: string) => Promise<Lobby>;
  leaveLobby: (id: string) => Promise<Lobby>;
};
export type LobbyReadApi = {
  listLobbies: (after?: string, scope?: LobbyScope, q?: string) => Promise<LobbyPage>;
  getLobby: (id: string) => Promise<Lobby>;
};
