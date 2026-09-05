import type { LobbyPage } from '../../api/lobbyTypes';
import { emptyLobbyFeed, type LobbyFeedState } from '../home/lobbyFeed';

export type LobbySearchState = LobbyFeedState & { query: string };
export const emptyLobbySearch = (account: string | null = null, query = ''): LobbySearchState => ({ ...emptyLobbyFeed(account), query });
type Schedule = (callback: () => void) => () => void;
const debounce: Schedule = callback => {
  const timer = setTimeout(callback, 300);
  return () => clearTimeout(timer);
};

/** Search-local pages. Invalidate synchronously on input, not when debounce expires. */
export class LobbySearchStore {
  private generation = 0;
  private cancelDebounce: (() => void) | undefined;
  private state = emptyLobbySearch();
  private listeners = new Set<() => void>();
  constructor(private readonly list: (q: string, after?: string) => Promise<LobbyPage>, private readonly schedule: Schedule = debounce) {}
  getSnapshot = (): LobbySearchState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  private publish(state: LobbySearchState) { this.state = state; this.listeners.forEach(listener => listener()); }
  private invalidate() { ++this.generation; this.cancelDebounce?.(); this.cancelDebounce = undefined; }
  setAccount(account: string | null) {
    if (account === this.state.account) return;
    this.invalidate(); this.publish(emptyLobbySearch(account, this.state.query));
    if (account) void this.reload();
  }
  setQuery(query: string) {
    if (query === this.state.query) return;
    this.invalidate(); this.publish(emptyLobbySearch(this.state.account, query));
    if (this.state.account) this.cancelDebounce = this.schedule(() => { void this.reload(); });
  }
  reload = async (): Promise<void> => {
    this.invalidate();
    const { account, query } = this.state;
    if (!account) return;
    const generation = this.generation;
    this.publish(emptyLobbySearch(account, query));
    try {
      const page = await this.list(query.trim());
      if (generation !== this.generation) return;
      this.publish({ ...this.state, status: 'ready', items: page.items, nextCursor: page.nextCursor });
    } catch (error: unknown) {
      if (generation !== this.generation) return;
      this.publish({ ...this.state, status: 'error', error });
    }
  };
  loadMore = async (): Promise<void> => {
    const { account, status, nextCursor, loadingMore, query } = this.state;
    if (!account || status !== 'ready' || !nextCursor || loadingMore) return;
    const generation = this.generation;
    this.publish({ ...this.state, loadingMore: true, error: null });
    try {
      const page = await this.list(query.trim(), nextCursor);
      if (generation !== this.generation) return;
      const items = [...new Map([...this.state.items, ...page.items].map(lobby => [lobby.id, lobby])).values()];
      this.publish({ ...this.state, items, nextCursor: page.nextCursor, loadingMore: false });
    } catch (error: unknown) {
      if (generation !== this.generation) return;
      this.publish({ ...this.state, error, loadingMore: false });
    }
  };
}
