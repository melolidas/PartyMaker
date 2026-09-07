import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Prisma, type LobbyCategory } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { parseLobbyInstant } from '../lobbies/lobby-instant';
import type { ChatPageDto, ListChatsQueryDto } from './chat.dto';

function decodeCursor(value: string): { activityAt: Date; lobbyId: string } {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw Error();
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();
    const { activityAt, lobbyId } = parsed as Record<string, unknown>;
    const date = parseLobbyInstant(activityAt);
    if (!date || date.toISOString() !== activityAt || typeof lobbyId !== 'string' || !isUUID(lobbyId)) throw Error();
    return { activityAt: date, lobbyId };
  } catch { throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid chat pagination cursor' }); }
}
type ChatRow = {
  lobbyId: string; title: string; category: LobbyCategory | null; activityAt: Date;
  messageId: string | null; preview: string | null; messageCreatedAt: Date | null;
  authorId: string | null; displayName: string | null;
};
@Injectable()
export class ChatsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(userId: string, query: ListChatsQueryDto): Promise<ChatPageDto> {
    const cursor = query.after === undefined ? null : decodeCursor(query.after);
    // One statement = one PostgreSQL snapshot, no per-row API/Prisma history calls.
    // LATERAL takes one indexed latest message; only a 160-code-point preview leaves SQL.
    const rows = await this.prisma.$queryRaw<ChatRow[]>(Prisma.sql`
      SELECT l.id AS "lobbyId", l.title, l.category,
        COALESCE(last.created_at, l.created_at) AS "activityAt",
        last.id AS "messageId", last.preview, last.created_at AS "messageCreatedAt",
        u.id AS "authorId", u.display_name AS "displayName"
      FROM "Lobby" l
      JOIN "LobbyMember" member ON member.lobby_id = l.id
        AND member.user_id = ${userId}::uuid AND member.status = 'JOINED'
      LEFT JOIN LATERAL (
        SELECT m.id, m.author_id, m.created_at, left(m.body, 160) AS preview
        FROM "LobbyMessage" m WHERE m.lobby_id = l.id AND m.deleted_at IS NULL
        ORDER BY m.created_at DESC, m.id DESC LIMIT 1
      ) last ON true
      LEFT JOIN "User" u ON u.id = last.author_id
      WHERE l.status = 'PUBLISHED'
        ${cursor ? Prisma.sql`AND (COALESCE(last.created_at, l.created_at), l.id) < (${cursor.activityAt}, ${cursor.lobbyId}::uuid)` : Prisma.empty}
      ORDER BY COALESCE(last.created_at, l.created_at) DESC, l.id DESC
      LIMIT ${query.limit + 1}
    `);
    const page = rows.slice(0, query.limit), tail = page.at(-1);
    return {
      items: page.map(row => ({
        lobby: { id: row.lobbyId, title: row.title, category: row.category }, activityAt: row.activityAt.toISOString(),
        lastMessage: row.messageId === null ? null : {
          id: row.messageId, preview: row.preview!, createdAt: row.messageCreatedAt!.toISOString(),
          author: { id: row.authorId!, displayName: row.displayName! },
        },
      })),
      nextCursor: rows.length > query.limit && tail ? Buffer.from(JSON.stringify({ activityAt: tail.activityAt.toISOString(), lobbyId: tail.lobbyId })).toString('base64url') : null,
    };
  }
}
