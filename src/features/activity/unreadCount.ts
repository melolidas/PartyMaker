import { isNotificationUnreadCount, type NotificationUnreadCount } from '../../api/notificationTypes';

export type UnreadCountState = { account: string | null; unreadCount: number | null; loading: boolean; error: boolean; stale: boolean };
export const emptyUnreadCount = (account: string | null): UnreadCountState => ({ account, unreadCount: null, loading: false, error: false, stale: true });
type Flight = { context: number; promise: Promise<void> };

/** Per mounted authenticated context, not per tab. Invalidation is not a local decrement. */
export class UnreadCountStore {
  private state = emptyUnreadCount(null);
  private listeners = new Set<() => void>();
  private context = 0;
  private revision = 0;
  private flight: Flight | null = null;
  constructor(private readonly fetchCount: () => Promise<NotificationUnreadCount>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: UnreadCountState) { this.state = state; this.listeners.forEach(listener => listener()); }
  setAccount(account: string | null) {
    if (this.state.account === account) return;
    this.context++; this.revision++; this.flight = null;
    this.publish(emptyUnreadCount(account)); if (account) void this.refresh();
  }
  invalidate = () => {
    if (!this.state.account) return;
    this.revision++;
    this.publish({ ...this.state, stale: true });
    void this.refresh();
  };
  refresh = (): Promise<void> => {
    if (!this.state.account) return Promise.resolve();
    if (this.flight) return this.flight.promise;
    const flight: Flight = { context: this.context, promise: Promise.resolve() };
    this.flight = flight;
    flight.promise = Promise.resolve().then(() => this.drain(flight)).finally(() => {
      if (this.flight === flight) this.flight = null;
    });
    this.publish({ ...this.state, loading: true, error: false, stale: true });
    return flight.promise;
  };
  private async drain(flight: Flight): Promise<void> {
    while (this.flight === flight && this.context === flight.context) {
      const revision = this.revision;
      try {
        const result = await this.fetchCount();
        if (this.flight !== flight || this.context !== flight.context) return;
        if (revision !== this.revision) continue; // One trailing read uses the latest invalidation.
        if (!isNotificationUnreadCount(result)) throw Error('Invalid unread count');
        this.flight = null;
        this.publish({ ...this.state, unreadCount: result.unreadCount, loading: false, stale: false, error: false });
      } catch {
        if (this.flight !== flight || this.context !== flight.context) return;
        if (revision !== this.revision) continue;
        this.flight = null;
        this.publish({ ...this.state, loading: false, error: true, stale: true });
      }
      // Release before publishing: even a synchronous listener/next microtask can
      // schedule another read without losing its signal behind a settled promise.
      return;
    }
  }
}
