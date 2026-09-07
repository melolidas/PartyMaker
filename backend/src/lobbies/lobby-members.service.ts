import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { avatarSelect, toAvatar } from '../avatars/avatar-record';
import { PrismaService } from '../prisma/prisma.service';
import { parseLobbyInstant } from './lobby-instant';
import type { ListLobbyMembersQueryDto, LobbyMemberPageDto } from './dto/lobby-member.dto';

function decodeCursor(value: string): { joinedAt: Date; userId: string } {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw Error();
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || Object.keys(parsed).sort().join(',') !== 'joinedAt,userId') throw Error();
    const { joinedAt, userId } = parsed as Record<string, unknown>;
    const date = parseLobbyInstant(joinedAt);
    if (!date || date.toISOString() !== joinedAt || typeof userId !== 'string' || !isUUID(userId)) throw Error();
    return { joinedAt: date, userId };
  } catch {
    throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid member pagination cursor' });
  }
}

@Injectable()
export class LobbyMembersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(lobbyId: string, userId: string, query: ListLobbyMembersQueryDto): Promise<LobbyMemberPageDto> {
    const cursor = query.after === undefined ? null : decodeCursor(query.after);
    return this.prisma.$transaction(async tx => {
      // Access and page share a snapshot. Independent pages are not a frozen roster.
      const lobby = await tx.lobby.findUnique({ where: { id: lobbyId }, select: { status: true, organizerId: true } });
      if (!lobby || lobby.status !== 'PUBLISHED') throw new NotFoundException({ code: 'LOBBY_NOT_FOUND', message: 'Lobby not found' });
      const viewer = await tx.lobbyMember.findUnique({ where: { lobbyId_userId: { lobbyId, userId } }, select: { status: true } });
      if (viewer?.status !== 'JOINED') throw new ForbiddenException({ code: 'LOBBY_MEMBERS_FORBIDDEN', message: 'Only JOINED participants can view members' });
      const rows = await tx.lobbyMember.findMany({ where: {
        lobbyId, status: 'JOINED',
        ...(cursor ? { OR: [{ joinedAt: { gt: cursor.joinedAt } }, { joinedAt: cursor.joinedAt, userId: { gt: cursor.userId } }] } : {}),
      }, orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }], take: query.limit + 1,
      select: { userId: true, joinedAt: true, user: { select: {
        id: true, displayName: true, handle: true, avatar: { select: avatarSelect },
      } } } });
      const page = rows.slice(0, query.limit), last = page.at(-1);
      return {
        items: page.map(row => ({ user: { id: row.user.id, displayName: row.user.displayName, handle: row.user.handle,
          avatar: toAvatar(row.user.avatar, row.user.id) }, isOrganizer: row.userId === lobby.organizerId, joinedAt: row.joinedAt.toISOString() })),
        nextCursor: rows.length > query.limit && last
          ? Buffer.from(JSON.stringify({ joinedAt: last.joinedAt.toISOString(), userId: last.userId })).toString('base64url') : null,
      };
    }, { isolationLevel: 'RepeatableRead' });
  }
}
