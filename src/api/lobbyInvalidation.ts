/** Shared invalidation only, not shared pages or credentials. One channel per existing ApiClient. */
class LobbyInvalidation {
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  invalidate(): void { this.listeners.forEach((listener) => listener()); }
}

const channels = new WeakMap<object, LobbyInvalidation>();
export function getLobbyInvalidation(api: object): LobbyInvalidation {
  let channel = channels.get(api);
  if (!channel) { channel = new LobbyInvalidation(); channels.set(api, channel); }
  return channel;
}
