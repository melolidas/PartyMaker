import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { LobbyRolesApi } from '../../api/lobbyRoleTypes';
import { getLobbyInvalidation } from '../../api/lobbyInvalidation';
import { emptyRoles, LobbyRolesStore } from './lobbyRoles';

/** Small screen-local assignment map; no participant/history scans or global auth changes. */
export function useLobbyRoles(api: LobbyRolesApi, account: string | null, lobbyId: string, onAccessLost: () => void) {
  const lost = useRef(onAccessLost); lost.current = onAccessLost;
  const store = useMemo(() => new LobbyRolesStore(api, () => lost.current()), [api]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    store.setContext(account, lobbyId);
    const off = getLobbyInvalidation(api).subscribe(store.invalidate);
    return () => { off(); store.setContext(null, lobbyId); };
  }, [store, api, account, lobbyId]);
  return { store, state: snapshot.account === account && snapshot.lobbyId === lobbyId ? snapshot : emptyRoles(account, lobbyId) };
}
