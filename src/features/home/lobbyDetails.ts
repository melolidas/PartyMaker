import type { Lobby, LobbyApi } from '../../api/lobbyTypes';
import { ApiClientError } from '../../api/errors';
import type { TranslationKey } from '../../i18n/translations';

export function membershipAction(lobby: Lobby, now = Date.now()): { action: 'join' | 'leave' | null; label: TranslationKey; reason?: TranslationKey } {
  if (lobby.isOrganizer) return { action: null, label: 'membership.organizer', reason: 'membership.organizerReason' };
  if (lobby.membershipStatus === 'REMOVED') return { action: null, label: 'membership.unavailable', reason: 'membership.removed' };
  if (Date.parse(lobby.startsAt) <= now) return { action: null, label: 'membership.unavailable', reason: 'membership.started' };
  if (lobby.membershipStatus === 'JOINED') return { action: 'leave', label: 'membership.leave' };
  if (lobby.joinedCount >= lobby.capacity) return { action: null, label: 'membership.unavailable', reason: 'membership.full' };
  if (lobby.membershipStatus === null || lobby.membershipStatus === 'LEFT') return { action: 'join', label: 'membership.join' };
  return { action: null, label: 'membership.unavailable' };
}

export function membershipError(error: unknown): TranslationKey {
  if (error instanceof ApiClientError) {
    switch (error.code) {
      case 'LOBBY_FULL': return 'membership.full';
      case 'LOBBY_STARTED': return 'membership.started';
      case 'LOBBY_MEMBERSHIP_REMOVED': return 'membership.removed';
      case 'LOBBY_ORGANIZER_CANNOT_LEAVE': return 'membership.organizerReason';
      case 'LOBBY_NOT_FOUND': return 'lobbies.notFound';
    }
  }
  return 'membership.unconfirmed';
}

export type LobbyDetailsState = {
  account: string | null; id: string; lobby: Lobby | null;
  loading: boolean; mutating: boolean; error: unknown | null; actionError: TranslationKey | null;
};
export function emptyLobbyDetails(account: string | null, id: string): LobbyDetailsState {
  return { account, id, lobby: null, loading: !!account, mutating: false, error: null, actionError: null };
}

/** UI request ownership is separate from auth. Never apply an old GET over a membership response. */
export class LobbyDetailsStore {
  private state = emptyLobbyDetails(null, '');
  private context = 0;
  private read = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly api: Pick<LobbyApi, 'getLobby' | 'joinLobby' | 'leaveLobby'>) {}
  getSnapshot = (): LobbyDetailsState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(state: LobbyDetailsState) { this.state = state; this.listeners.forEach((listener) => listener()); }
  setContext(account: string | null, id: string): void {
    if (account === this.state.account && id === this.state.id) return;
    this.context++; this.read++;
    this.publish(emptyLobbyDetails(account, id));
    if (account) void this.reload();
  }
  reload = async (): Promise<void> => {
    const read = ++this.read;
    if (!this.state.account || this.state.mutating) return;
    this.publish({ ...this.state, loading: true, error: null });
    try {
      const lobby = await this.api.getLobby(this.state.id);
      if (read !== this.read) return;
      this.publish({ ...this.state, lobby, loading: false });
    } catch (error: unknown) {
      if (read !== this.read) return;
      this.publish({ ...this.state, loading: false, error });
    }
  };
  changeMembership = async (): Promise<void> => {
    const { account, id, lobby, mutating, loading, error } = this.state;
    if (!account || !lobby || mutating || loading || error) return;
    const intent = membershipAction(lobby);
    if (!intent.action) {
      this.publish({ ...this.state, actionError: intent.reason ?? null });
      return;
    }
    const context = this.context;
    ++this.read;
    // Synchronous lock: also blocks the opposite action and repeated handlers from an old render.
    this.publish({ ...this.state, mutating: true, actionError: null });
    try {
      const updated = await (intent.action === 'join' ? this.api.joinLobby(id) : this.api.leaveLobby(id));
      if (context !== this.context) return;
      this.publish({ ...this.state, lobby: updated, mutating: false });
    } catch (error: unknown) {
      if (context !== this.context) return;
      this.publish({ ...this.state, mutating: false, actionError: membershipError(error) });
    }
    // Re-read after any outcome; no optimistic success and no automatic POST retry.
    // If verification fails, keep actions blocked until an explicit successful GET retry.
    if (context === this.context) await this.reload();
  };
}
