import { ApiClientError } from '../../api/errors';
import { isLobbyResponse } from '../../api/lobbyResponse';
import type { Lobby, LobbyApi, UpdateLobbyInput } from '../../api/lobbyTypes';
import type { TranslationKey } from '../../i18n/translations';
import { validateLobbyBasics, type LobbyEditableFields } from './createLobbyForm';

export function changedLobbyFields(base: Lobby, fields: LobbyEditableFields): UpdateLobbyInput | TranslationKey {
  const input = validateLobbyBasics(fields);
  if (typeof input === 'string') return input;
  const patch: UpdateLobbyInput = {};
  if (input.title !== base.title) patch.title = input.title;
  if (input.description !== base.description) patch.description = input.description;
  if (input.category !== base.category) patch.category = input.category;
  if (input.capacity !== base.capacity) patch.capacity = input.capacity;
  return input.isOnline !== base.isOnline || input.venueName !== base.venueName
    ? { ...patch, isOnline: input.isOnline, venueName: input.venueName } : patch;
}
export type EditLobbyState = {
  account: string | null; id: string; base: Lobby | null; fields: LobbyEditableFields | null;
  checking: boolean; submitting: boolean; blocked: boolean; error: TranslationKey | null;
  checkError: boolean; checked: Lobby | null; saved: boolean;
};
export const emptyEditLobby = (account: string | null, id: string): EditLobbyState => ({ account, id, base: null, fields: null,
  checking: !!account, submitting: false, blocked: false, error: null, checkError: false, checked: null, saved: false });
const unavailable = (error: unknown) => error instanceof ApiClientError && (error.statusCode === 403 || error.statusCode === 404 || error.code === 'LOBBY_STARTED');
function errorKey(error: unknown): TranslationKey {
  if (unavailable(error)) return 'edit.unavailable';
  if (error instanceof ApiClientError) {
    if (error.code === 'LOBBY_CAPACITY_BELOW_JOINED') return 'edit.capacityJoined';
    if (error.code === 'LOBBY_CAPACITY_BELOW_MIN_PARTICIPANTS') return 'edit.capacityMinimum';
    if (error.statusCode === 400) return 'edit.validation';
  }
  return 'edit.unconfirmed';
}

/** One opening owns one draft. Reads may change access/verification, never unsaved fields. */
export class EditLobbyFormStore {
  private generation = 0;
  private read = 0;
  private checkAfterSubmit = false;
  private state = emptyEditLobby(null, '');
  private listeners = new Set<() => void>();
  constructor(private readonly api: Pick<LobbyApi, 'getLobby' | 'updateLobby'>, private readonly onSaved: (lobby: Lobby) => void) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: EditLobbyState) { this.state = state; this.listeners.forEach(listener => listener()); }
  setContext(account: string | null, id: string) {
    if (account === this.state.account && id === this.state.id) return;
    this.generation++; this.read++; this.checkAfterSubmit = false;
    this.publish(emptyEditLobby(account, id)); if (account) void this.check();
  }
  update = (fields: Partial<LobbyEditableFields>) => {
    if (!this.state.account || !this.state.fields || this.state.submitting || this.state.blocked || this.state.saved
      || (this.state.base && Date.parse(this.state.base.startsAt) <= Date.now())) return;
    this.publish({ ...this.state, fields: { ...this.state.fields, ...fields } });
  };
  check = async (manual = false): Promise<void> => {
    if (!this.state.account || this.state.submitting || this.state.saved) return;
    const read = ++this.read, generation = this.generation;
    this.publish({ ...this.state, checking: true, checkError: false, checked: null });
    try {
      const lobby = await this.api.getLobby(this.state.id);
      if (generation !== this.generation || read !== this.read) return;
      if (!isLobbyResponse(lobby, this.state.id)) throw new ApiClientError({ statusCode: 0, code: 'INVALID_API_RESPONSE', message: 'Invalid lobby details' });
      const blocked = this.state.blocked || !lobby.isOrganizer || Date.parse(lobby.startsAt) <= Date.now();
      this.publish({ ...this.state, checking: false, blocked,
        base: this.state.base ?? lobby, fields: this.state.fields ?? { title: lobby.title, description: lobby.description, category: lobby.category,
          capacity: String(lobby.capacity), isOnline: lobby.isOnline, venueName: lobby.venueName ?? '' },
        checked: manual ? lobby : null, error: blocked ? 'edit.unavailable' : this.state.error });
    } catch (error) {
      if (generation !== this.generation || read !== this.read) return;
      this.publish({ ...this.state, checking: false, checkError: true,
        blocked: this.state.blocked || unavailable(error), error: unavailable(error) ? 'edit.unavailable' : this.state.error });
    }
  };
  invalidate = () => {
    // A mutation emits invalidation before its promise settles. Recheck failures once
    // afterwards so an unavailable lobby cannot leave the open draft editable.
    if (this.state.submitting) this.checkAfterSubmit = true;
    else void this.check();
  };
  submit = async (): Promise<void> => {
    const { account, base, fields, submitting, checking, blocked, saved } = this.state;
    if (!account || !base || !fields || submitting || checking || blocked || saved) return;
    if (Date.parse(base.startsAt) <= Date.now()) { this.publish({ ...this.state, blocked: true, error: 'edit.unavailable' }); return; }
    const input = changedLobbyFields(base, fields);
    if (typeof input === 'string') { this.publish({ ...this.state, error: input }); return; }
    if (!Object.keys(input).length) { this.publish({ ...this.state, error: 'edit.noChanges' }); return; }
    const generation = this.generation; this.read++;
    this.publish({ ...this.state, submitting: true, error: null, checked: null, checkError: false });
    let updated: Lobby;
    try {
      const lobby = await this.api.updateLobby(this.state.id, input);
      if (generation !== this.generation) return;
      if (!isLobbyResponse(lobby, this.state.id) || !lobby.isOrganizer) throw new ApiClientError({ statusCode: 0, code: 'INVALID_API_RESPONSE', message: 'Unconfirmed lobby edit' });
      updated = lobby;
    } catch (error) {
      if (generation !== this.generation) return;
      const check = this.checkAfterSubmit; this.checkAfterSubmit = false;
      this.publish({ ...this.state, submitting: false, blocked: this.state.blocked || unavailable(error), error: errorKey(error) });
      if (check) void this.check();
      return;
    }
    this.checkAfterSubmit = false;
    this.publish({ ...this.state, submitting: false, saved: true });
    this.onSaved(updated);
  };
}
