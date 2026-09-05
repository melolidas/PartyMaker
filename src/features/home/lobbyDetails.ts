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
  cancelTarget: { account: string; id: string; title: string } | null;
  cancelPhase: 'confirm' | 'retry' | null; cancelError: TranslationKey | null; cancelled: boolean;
};
export function emptyLobbyDetails(account: string | null, id: string): LobbyDetailsState {
  return { account, id, lobby: null, loading: !!account, mutating: false, error: null, actionError: null,
    cancelTarget: null, cancelPhase: null, cancelError: null, cancelled: false };
}

/** UI request ownership is separate from auth. Never apply an old GET over a membership response. */
export class LobbyDetailsStore {
  private state = emptyLobbyDetails(null, '');
  private context = 0;
  private read = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly api: Pick<LobbyApi, 'getLobby' | 'joinLobby' | 'leaveLobby' | 'cancelLobby'>) {}
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
    if (!this.state.account || this.state.mutating || this.state.cancelled) return;
    this.publish({ ...this.state, loading: true, error: null });
    try {
      const lobby = await this.api.getLobby(this.state.id);
      if (read !== this.read) return;
      this.publish({ ...this.state, lobby, loading: false });
    } catch (error: unknown) {
      if (read !== this.read) return;
      this.publish({ ...this.state, loading: false, error,
        lobby: error instanceof ApiClientError && error.statusCode === 404 ? null : this.state.lobby });
    }
  };
  changeMembership = async (): Promise<void> => {
    const { account, id, lobby, mutating, loading, error } = this.state;
    if (!account || !lobby || mutating || loading || error || this.state.cancelTarget || this.state.cancelled) return;
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

  requestCancel = (): void => {
    const { account, id, lobby, loading, mutating, error, cancelTarget, cancelled } = this.state;
    if (!account || !lobby?.isOrganizer || loading || mutating || error || cancelTarget || cancelled || Date.parse(lobby.startsAt) <= Date.now()) return;
    this.publish({ ...this.state, cancelTarget: { account, id, title: lobby.title }, cancelPhase: 'confirm', cancelError: null });
  };
  declineCancel = (): void => {
    if (this.state.mutating || this.state.cancelPhase !== 'confirm') return;
    this.publish({ ...this.state, cancelTarget: null, cancelPhase: null, cancelError: null });
  };
  confirmCancel = async (): Promise<void> => {
    const { cancelTarget: target, cancelPhase, account, id, lobby, mutating, cancelled } = this.state;
    if (!target || target.account !== account || target.id !== id || mutating || cancelled) return;
    if (cancelPhase === 'confirm' && (!lobby || Date.parse(lobby.startsAt) <= Date.now())) {
      this.publish({ ...this.state, cancelError: 'cancel.started' }); return;
    }
    const context = this.context;
    ++this.read; // A late GET cannot replace the outcome or erase the pending target.
    this.publish({ ...this.state, mutating: true, loading: false, cancelError: null });
    try {
      const result = await this.api.cancelLobby(target.id);
      if (context !== this.context) return;
      // Also validate at the UI boundary: only this endpoint's exact receipt is proof.
      if (!result || result.id !== target.id || result.status !== 'CANCELLED') throw new Error('Unconfirmed cancellation');
      ++this.read;
      this.publish({ ...this.state, cancelled: true, lobby: null, loading: false, mutating: false, cancelTarget: null, cancelPhase: null });
    } catch (error: unknown) {
      if (context !== this.context) return;
      const cancelError: TranslationKey = error instanceof ApiClientError && error.code === 'LOBBY_STARTED' ? 'cancel.started'
        : error instanceof ApiClientError && error.code === 'LOBBY_ORGANIZER_REQUIRED' ? 'cancel.organizerRequired'
        : error instanceof ApiClientError && error.code === 'LOBBY_NOT_FOUND' ? 'cancel.notFound' : 'cancel.unconfirmed';
      this.publish({ ...this.state, mutating: false, cancelPhase: 'retry', cancelError });
      // Optional verification is NOT proof of cancellation and cannot hold retry hostage.
      void this.reload();
    }
  };
}
