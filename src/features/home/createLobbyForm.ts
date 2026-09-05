import type { CreateLobbyInput, Lobby, LobbyCategory } from '../../api/lobbyTypes';
import { ApiClientError } from '../../api/errors';
import { getRequestErrorTranslationKey } from '../../api/errorMessages';
import type { TranslationKey } from '../../i18n/translations';

export const CREATE_LOBBY_TIME_ZONE = 'Asia/Bishkek';
export const LOBBY_CATEGORIES: LobbyCategory[] = ['DRINKS', 'GAMING', 'FOOD', 'SPORT', 'MOVIES', 'OUTDOORS'];
export type LobbyFormFields = {
  title: string; description: string; category: LobbyCategory; date: string; time: string;
  capacity: string; isOnline: boolean; venueName: string;
};
export type LobbyFormState = {
  account: string | null; fields: LobbyFormFields; submitting: boolean; error: TranslationKey | null;
};
export function emptyLobbyForm(account: string | null = null): LobbyFormState {
  return { account, submitting: false, error: null, fields: {
    title: '', description: '', category: 'FOOD', date: '', time: '', capacity: '6', isOnline: false, venueName: '',
  } };
}

/** Current/future Bishkek civil time is UTC+06:00. Never use the device's local Date constructor. */
export function bishkekDateTimeToInstant(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000-') || !/^\d{2}:\d{2}$/.test(time)) return null;
  const wall = `${date}T${time}:00.000Z`;
  const utcWall = new Date(wall);
  if (!Number.isFinite(utcWall.getTime()) || utcWall.toISOString() !== wall) return null;
  const instant = new Date(utcWall.getTime() - 6 * 60 * 60 * 1000);
  if (instant.getUTCFullYear() < 1) return null;
  // Also check the named zone: do not silently accept historical/future rule differences.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CREATE_LOBBY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (name: string) => parts.find(part => part.type === name)?.value;
  if (`${get('year')?.padStart(4, '0')}-${get('month')}-${get('day')}` !== date || `${get('hour')}:${get('minute')}` !== time) return null;
  return instant.toISOString();
}

export function validateLobbyForm(fields: LobbyFormFields, now = Date.now()): CreateLobbyInput | TranslationKey {
  const title = fields.title.trim(); const description = fields.description.trim();
  if (!title || Array.from(title).length > 40) return 'create.error.title';
  if (!description || Array.from(description).length > 200) return 'create.error.description';
  if (!LOBBY_CATEGORIES.includes(fields.category)) return 'create.error.category';
  const startsAt = bishkekDateTimeToInstant(fields.date.trim(), fields.time.trim());
  if (!startsAt || Date.parse(startsAt) <= now) return 'create.error.schedule';
  if (!/^\d+$/.test(fields.capacity.trim()) || Number(fields.capacity) < 2 || Number(fields.capacity) > 2147483647) return 'create.error.capacity';
  const venueName = fields.isOnline ? null : fields.venueName.trim();
  if (venueName !== null && (!venueName || Array.from(venueName).length > 140)) return 'create.error.venue';
  return { title, description, category: fields.category, startsAt, timeZone: CREATE_LOBBY_TIME_ZONE,
    capacity: Number(fields.capacity), isOnline: fields.isOnline, venueName };
}

/** Screen-local draft + synchronous submit lock. Unmount/account change invalidate all callbacks. */
export class CreateLobbyFormStore {
  private generation = 0;
  private state = emptyLobbyForm();
  private listeners = new Set<() => void>();
  constructor(private readonly create: (input: CreateLobbyInput) => Promise<Lobby>, private readonly onCreated: (id: string) => void) {}
  getSnapshot = (): LobbyFormState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: LobbyFormState) { this.state = state; this.listeners.forEach(listener => listener()); }
  setAccount(account: string | null) {
    if (account === this.state.account) return;
    this.generation++;
    this.publish(emptyLobbyForm(account));
  }
  update = (field: Partial<LobbyFormFields>) => {
    if (!this.state.account || this.state.submitting) return;
    this.publish({ ...this.state, fields: { ...this.state.fields, ...field } });
  };
  submit = async (): Promise<void> => {
    if (!this.state.account || this.state.submitting) return;
    const input = validateLobbyForm(this.state.fields);
    if (typeof input === 'string') { this.publish({ ...this.state, error: input }); return; }
    const generation = this.generation;
    this.publish({ ...this.state, submitting: true, error: null });
    let lobby: Lobby;
    try { lobby = await this.create(input); }
    catch (error: unknown) {
      if (generation !== this.generation) return;
      const ambiguous = !(error instanceof ApiClientError) || error.code === 'NETWORK_ERROR'
        || error.code === 'INVALID_API_RESPONSE' || error.statusCode >= 500;
      this.publish({ ...this.state, submitting: false,
        error: ambiguous ? 'create.error.unconfirmed' : getRequestErrorTranslationKey(error) });
      return;
    }
    if (generation !== this.generation) return;
    // Keep submit locked until navigation/unmount, including a rapid second press after success.
    this.onCreated(lobby.id);
  };
}
