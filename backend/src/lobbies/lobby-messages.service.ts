import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { parseLobbyInstant } from './lobby-instant';
import type { ListLobbyMessagesQueryDto, LobbyMessagePageDto, LobbyMessageResponseDto, SendLobbyMessageDto } from './dto/lobby-message.dto';

const messageSelect = {
  id: true, lobbyId: true, body: true, createdAt: true,
  author: { select: { id: true, displayName: true, handle: true } },
} satisfies Prisma.LobbyMessageSelect;
type MessageRow = Prisma.LobbyMessageGetPayload<{ select: typeof messageSelect }>;
const response = (row: MessageRow): LobbyMessageResponseDto => ({
  id: row.id, lobbyId: row.lobbyId, body: row.body, createdAt: row.createdAt.toISOString(), author: row.author,
});
function decodeCursor(value: string): { createdAt: Date; id: string } {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw Error();
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') throw Error();
    const { createdAt, id } = parsed as Record<string, unknown>;
    const date = parseLobbyInstant(createdAt);
    if (!date || date.toISOString() !== createdAt || typeof id !== 'string' || !isUUID(id)) throw Error();
    return { createdAt: date, id };
  } catch {
    throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid message pagination cursor' });
  }
}

@Injectable()
export class LobbyMessagesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async authorize(tx: Prisma.TransactionClient, lobbyId: string, userId: string): Promise<void> {
    const lobby = await tx.lobby.findUnique({ where: { id: lobbyId }, select: { status: true } });
    if (!lobby || lobby.status !== 'PUBLISHED') throw new NotFoundException({ code: 'LOBBY_NOT_FOUND', message: 'Lobby not found' });
    const member = await tx.lobbyMember.findUnique({ where: { lobbyId_userId: { lobbyId, userId } }, select: { status: true } });
    if (member?.status !== 'JOINED') throw new ForbiddenException({ code: 'LOBBY_CHAT_FORBIDDEN', message: 'Only JOINED participants can access this chat' });
  }

  async list(lobbyId: string, userId: string, query: ListLobbyMessagesQueryDto): Promise<LobbyMessagePageDto> {
    const cursor = query.before === undefined ? null : decodeCursor(query.before);
    return this.prisma.$transaction(async tx => {
      // Access and history share a snapshot. A read that started before leave may finish.
      await this.authorize(tx, lobbyId, userId);
      const rows = await tx.lobbyMessage.findMany({ where: {
        lobbyId, deletedAt: null,
        ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
      }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1, select: messageSelect });
      const page = rows.slice(0, query.limit), last = page.at(-1);
      return { items: page.map(response), nextCursor: rows.length > query.limit && last
        ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async send(lobbyId: string, userId: string, input: SendLobbyMessageDto): Promise<{ created: boolean; message: LobbyMessageResponseDto }> {
    return this.prisma.$transaction(async tx => {
      // Same lock and isolation as join/leave. Recheck access AFTER the lock wait.
      await tx.$queryRaw`SELECT id FROM "Lobby" WHERE id = ${lobbyId}::uuid FOR UPDATE`;
      await this.authorize(tx, lobbyId, userId);
      // ON CONFLICT DO NOTHING handles even an ID collision in another lobby,
      // without aborting this transaction with P2002. Never update an existing row.
      const inserted = await tx.lobbyMessage.createMany({ data: {
        id: input.clientMessageId, lobbyId, authorId: userId, body: input.body,
      }, skipDuplicates: true });
      const row = await tx.lobbyMessage.findUniqueOrThrow({ where: { id: input.clientMessageId }, select: { ...messageSelect, deletedAt: true } });
      if (row.lobbyId !== lobbyId.toLowerCase() || row.author.id !== userId.toLowerCase() || row.body !== input.body || row.deletedAt) {
        throw new ConflictException({ code: 'MESSAGE_ID_CONFLICT', message: 'Message id is unavailable for this request' });
      }
      return { created: inserted.count === 1, message: response(row) };
    }, { isolationLevel: 'ReadCommitted' });
  }
}
