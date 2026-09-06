import type { NotificationType } from '@prisma/client';

// List, read (including UPDATE) and unread count must expose the same history.
export const supportedNotificationTypes = ['LOBBY_JOINED', 'LOBBY_CANCELLED'] as const satisfies readonly NotificationType[];
export type SupportedNotificationType = typeof supportedNotificationTypes[number];
