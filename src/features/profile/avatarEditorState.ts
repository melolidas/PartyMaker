import type { Avatar, AvatarUpload } from '../../api/types';
import { ApiClientError } from '../../api/errors';
import type { TranslationKey } from '../../i18n/translations';

export type PickedAvatar = { uri: string; mimeType?: string; file?: Blob; fileSize?: number; width: number; height: number };
export type AvatarRemoval = { avatarId: string; phase: 'confirm' | 'retry' | 'changed' };
type State = { account: string | null; draft: AvatarUpload | null; busy: 'pick' | 'upload' | 'read' | 'remove' | null; error: TranslationKey | null; uncertain: boolean; saved: boolean; checked: boolean;
  removal: AvatarRemoval | null; removeError: TranslationKey | null; removed: boolean };
type Actions = {
  pick: () => Promise<PickedAvatar | null>;
  upload: (input: AvatarUpload, stillCurrent: () => boolean) => Promise<Avatar>;
  refresh: (stillCurrent: () => boolean) => Promise<Avatar | null>;
  remove: (avatarId: string, stillCurrent: () => boolean) => Promise<boolean>;
};
const empty = (account: string | null): State => ({ account, draft: null, busy: null, error: null, uncertain: false, saved: false, checked: false,
  removal: null, removeError: null, removed: false });

export class AvatarEditorStore {
  private state = empty(null);
  private generation = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly actions: Actions) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(patch: Partial<State>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  setContext(account: string | null) { this.generation++; this.state = empty(account); this.listeners.forEach(fn => fn()); }
  private owner() { const generation = this.generation; return () => generation === this.generation && !!this.state.account; }
  private locked() { return !!this.state.busy || this.state.removal?.phase === 'confirm'; }
  requestRemoval = (avatarId: string) => {
    if (!this.state.account || this.locked()) return;
    this.publish({ removal: { avatarId, phase: 'confirm' }, removeError: null, removed: false });
  };
  cancelRemoval = (target: AvatarRemoval) => {
    if (!this.state.account || this.state.busy || target !== this.state.removal || target.phase !== 'confirm') return;
    this.publish({ removal: null, removeError: null });
  };
  remove = async (target: AvatarRemoval) => {
    if (!this.state.account || this.state.busy || target !== this.state.removal || target.phase === 'changed') return;
    const current = this.owner(); this.publish({ busy: 'remove', removeError: null, removed: false, saved: false, checked: false });
    try {
      const applied = await this.actions.remove(target.avatarId, current);
      if (current() && applied) this.publish({ removal: null, removed: true }); // Draft is deliberately untouched.
      else if (current()) this.publish({ removal: null }); // Superseded avatar field owner: no receipt or error.
    } catch (error: unknown) {
      if (!current()) return;
      const code = error instanceof ApiClientError ? error.code : '';
      const changed = code === 'AVATAR_CHANGED';
      const rejected = error instanceof ApiClientError && error.statusCode >= 400 && error.statusCode < 500;
      this.publish({ removal: { avatarId: target.avatarId, phase: changed || rejected ? 'changed' : 'retry' },
        removeError: changed ? 'avatar.changed' : rejected ? 'avatar.removeRejected' : 'avatar.removeUnconfirmed' });
    } finally { if (current()) this.publish({ busy: null }); }
  };
  choose = async () => {
    if (!this.state.account || this.locked()) return;
    const current = this.owner(); this.publish({ busy: 'pick', error: null, saved: false, checked: false, removed: false });
    try {
      const picked = await this.actions.pick();
      if (!current()) return;
      if (!picked) return;
      const mime = picked.mimeType ?? picked.file?.type;
      if (mime !== 'image/jpeg' && mime !== 'image/png') { this.publish({ error: 'avatar.format' }); return; }
      if ((picked.fileSize ?? picked.file?.size ?? 0) > 5 * 1024 * 1024 || picked.width * picked.height > 20_000_000) {
        this.publish({ error: 'avatar.limit' }); return;
      }
      this.publish({ draft: { uri: picked.uri, file: picked.file, mimeType: mime }, uncertain: false });
    } catch { if (current()) this.publish({ error: 'avatar.pickerError' }); }
    finally { if (current()) this.publish({ busy: null }); }
  };
  discard = () => { if (this.state.account && !this.locked()) this.publish({ draft: null, error: null, uncertain: false, saved: false, checked: false }); };
  upload = async () => {
    const { draft, account, busy } = this.state;
    if (!draft || !account || busy || this.locked()) return;
    const current = this.owner(); this.publish({ busy: 'upload', error: null, saved: false, checked: false, removed: false });
    try {
      await this.actions.upload(draft, current);
      if (current()) this.publish({ draft: null, uncertain: false, saved: true });
    } catch (error: unknown) {
      if (!current()) return;
      const known = error instanceof ApiClientError;
      const code = known ? error.code : '';
      const message: TranslationKey = code === 'AVATAR_TOO_LARGE' || code === 'AVATAR_PIXEL_LIMIT' ? 'avatar.limit'
        : code === 'AVATAR_UNSUPPORTED_FORMAT' ? 'avatar.format'
        : code === 'AVATAR_INVALID_IMAGE' ? 'avatar.invalid'
        : code === 'VALIDATION_FAILED' ? 'common.error.validation'
        : code === 'INVALID_ACCESS_TOKEN' || code === 'INVALID_REFRESH_TOKEN' ? 'common.error.sessionExpired'
        : 'avatar.unconfirmed';
      this.publish({ error: message, uncertain: message === 'avatar.unconfirmed' });
    } finally { if (current()) this.publish({ busy: null }); }
  };
  refresh = async () => {
    if (!this.state.account || this.locked()) return;
    const current = this.owner(); this.publish({ busy: 'read', error: null, saved: false, checked: false });
    try {
      await this.actions.refresh(current);
      // A GET updates the confirmed avatar but never claims this upload succeeded.
      if (current()) this.publish({ checked: true });
    } catch { if (current()) this.publish({ error: 'avatar.readError' }); }
    finally { if (current()) this.publish({ busy: null }); }
  };
}
