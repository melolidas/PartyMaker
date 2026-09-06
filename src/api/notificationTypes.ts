import type { Avatar } from './types';

export type LobbyNotification = {
  id: string; type: 'LOBBY_JOINED' | 'LOBBY_CANCELLED'; createdAt: string; readAt: string | null;
  lobbyTitleSnapshot: string | null;
  actor: { id: string; displayName: string; handle: string; avatar: Avatar | null } | null;
  lobby: { id: string; title: string } | null;
};
export type NotificationPage = { items: LobbyNotification[]; nextCursor: string | null };
export type NotificationRead = { id: string; readAt: string };
export type NotificationUnreadCount = { unreadCount: number };
export type NotificationsApi = {
  listNotifications: (after?: string) => Promise<NotificationPage>;
  readNotification: (id: string) => Promise<NotificationRead>;
  getNotificationUnreadCount: () => Promise<NotificationUnreadCount>;
};

export function isNotificationUnreadCount(value: unknown): value is NotificationUnreadCount {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).join(',') === 'unreadCount' && typeof row.unreadCount === 'number'
    && Number.isSafeInteger(row.unreadCount) && row.unreadCount >= 0;
}

export function isNotificationRead(value: unknown, id: string): value is NotificationRead {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).sort().join(',') === 'id,readAt' && row.id === id && typeof row.readAt === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.readAt) && Number.isFinite(Date.parse(row.readAt))
    && new Date(row.readAt).toISOString() === row.readAt;
}
