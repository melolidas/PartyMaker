import type { Lobby, LobbyPage } from '../../api/lobbyTypes';

export type LobbyFeedState = {
  account: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  items: Lobby[];
  nextCursor: string | null;
  loadingMore: boolean;
  error: unknown | null;
};

export function emptyLobbyFeed(account: string | null = null): LobbyFeedState {
  return { account, status: account ? 'loading' : 'idle', items: [], nextCursor: null, loadingMore: false, error: null };
}

/** Screen-local data only. Each account/reload invalidates all earlier responses. */
export class LobbyFeedStore {
  private generation = 0;
  private state = emptyLobbyFeed();
  private listeners = new Set<() => void>();
  constructor(private readonly list: (after?: string) => Promise<LobbyPage>) {}
  getSnapshot = (): LobbyFeedState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(state: LobbyFeedState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  setAccount(account: string | null) {
    if (this.state.account === account) return;
    this.generation += 1;
    this.publish(emptyLobbyFeed(account));
    if (account) void this.reload();
  }
  reload = async (): Promise<void> => {
    const account = this.state.account;
    if (!account) return;
    const generation = ++this.generation;
    this.publish(emptyLobbyFeed(account));
    try {
      const page = await this.list();
      if (generation !== this.generation) return;
      this.publish({ ...this.state, status: 'ready', items: page.items, nextCursor: page.nextCursor });
    } catch (error: unknown) {
      if (generation !== this.generation) return;
      this.publish({ ...emptyLobbyFeed(account), status: 'error', error });
    }
  };
  loadMore = async (): Promise<void> => {
    const { account, nextCursor, loadingMore, status } = this.state;
    if (!account || !nextCursor || loadingMore || status !== 'ready') return;
    const generation = this.generation;
    this.publish({ ...this.state, loadingMore: true, error: null });
    try {
      const page = await this.list(nextCursor);
      if (generation !== this.generation) return;
      // Entries may change between page requests. Never render duplicate keys.
      const items = [...new Map([...this.state.items, ...page.items].map((lobby) => [lobby.id, lobby])).values()];
      this.publish({ ...this.state, items, nextCursor: page.nextCursor, loadingMore: false });
    } catch (error: unknown) {
      if (generation !== this.generation) return;
      this.publish({ ...this.state, loadingMore: false, error });
    }
  };
}

export function formatLobbyStartsAt(lobby: Pick<Lobby, 'startsAt' | 'timeZone'>, language: 'ru' | 'en'): string | null {
  try {
    return `${new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-GB', {
      timeZone: lobby.timeZone, dateStyle: 'medium', timeStyle: 'short', hour12: false,
    }).format(new Date(lobby.startsAt))} · ${lobby.timeZone}`;
  } catch {
    return null;
  }
}
