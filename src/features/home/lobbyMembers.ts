import { ApiClientError } from '../../api/errors';
import type { LobbyMember, LobbyMemberPage } from '../../api/lobbyTypes';

export type MembersState = {
  account: string | null; id: string; items: LobbyMember[]; nextCursor: string | null;
  loading: boolean; loadingMore: boolean; error: 'latest' | 'page' | 'access' | null; imageRevision: number;
};
export const emptyMembers = (account: string | null, id: string): MembersState => ({
  account, id, items: [], nextCursor: null, loading: !!account, loadingMore: false, error: null, imageRevision: 0,
});
const unique = (items: LobbyMember[]) => [...new Map(items.map(row => [row.user.id, row])).values()];

/** Context-local pages. Every replacement invalidates older reads, including pagination. */
export class LobbyMembersStore {
  private state = emptyMembers(null, '');
  private generation = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly list: (id: string, after?: string) => Promise<LobbyMemberPage>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: MembersState) { this.state = state; this.listeners.forEach(listener => listener()); }
  setContext(account: string | null, id: string) {
    if (account === this.state.account && id === this.state.id) return;
    this.generation++; this.publish(emptyMembers(account, id)); if (account) void this.reload();
  }
  reload = async (): Promise<void> => {
    if (!this.state.account) return;
    const generation = ++this.generation;
    this.publish({ ...emptyMembers(this.state.account, this.state.id), imageRevision: generation });
    try {
      const page = await this.list(this.state.id);
      if (generation !== this.generation) return;
      this.publish({ ...this.state, items: unique(page.items), nextCursor: page.nextCursor, loading: false });
    } catch (error) { this.fail(error, generation, false); }
  };
  invalidate = (): void => { void this.reload(); };
  loadMore = async (): Promise<void> => {
    const { account, id, nextCursor, loading, loadingMore, error } = this.state;
    if (!account || !nextCursor || loading || loadingMore || error === 'access') return;
    const generation = this.generation;
    this.publish({ ...this.state, loadingMore: true, error: null });
    try {
      const page = await this.list(id, nextCursor);
      if (generation !== this.generation) return;
      this.publish({ ...this.state, items: unique([...this.state.items, ...page.items]), nextCursor: page.nextCursor, loadingMore: false });
    } catch (error) { this.fail(error, generation, true); }
  };
  private fail(error: unknown, generation: number, page: boolean) {
    if (generation !== this.generation) return;
    const denied = error instanceof ApiClientError && (error.statusCode === 403 || error.statusCode === 404);
    this.publish({ ...this.state, ...(denied ? { items: [], nextCursor: null } : {}),
      loading: false, loadingMore: false, error: denied ? 'access' : page ? 'page' : 'latest' });
  }
}
