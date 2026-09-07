import { ApiClientError } from '../../api/errors';
import { isLobbyRoles, type LobbyRole, type LobbyRoleAction, type LobbyRolesApi } from '../../api/lobbyRoleTypes';
import type { TranslationKey } from '../../i18n/translations';

type Target = { roleId: string; action: LobbyRoleAction };
export type RolesState = {
  account: string | null; lobbyId: string; items: LobbyRole[]; loaded: boolean; loading: boolean; blocked: boolean;
  mutating: boolean; pending: Target | null; error: TranslationKey | null;
};
export const emptyRoles = (account: string | null, lobbyId: string): RolesState => ({ account, lobbyId, items: [], loaded: false, loading: !!account, blocked: false, mutating: false, pending: null, error: null });
export class LobbyRolesStore {
  private state = emptyRoles(null, '');
  private context = 0;
  private read = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly api: LobbyRolesApi, private readonly accessLost: () => void = () => {}) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(state: RolesState) { this.state = state; this.listeners.forEach(fn => fn()); }
  setContext(account: string | null, lobbyId: string) {
    if (account === this.state.account && lobbyId === this.state.lobbyId) return;
    this.context++; this.read++; this.publish(emptyRoles(account, lobbyId));
    if (account) void this.reload();
  }
  private deny(error: unknown) {
    if (!(error instanceof ApiClientError) || ![403, 404].includes(error.statusCode)) return false;
    if (error.code === 'LOBBY_ROLE_NOT_FOUND') return false;
    this.context++; this.read++;
    this.publish({ ...emptyRoles(this.state.account, this.state.lobbyId), blocked: true, loading: false, error: 'roles.accessLost' });
    this.accessLost(); return true;
  }
  invalidate = () => {
    if (!this.state.account || this.state.blocked) return;
    this.context++; this.read++;
    this.publish({ ...this.state, items: [], loaded: false, mutating: false });
    void this.reload();
  };
  reload = async () => {
    if (!this.state.account || this.state.blocked || this.state.mutating) return;
    const context = this.context, read = ++this.read;
    // Never let a GET receipt silently confirm a previous POST action.
    this.publish({ ...this.state, loading: true, error: this.state.pending ? 'roles.unconfirmed' : null });
    try {
      const response = await this.api.listLobbyRoles(this.state.lobbyId);
      if (context !== this.context || read !== this.read) return;
      if (!isLobbyRoles(response)) throw Error('Invalid roles response');
      this.publish({ ...this.state, items: response.items, loading: false, loaded: true });
    } catch (error: unknown) {
      if (context !== this.context || read !== this.read || this.deny(error)) return;
      this.publish({ ...this.state, loading: false, error: this.state.pending ? 'roles.unconfirmed' : 'roles.loadError' });
    }
  };
  choose = async (roleId: string, action: LobbyRoleAction) => {
    if (!this.state.account || this.state.blocked || !this.state.loaded || this.state.loading || this.state.mutating || this.state.pending) return;
    this.publish({ ...this.state, pending: { roleId, action } }); await this.retry();
  };
  retry = async () => {
    const { account, lobbyId, pending, blocked, mutating } = this.state;
    if (!account || !pending || blocked || mutating) return;
    const context = this.context; this.read++;
    this.publish({ ...this.state, mutating: true, loading: false, error: null });
    try {
      const response = await this.api.changeLobbyRole(lobbyId, pending.roleId, pending.action);
      if (context !== this.context) return;
      const row = isLobbyRoles(response) ? response.items.find(r => r.id === pending.roleId) : null;
      if (!row || (pending.action === 'select' ? row.assignedUserId !== account : row.assignedUserId === account)) throw Error('Unconfirmed role action');
      this.read++;
      this.publish({ ...this.state, items: response.items, loaded: true, pending: null, mutating: false, error: null });
    } catch (error: unknown) {
      if (context !== this.context || this.deny(error)) return;
      const rejected = error instanceof ApiClientError && error.statusCode >= 400 && error.statusCode < 500;
      this.publish({ ...this.state, mutating: false, pending: rejected ? null : pending,
        error: rejected ? error.code === 'LOBBY_ROLE_TAKEN' ? 'roles.takenError' : 'roles.failed' : 'roles.unconfirmed' });
    }
  };
}
