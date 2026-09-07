import type { ChatPage, ChatSummary } from '../../api/lobbyTypes';

export type InboxState = { account: string | null; items: ChatSummary[]; nextCursor: string | null;
  loading: boolean; loadingMore: boolean; error: 'latest' | 'page' | null };
export const emptyInbox = (account: string | null): InboxState => ({ account, items: [], nextCursor: null, loading: !!account, loadingMore: false, error: null });
const unique = (items: ChatSummary[]) => [...new Map(items.map(item => [item.lobby.id, item])).values()];
/** Independent inbox pages, never scope=mine or a projection of a Home page. */
export class LiveChatInboxStore {
  private state = emptyInbox(null);
  private generation = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly list: (after?: string) => Promise<ChatPage>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: InboxState) { this.state = state; this.listeners.forEach(listener => listener()); }
  setAccount(account: string | null) {
    if (account === this.state.account) return;
    this.generation++; this.publish(emptyInbox(account)); if (account) void this.reload();
  }
  reload = async (): Promise<void> => {
    if (!this.state.account) return;
    const generation = ++this.generation;
    this.publish({ ...this.state, loading: true, loadingMore: false, error: null });
    try {
      const page = await this.list();
      if (generation !== this.generation) return;
      this.publish({ ...this.state, items: unique(page.items), nextCursor: page.nextCursor, loading: false });
    } catch {
      if (generation === this.generation) this.publish({ ...this.state, loading: false, error: 'latest' });
    }
  };
  invalidate = (): void => {
    this.generation++;
    this.publish(emptyInbox(this.state.account));
    void this.reload();
  };
  accessLost = (id: string): void => {
    this.generation++;
    this.publish({ ...this.state, items: this.state.items.filter(row => row.lobby.id !== id), nextCursor: null, loadingMore: false });
    void this.reload();
  };
  loadMore = async (): Promise<void> => {
    const { account, nextCursor, loading, loadingMore } = this.state;
    if (!account || !nextCursor || loading || loadingMore) return;
    const generation = this.generation;
    this.publish({ ...this.state, loadingMore: true, error: null });
    try {
      const page = await this.list(nextCursor);
      if (generation !== this.generation) return;
      this.publish({ ...this.state, items: unique([...this.state.items, ...page.items]), nextCursor: page.nextCursor, loadingMore: false });
    } catch {
      if (generation === this.generation) this.publish({ ...this.state, loadingMore: false, error: 'page' });
    }
  };
}
