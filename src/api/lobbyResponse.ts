import type { Lobby } from './lobbyTypes';

const keys = ['id', 'title', 'description', 'category', 'startsAt', 'timeZone', 'isOnline', 'venueName',
  'capacity', 'joinedCount', 'isJoined', 'membershipStatus', 'isOrganizer', 'groupExtroversionLevel'];
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && Array.from(value).length <= max;
/** A PATCH acknowledgement must be the expected safe DTO, not just a 2xx/id. */
export function isLobbyResponse(value: unknown, id: string): value is Lobby {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || !keys.every(key => Object.prototype.hasOwnProperty.call(row, key))) return false;
  if (row.id !== id || !text(row.title, 40) || !text(row.description, 200)
    || typeof row.category !== 'string' || !['DRINKS', 'GAMING', 'FOOD', 'SPORT', 'MOVIES', 'OUTDOORS'].includes(row.category)
    || typeof row.startsAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.startsAt)
    || !Number.isFinite(Date.parse(row.startsAt)) || new Date(row.startsAt).toISOString() !== row.startsAt
    || !text(row.timeZone, 64)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: row.timeZone }).format(); } catch { return false; }
  return typeof row.isOnline === 'boolean' && (row.isOnline ? row.venueName === null : text(row.venueName, 140))
    && typeof row.capacity === 'number' && Number.isInteger(row.capacity) && row.capacity >= 2 && row.capacity <= 2147483647
    && typeof row.joinedCount === 'number' && Number.isInteger(row.joinedCount) && row.joinedCount >= 0 && row.joinedCount <= row.capacity
    && typeof row.isOrganizer === 'boolean' && typeof row.isJoined === 'boolean'
    && [null, 'JOINED', 'LEFT', 'REMOVED'].includes(row.membershipStatus as string | null)
    && row.isJoined === (row.membershipStatus === 'JOINED')
    && (row.joinedCount === 0 ? row.groupExtroversionLevel === null : typeof row.groupExtroversionLevel === 'number'
      && row.groupExtroversionLevel >= 1 && row.groupExtroversionLevel <= 10 && Number.isInteger(row.groupExtroversionLevel * 2));
}
