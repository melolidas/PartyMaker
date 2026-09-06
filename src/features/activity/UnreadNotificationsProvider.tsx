import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { getNotificationInvalidation } from '../../api/notificationInvalidation';
import { emptyUnreadCount, UnreadCountStore } from './unreadCount';

const UnreadContext = createContext<UnreadCountStore | null>(null);
export function UnreadNotificationsProvider({ children }: { children: ReactNode }) {
  const { user, status, storageRecoveryRequired, lobbyApi } = useAuth();
  const account = status === 'authenticated' && !storageRecoveryRequired ? user?.id ?? null : null;
  const store = useMemo(() => new UnreadCountStore(() => lobbyApi.getNotificationUnreadCount()), [lobbyApi]);
  useEffect(() => {
    store.setAccount(account);
    const unsubscribe = getNotificationInvalidation(lobbyApi).subscribe(store.invalidate);
    return () => { unsubscribe(); store.setAccount(null); };
  }, [account, lobbyApi, store]);
  return <UnreadContext.Provider value={store}>{children}</UnreadContext.Provider>;
}

export function useUnreadNotificationCount() {
  const store = useContext(UnreadContext);
  if (!store) throw Error('UnreadNotificationsProvider is required');
  const { user, status, storageRecoveryRequired } = useAuth();
  const account = status === 'authenticated' && !storageRecoveryRequired ? user?.id ?? null : null;
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  // Hide immediately during render, not only after the provider cleanup effect.
  return account && state.account === account ? state : emptyUnreadCount(null);
}
