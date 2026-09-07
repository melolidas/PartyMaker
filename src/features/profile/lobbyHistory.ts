import type { LobbyHistoryItem, LobbyHistoryPage } from '../../api/lobbyTypes';

export type LobbyHistoryState = {
  account: string | null; status: 'idle' | 'loading' | 'ready' | 'error';
  items: LobbyHistoryItem[]; nextCursor: string | null; loadingMore: boolean; error: unknown | null;
};
export const emptyLobbyHistory = (account: string | null = null): LobbyHistoryState => ({
  account, status: account ? 'loading' : 'idle', items: [], nextCursor: null, loadingMore: false, error: null,
});
const unique = (items: LobbyHistoryItem[]) => [...new Map(items.map(item => [item.id, item])).values()];

/** One tab opening/account owns pages; reads never update UserProfile or editor drafts. */
export class LobbyHistoryStore {
  private state = emptyLobbyHistory();
  private generation = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly list: (after?: string) => Promise<LobbyHistoryPage>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<LobbyHistoryState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  setAccount(account: string | null) {
    if (account === this.state.account) return;
    this.generation++; this.publish(emptyLobbyHistory(account));
    if (account) void this.reload();
  }
  reload = async () => {
    const account = this.state.account;
    if (!account) return;
    const generation = ++this.generation;
    this.publish(emptyLobbyHistory(account));
    try {
      const page = await this.list();
      if (generation === this.generation) this.publish({ status: 'ready', items: unique(page.items), nextCursor: page.nextCursor });
    } catch (error: unknown) {
      if (generation === this.generation) this.publish({ status: 'error', error });
    }
  };
  loadMore = async () => {
    const { account, status, nextCursor, loadingMore } = this.state;
    if (!account || status !== 'ready' || !nextCursor || loadingMore) return;
    const generation = this.generation;
    this.publish({ loadingMore: true, error: null });
    try {
      const page = await this.list(nextCursor);
      if (generation === this.generation) this.publish({ items: unique([...this.state.items, ...page.items]), nextCursor: page.nextCursor, loadingMore: false });
    } catch (error: unknown) {
      if (generation === this.generation) this.publish({ loadingMore: false, error });
    }
  };
}
