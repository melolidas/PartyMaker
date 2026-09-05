import type { LobbyChatApi, LobbyMessage, SendLobbyMessageInput } from '../../api/lobbyTypes';
import { ApiClientError } from '../../api/errors';
import type { TranslationKey } from '../../i18n/translations';

type PendingSend = { input: SendLobbyMessageInput; draftRevision: number };
export type LiveChatState = {
  account: string | null; lobbyId: string; items: LobbyMessage[]; nextCursor: string | null;
  loading: boolean; loadingOlder: boolean; loaded: boolean; error: TranslationKey | null;
  blocked: boolean; draft: string; sending: boolean; pending: PendingSend | null; sendError: TranslationKey | null;
};
export const emptyLiveChat = (account: string | null, lobbyId: string): LiveChatState => ({
  account, lobbyId, items: [], nextCursor: null, loading: !!account, loadingOlder: false, loaded: false,
  error: null, blocked: false, draft: '', sending: false, pending: null, sendError: null,
});
export function validMessageBody(draft: string): boolean {
  const body = draft.trim();
  return body.length > 0 && Array.from(body).length <= 2000 && !body.includes('\u0000');
}
function ordered(...groups: LobbyMessage[][]): LobbyMessage[] {
  const unique = new Map<string, LobbyMessage>();
  groups.forEach(group => group.forEach(message => unique.set(message.id, message)));
  return [...unique.values()].sort((a, b) => {
    const at = `${a.createdAt}/${a.id}`, bt = `${b.createdAt}/${b.id}`;
    return at < bt ? -1 : at > bt ? 1 : 0;
  });
}

/** Owns one visible chat context. No timers, mock messages or optimistic delivery. */
export class LiveLobbyChatStore {
  private state = emptyLiveChat(null, '');
  private context = 0;
  private read = 0;
  private draftRevision = 0;
  // Confirmed sends are retained across older GET snapshots and latest-page refreshes.
  private confirmed = new Map<string, LobbyMessage>();
  private listeners = new Set<() => void>();
  constructor(private readonly api: LobbyChatApi, private readonly uuid: () => string, private readonly accessLost: () => void = () => {}) {}
  getSnapshot = (): LiveChatState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: LiveChatState) { this.state = state; this.listeners.forEach(listener => listener()); }
  setContext(account: string | null, lobbyId: string): void {
    if (this.state.account === account && this.state.lobbyId === lobbyId) return;
    this.context++; this.read++; this.draftRevision++; this.confirmed.clear();
    this.publish(emptyLiveChat(account, lobbyId));
    if (account) void this.reload();
  }
  private deny(error: unknown): boolean {
    if (!(error instanceof ApiClientError) || (error.statusCode !== 403 && error.statusCode !== 404)) return false;
    this.context++; this.read++; this.confirmed.clear();
    this.publish({ ...this.state, items: [], nextCursor: null, blocked: true, loading: false, loadingOlder: false,
      sending: false, pending: null, error: error.statusCode === 404 ? 'lobbies.notFound' : 'liveChat.forbidden', sendError: null });
    this.accessLost();
    return true;
  }
  // Membership invalidation immediately hides stale history while GET rechecks access.
  invalidate = (): void => {
    if (!this.state.account || this.state.blocked) return;
    this.context++; this.read++; this.confirmed.clear();
    this.publish({ ...this.state, items: [], nextCursor: null, loaded: false, sending: false,
      sendError: this.state.pending ? 'liveChat.unconfirmed' : null });
    void this.reload();
  };
  reload = async (): Promise<void> => {
    if (!this.state.account || this.state.blocked) return;
    const read = ++this.read, context = this.context, id = this.state.lobbyId;
    this.publish({ ...this.state, loading: true, loadingOlder: false, error: null });
    try {
      const page = await this.api.listLobbyMessages(id);
      if (read !== this.read || context !== this.context) return;
      this.publish({ ...this.state, items: ordered(page.items, [...this.confirmed.values()]), nextCursor: page.nextCursor,
        loading: false, loaded: true });
    } catch (error: unknown) {
      if (read !== this.read || context !== this.context || this.deny(error)) return;
      this.publish({ ...this.state, loading: false, error: 'liveChat.loadError' });
    }
  };
  loadOlder = async (): Promise<void> => {
    const { account, lobbyId, nextCursor, loading, loadingOlder, blocked } = this.state;
    if (!account || !nextCursor || loading || loadingOlder || blocked) return;
    const read = this.read, context = this.context;
    this.publish({ ...this.state, loadingOlder: true, error: null });
    try {
      const page = await this.api.listLobbyMessages(lobbyId, nextCursor);
      if (read !== this.read || context !== this.context) return;
      this.publish({ ...this.state, items: ordered(this.state.items, page.items, [...this.confirmed.values()]),
        nextCursor: page.nextCursor, loadingOlder: false });
    } catch (error: unknown) {
      if (read !== this.read || context !== this.context || this.deny(error)) return;
      this.publish({ ...this.state, loadingOlder: false, error: 'liveChat.olderError' });
    }
  };
  setDraft = (draft: string): void => {
    this.draftRevision++;
    this.publish({ ...this.state, draft, sendError: this.state.pending ? this.state.sendError : null });
  };
  send = async (): Promise<void> => {
    if (!this.state.account || this.state.blocked || !this.state.loaded || this.state.loading || this.state.sending || this.state.pending) return;
    if (!validMessageBody(this.state.draft)) { this.publish({ ...this.state, sendError: 'liveChat.invalidBody' }); return; }
    let clientMessageId: string;
    try { clientMessageId = this.uuid(); } catch { this.publish({ ...this.state, sendError: 'liveChat.idError' }); return; }
    this.publish({ ...this.state, pending: { input: { clientMessageId, body: this.state.draft.trim() }, draftRevision: this.draftRevision } });
    await this.sendPending();
  };
  retrySend = async (): Promise<void> => { await this.sendPending(); };
  discardRetry = (): void => {
    if (this.state.sending) return;
    this.publish({ ...this.state, pending: null, sendError: null });
  };
  private async sendPending(): Promise<void> {
    const { pending, account, lobbyId, blocked, sending, loading, loaded } = this.state;
    if (!pending || !account || blocked || sending || loading || !loaded) return;
    const context = this.context;
    this.publish({ ...this.state, sending: true, sendError: null });
    try {
      const message = await this.api.sendLobbyMessage(lobbyId, pending.input);
      if (context !== this.context) return;
      this.confirmed.set(message.id, message);
      this.publish({ ...this.state, items: ordered(this.state.items, [message]), pending: null, sending: false,
        draft: this.draftRevision === pending.draftRevision ? '' : this.state.draft });
    } catch (error: unknown) {
      if (context !== this.context || this.deny(error)) return;
      const sendError: TranslationKey = error instanceof ApiClientError && error.code === 'MESSAGE_ID_CONFLICT' ? 'liveChat.conflict'
        : error instanceof ApiClientError && error.code === 'VALIDATION_FAILED' ? 'liveChat.invalidBody' : 'liveChat.unconfirmed';
      this.publish({ ...this.state, sending: false, sendError });
    }
  }
}
