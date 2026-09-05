import type { Avatar, AvatarUpload } from '../../api/types';
import { ApiClientError } from '../../api/errors';
import type { TranslationKey } from '../../i18n/translations';

export type PickedAvatar = { uri: string; mimeType?: string; file?: Blob; fileSize?: number; width: number; height: number };
type State = { account: string | null; draft: AvatarUpload | null; busy: 'pick' | 'upload' | 'read' | null; error: TranslationKey | null; uncertain: boolean; saved: boolean; checked: boolean };
type Actions = {
  pick: () => Promise<PickedAvatar | null>;
  upload: (input: AvatarUpload, stillCurrent: () => boolean) => Promise<Avatar>;
  refresh: (stillCurrent: () => boolean) => Promise<Avatar | null>;
};
const empty = (account: string | null): State => ({ account, draft: null, busy: null, error: null, uncertain: false, saved: false, checked: false });

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
  choose = async () => {
    if (!this.state.account || this.state.busy) return;
    const current = this.owner(); this.publish({ busy: 'pick', error: null, saved: false, checked: false });
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
  discard = () => { if (!this.state.busy) this.publish({ draft: null, error: null, uncertain: false, saved: false, checked: false }); };
  upload = async () => {
    const { draft, account, busy } = this.state;
    if (!draft || !account || busy) return;
    const current = this.owner(); this.publish({ busy: 'upload', error: null, saved: false, checked: false });
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
    if (!this.state.account || this.state.busy) return;
    const current = this.owner(); this.publish({ busy: 'read', error: null, saved: false, checked: false });
    try {
      await this.actions.refresh(current);
      // A GET updates the confirmed avatar but never claims this upload succeeded.
      if (current()) this.publish({ checked: true });
    } catch { if (current()) this.publish({ error: 'avatar.readError' }); }
    finally { if (current()) this.publish({ busy: null }); }
  };
}
