import { ApiClientError } from '../../api/errors';
import { isNotificationRead, type LobbyNotification, type NotificationsApi } from '../../api/notificationTypes';

export type ActivityState = {
  account: string | null; items: LobbyNotification[]; nextCursor: string | null;
  loading: boolean; loadingMore: boolean; error: 'latest' | 'page' | null; imageRevision: number;
  marking: Record<string, boolean>; readErrors: Record<string, 'unconfirmed' | 'unavailable'>;
};
export const emptyActivity = (account: string | null): ActivityState => ({ account, items: [], nextCursor: null,
  loading: !!account, loadingMore: false, error: null, imageRevision: 0, marking: {}, readErrors: {} });

/** One tab opening/account owns its pages, pending actions and confirmed receipts. */
export class ActivityStore {
  private context = 0;
  private readGeneration = 0;
  private receipts = new Map<string, string>();
  private state = emptyActivity(null);
  private listeners = new Set<() => void>();
  constructor(private readonly api: NotificationsApi) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: ActivityState) {
    // A GET/page readAt confirms current state even if the POST receipt was lost.
    // Reconcile every publication, including a POST error arriving after that GET.
    // Access errors remain distinct: a read receipt does not restore access.
    const readErrors = { ...state.readErrors };
    for (const id of Object.keys(readErrors)) {
      if (readErrors[id] === 'unconfirmed' && this.receipts.has(id)) delete readErrors[id];
    }
    this.state = { ...state, readErrors }; this.listeners.forEach(listener => listener());
  }
  setAccount(account: string | null) {
    if (account === this.state.account) return;
    this.context++; this.readGeneration++; this.receipts.clear();
    this.publish(emptyActivity(account)); if (account) void this.reload();
  }
  private merge(items: LobbyNotification[]): LobbyNotification[] {
    const rows = new Map<string, LobbyNotification>();
    for (const row of items) {
      // Once read is observed it is monotonic; old GET/page data cannot undo it.
      if (row.readAt && !this.receipts.has(row.id)) this.receipts.set(row.id, row.readAt);
      rows.set(row.id, { ...row, readAt: this.receipts.get(row.id) ?? row.readAt });
    }
    return [...rows.values()];
  }
  reload = async (): Promise<void> => {
    if (!this.state.account) return;
    const generation = ++this.readGeneration;
    this.publish({ ...this.state, loading: true, loadingMore: false, error: null, imageRevision: this.state.imageRevision + 1 });
    try {
      const page = await this.api.listNotifications();
      if (generation !== this.readGeneration) return;
      this.publish({ ...this.state, items: this.merge(page.items), nextCursor: page.nextCursor, loading: false });
    } catch {
      if (generation === this.readGeneration) this.publish({ ...this.state, loading: false, error: 'latest' });
    }
  };
  loadMore = async (): Promise<void> => {
    const { account, nextCursor, loading, loadingMore } = this.state;
    if (!account || !nextCursor || loading || loadingMore) return;
    const generation = this.readGeneration;
    this.publish({ ...this.state, loadingMore: true, error: null });
    try {
      const page = await this.api.listNotifications(nextCursor);
      if (generation !== this.readGeneration) return;
      this.publish({ ...this.state, items: this.merge([...this.state.items, ...page.items]), nextCursor: page.nextCursor, loadingMore: false });
    } catch {
      if (generation === this.readGeneration) this.publish({ ...this.state, loadingMore: false, error: 'page' });
    }
  };
  markRead = async (id: string): Promise<void> => {
    if (!this.state.account || this.state.marking[id] || this.state.readErrors[id] === 'unavailable'
      || !this.state.items.some(row => row.id === id && !row.readAt)) return;
    const context = this.context, errors = { ...this.state.readErrors }; delete errors[id];
    this.publish({ ...this.state, marking: { ...this.state.marking, [id]: true }, readErrors: errors });
    try {
      const result = await this.api.readNotification(id);
      if (context !== this.context) return;
      if (!isNotificationRead(result, id)) throw Error('Unconfirmed notification read');
      this.receipts.set(id, result.readAt);
      this.publish({ ...this.state, items: this.merge(this.state.items), marking: { ...this.state.marking, [id]: false } });
    } catch (error) {
      if (context !== this.context) return;
      const unavailable = error instanceof ApiClientError && (error.statusCode === 403 || error.statusCode === 404);
      this.publish({ ...this.state, marking: { ...this.state.marking, [id]: false },
        readErrors: { ...this.state.readErrors, [id]: unavailable ? 'unavailable' : 'unconfirmed' } });
    }
  };
}
