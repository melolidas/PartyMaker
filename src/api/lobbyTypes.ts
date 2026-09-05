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
  groupExtroversionLevel: number | null;
};

export type LobbyPage = { items: Lobby[]; nextCursor: string | null };
export type LobbyReadApi = {
  listLobbies: (after?: string) => Promise<LobbyPage>;
  getLobby: (id: string) => Promise<Lobby>;
};
