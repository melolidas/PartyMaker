/** Signals only; never credentials, rows or a count shared across accounts. */
class NotificationInvalidation {
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  invalidate = () => { this.listeners.forEach(listener => listener()); };
}
const channels = new WeakMap<object, NotificationInvalidation>();
export function getNotificationInvalidation(api: object): NotificationInvalidation {
  let channel = channels.get(api);
  if (!channel) { channel = new NotificationInvalidation(); channels.set(api, channel); }
  return channel;
}
