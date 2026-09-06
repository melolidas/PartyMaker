import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { avatarSelect, toAvatar } from '../avatars/avatar-record';
import { parseLobbyInstant } from '../lobbies/lobby-instant';
import type { ListNotificationsQueryDto, NotificationPageDto, NotificationReadDto, NotificationUnreadCountDto } from './notification.dto';
import { supportedNotificationTypes, type SupportedNotificationType } from './supported-notification-types';

function decodeCursor(value: string): { createdAt: Date; id: string } {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw Error();
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).sort().join(',') !== 'createdAt,id') throw Error();
    const { createdAt, id } = parsed as Record<string, unknown>, date = parseLobbyInstant(createdAt);
    if (!date || date.toISOString() !== createdAt || typeof id !== 'string' || !isUUID(id)) throw Error();
    return { createdAt: date, id };
  } catch { throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid notification cursor' }); }
}

@Injectable()
export class NotificationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async unreadCount(userId: string): Promise<NotificationUnreadCountDto> {
    return { unreadCount: await this.prisma.notification.count({ where: { recipientId: userId, type: { in: [...supportedNotificationTypes] }, readAt: null } }) };
  }
  async list(userId: string, query: ListNotificationsQueryDto): Promise<NotificationPageDto> {
    const cursor = query.after === undefined ? null : decodeCursor(query.after);
    return this.prisma.$transaction(async tx => {
      // Bounded query + safe relations in one page snapshot, not JS filtering
      // after limit or per-row history reads. Recipient/type always constrain it.
      const rows = await tx.notification.findMany({ where: { recipientId: userId, type: { in: [...supportedNotificationTypes] },
        ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
      }, take: query.limit + 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: {
        id: true, type: true, lobbyTitleSnapshot: true, createdAt: true, readAt: true,
        actor: { select: { id: true, displayName: true, handle: true, avatar: { select: avatarSelect } } },
        lobby: { select: { id: true, title: true, status: true } },
      } });
      const page = rows.slice(0, query.limit), last = page.at(-1);
      return { items: page.map(row => ({ id: row.id, type: row.type as SupportedNotificationType, createdAt: row.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null,
        lobbyTitleSnapshot: row.type === 'LOBBY_CANCELLED' ? row.lobbyTitleSnapshot : null,
        actor: row.actor ? { id: row.actor.id, displayName: row.actor.displayName, handle: row.actor.handle, avatar: toAvatar(row.actor.avatar, row.actor.id) } : null,
        lobby: row.type === 'LOBBY_JOINED' && row.lobby?.status === 'PUBLISHED' ? { id: row.lobby.id, title: row.lobby.title } : null,
      })), nextCursor: rows.length > query.limit && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null };
    }, { isolationLevel: 'RepeatableRead' });
  }
  async read(userId: string, id: string): Promise<NotificationReadDto> {
    return this.prisma.$transaction(async tx => {
      // UPDATE's row lock rechecks readAt IS NULL after a concurrent writer.
      // Ownership/type are in the write itself, not just an earlier read.
      await tx.notification.updateMany({ where: { id, recipientId: userId, type: { in: [...supportedNotificationTypes] }, readAt: null }, data: { readAt: new Date() } });
      const row = await tx.notification.findFirst({ where: { id, recipientId: userId, type: { in: [...supportedNotificationTypes] } }, select: { id: true, readAt: true } });
      if (!row?.readAt) throw new NotFoundException({ code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found' });
      return { id: row.id, readAt: row.readAt.toISOString() };
    }, { isolationLevel: 'ReadCommitted' });
  }
}
