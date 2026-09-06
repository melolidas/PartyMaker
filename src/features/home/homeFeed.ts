import { isLobbyResponse } from '../../api/lobbyResponse';
import type { Lobby, LobbyApi, LobbyPage } from '../../api/lobbyTypes';

export type HomeFeedTab = 'recommended' | 'all';
type FeedApi = Pick<LobbyApi, 'listLobbies' | 'listLobbyRecommendations'>;
export type HomeFeedState = {
  account: string | null; status: 'idle' | 'loading' | 'ready' | 'error';
  mode: 'pending' | 'personal' | 'catalog'; items: Lobby[];
  nextCursor: string | null; loadingMore: boolean; error: unknown | null;
};
export const emptyHomeFeed = (account: string | null = null): HomeFeedState => ({
  account, status: account ? 'loading' : 'idle', mode: 'pending', items: [], nextCursor: null, loadingMore: false, error: null,
});

function readItems(value: unknown): Lobby[] {
  if (!Array.isArray(value) || !value.every((row: unknown) => row !== null && typeof row === 'object'
    && 'id' in row && typeof row.id === 'string' && row.id.length > 0 && isLobbyResponse(row, row.id))) {
    throw new Error('Invalid lobby feed response');
  }
  return value as Lobby[];
}
function readRecommendations(value: unknown): Lobby[] {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !('items' in value)) {
    throw new Error('Invalid recommendations response');
  }
  const items = readItems(value.items);
  if (items.length > 5 || new Set(items.map(row => row.id)).size !== items.length) throw new Error('Invalid recommendations items');
  return items;
}
function readPage(value: unknown): LobbyPage {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('items' in value) || !('nextCursor' in value)
    || !(value.nextCursor === null || (typeof value.nextCursor === 'string' && value.nextCursor.length > 0))) {
    throw new Error('Invalid catalog response');
  }
  return { items: readItems(value.items), nextCursor: value.nextCursor };
}

/** One tab/opening owns its data. Invalidation resets BOTH request generation and mode/cursor. */
export class HomeFeedStore {
  private generation = 0;
  private state = emptyHomeFeed();
  private listeners = new Set<() => void>();
  constructor(private readonly api: FeedApi, private readonly tab: HomeFeedTab) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: HomeFeedState) { this.state = state; this.listeners.forEach(listener => listener()); }
  setAccount(account: string | null) {
    if (this.state.account === account) return;
    this.generation++;
    this.publish(emptyHomeFeed(account));
    if (account) void this.reload();
  }
  reload = async () => {
    const account = this.state.account;
    if (!account) return;
    const generation = ++this.generation;
    this.publish(emptyHomeFeed(account));
    try {
      if (this.tab === 'recommended') {
        const items = readRecommendations(await this.api.listLobbyRecommendations());
        if (generation !== this.generation) return;
        if (items.length) {
          this.publish({ ...emptyHomeFeed(account), status: 'ready', mode: 'personal', items });
          return;
        }
      }
      // Only a confirmed empty recommendation response reaches this branch.
      this.publish({ ...this.state, mode: 'catalog' });
      const page = readPage(await this.api.listLobbies(undefined, 'all'));
      if (generation !== this.generation) return;
      this.publish({ ...this.state, ...page, status: 'ready' });
    } catch (error: unknown) {
      if (generation !== this.generation) return;
      this.publish({ ...this.state, status: 'error', error });
    }
  };
  loadMore = async () => {
    const { account, mode, status, nextCursor, loadingMore } = this.state;
    if (!account || mode !== 'catalog' || status !== 'ready' || !nextCursor || loadingMore) return;
    const generation = this.generation;
    this.publish({ ...this.state, loadingMore: true, error: null });
    try {
      // Pagination never restarts the recommendation decision.
      const page = readPage(await this.api.listLobbies(nextCursor, 'all'));
      if (generation !== this.generation) return;
      if (page.nextCursor === nextCursor) throw new Error('Catalog cursor did not advance');
      const items = [...new Map([...this.state.items, ...page.items].map(row => [row.id, row])).values()];
      this.publish({ ...this.state, items, nextCursor: page.nextCursor, loadingMore: false });
    } catch (error: unknown) {
      if (generation !== this.generation) return;
      this.publish({ ...this.state, loadingMore: false, error });
    }
  };
}
