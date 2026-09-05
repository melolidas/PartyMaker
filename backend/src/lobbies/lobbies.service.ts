import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';

import { PrismaService } from '../prisma/prisma.service';
import type { ListLobbiesQueryDto } from './dto/list-lobbies-query.dto';
import type { CreateLobbyRequestDto } from './dto/create-lobby-request.dto';
import type { LobbyPageResponseDto, LobbyResponseDto } from './dto/lobby-response.dto';
import { parseLobbyInstant } from './lobby-instant';

const lobbySelect = (userId: string) => ({
  id: true, organizerId: true, title: true, description: true, category: true, startsAt: true,
  timeZone: true, isOnline: true, venueName: true, capacity: true,
  members: {
    where: { OR: [{ status: 'JOINED' }, { userId }] },
    select: { userId: true, status: true, user: { select: { extroversionScoreX2: true } } },
  },
} satisfies Prisma.LobbySelect);
type LobbyRow = Prisma.LobbyGetPayload<{ select: ReturnType<typeof lobbySelect> }>;
type Cursor = { startsAt: string; id: string };

function encodeCursor(lobby: { startsAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ startsAt: lobby.startsAt.toISOString(), id: lobby.id })).toString('base64url');
}

function decodeCursor(value: string): Cursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
    const cursor: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof cursor !== 'object' || cursor === null) throw new Error('Invalid cursor');
    const { startsAt, id } = cursor as Record<string, unknown>;
    if (typeof startsAt !== 'string' || parseLobbyInstant(startsAt)?.toISOString() !== startsAt
      || typeof id !== 'string' || !isUUID(id)) throw new Error('Invalid cursor');
    return { startsAt, id };
  } catch {
    throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid lobby pagination cursor' });
  }
}

function toLobbyResponse(lobby: LobbyRow, userId: string): LobbyResponseDto {
  const joined = lobby.members.filter((member) => member.status === 'JOINED');
  const joinedCount = joined.length;
  const own = lobby.members.find((member) => member.userId === userId);
  return {
    id: lobby.id, title: lobby.title, description: lobby.description, category: lobby.category,
    startsAt: lobby.startsAt.toISOString(), timeZone: lobby.timeZone,
    isOnline: lobby.isOnline, venueName: lobby.isOnline ? null : lobby.venueName,
    capacity: lobby.capacity, joinedCount,
    isJoined: own?.status === 'JOINED',
    membershipStatus: own?.status ?? null,
    isOrganizer: lobby.organizerId === userId,
    groupExtroversionLevel: joinedCount === 0 ? null : Math.round(
      joined.reduce((sum, member) => sum + member.user.extroversionScoreX2, 0) / joinedCount,
    ) / 2,
  };
}

@Injectable()
export class LobbiesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateLobbyRequestDto, userId: string): Promise<LobbyResponseDto> {
    const startsAt = parseLobbyInstant(input.startsAt);
    if (!startsAt || startsAt.getTime() <= Date.now()) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'startsAt must be a supported future instant' });
    }
    // Nested create is a single atomic Prisma write: no lobby without its organizer membership.
    const lobby = await this.prisma.lobby.create({
      data: {
        title: input.title, description: input.description, category: input.category,
        startsAt, timeZone: input.timeZone, capacity: input.capacity,
        isOnline: input.isOnline, venueName: input.venueName,
        organizerId: userId, status: 'PUBLISHED', minParticipants: 2,
        members: { create: { userId, role: 'ORGANIZER', status: 'JOINED' } },
      },
      select: lobbySelect(userId),
    });
    return toLobbyResponse(lobby, userId);
  }

  async list(query: ListLobbiesQueryDto, userId: string): Promise<LobbyPageResponseDto> {
    const cursor = query.after === undefined ? null : decodeCursor(query.after);
    // Escape ILIKE metacharacters, including the escape character itself.
    const search = query.q?.replace(/[\\%_]/g, '\\$&');
    const rows = search ? await this.prisma.$transaction(async (tx) => {
      // Explicit Unicode collation also handles Cyrillic on databases initialized
      // with locale C. Parameterized filtering happens BEFORE tuple pagination.
      const matches = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT l.id FROM "Lobby" l
        WHERE l.status = 'PUBLISHED' AND l.starts_at > ${new Date()}
          AND (l.title COLLATE "und-x-icu" ILIKE ${`%${search}%`}
            OR l.venue_name COLLATE "und-x-icu" ILIKE ${`%${search}%`})
          ${query.scope === 'mine' ? Prisma.sql`AND EXISTS (
            SELECT 1 FROM "LobbyMember" m WHERE m.lobby_id = l.id
              AND m.user_id = ${userId}::uuid AND m.status = 'JOINED'
          )` : Prisma.empty}
          ${cursor ? Prisma.sql`AND (l.starts_at, l.id) > (${new Date(cursor.startsAt)}, ${cursor.id}::uuid)` : Prisma.empty}
        ORDER BY l.starts_at ASC, l.id ASC LIMIT ${query.limit + 1}
      `);
      // Same snapshot for the page and its safe whole-group DTO, never raw rows.
      return tx.lobby.findMany({ where: { id: { in: matches.map(row => row.id) } },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], select: lobbySelect(userId) });
    }, { isolationLevel: 'RepeatableRead' }) : await this.prisma.lobby.findMany({
      where: {
        status: 'PUBLISHED', startsAt: { gt: new Date() },
        // Filter lobby visibility, not the members selected for whole-group statistics.
        ...(query.scope === 'mine' ? { members: { some: { userId, status: 'JOINED' as const } } } : {}),
        ...(cursor ? { OR: [
          { startsAt: { gt: new Date(cursor.startsAt) } },
          { startsAt: new Date(cursor.startsAt), id: { gt: cursor.id } },
        ] } : {}),
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      select: lobbySelect(userId),
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => toLobbyResponse(row, userId)),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }


  async changeMembership(id: string, userId: string, action: 'join' | 'leave'): Promise<LobbyResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      // Both actions lock the SAME parent row before reading membership/capacity.
      // ReadCommitted reads after a lock wait see the preceding transaction's commit.
      await tx.$queryRaw`SELECT id FROM "Lobby" WHERE id = ${id}::uuid FOR UPDATE`;
      const lobby = await tx.lobby.findFirst({
        where: { id, status: 'PUBLISHED' }, select: lobbySelect(userId),
      });
      if (!lobby) throw new NotFoundException({ code: 'LOBBY_NOT_FOUND', message: 'Lobby not found' });
      const own = lobby.members.find((member) => member.userId === userId);
      if (action === 'leave' && lobby.organizerId === userId) {
        throw new ConflictException({ code: 'LOBBY_ORGANIZER_CANNOT_LEAVE', message: 'The organizer cannot leave this lobby' });
      }
      if (own?.status === 'REMOVED') {
        throw new ConflictException({ code: 'LOBBY_MEMBERSHIP_REMOVED', message: 'Removed membership cannot be changed by the participant' });
      }
      // Idempotent no-ops precede time/capacity checks and never rewrite history.
      if ((action === 'join' && own?.status === 'JOINED') || (action === 'leave' && own?.status !== 'JOINED')) {
        return toLobbyResponse(lobby, userId);
      }
      const now = new Date();
      if (lobby.startsAt <= now) {
        throw new ConflictException({ code: 'LOBBY_STARTED', message: 'Membership can only change before the event starts' });
      }
      const key = { lobbyId_userId: { lobbyId: id, userId } };
      if (action === 'join') {
        const count = lobby.members.filter((member) => member.status === 'JOINED').length;
        if (count >= lobby.capacity) throw new ConflictException({ code: 'LOBBY_FULL', message: 'The lobby is full' });
        if (own) {
          await tx.lobbyMember.update({ where: key, data: { status: 'JOINED', joinedAt: now, leftAt: null } });
        } else {
          await tx.lobbyMember.create({ data: { lobbyId: id, userId, role: 'MEMBER', status: 'JOINED', joinedAt: now } });
        }
      } else {
        await tx.lobbyMember.update({ where: key, data: { status: 'LEFT', leftAt: now } });
      }
      const updated = await tx.lobby.findUniqueOrThrow({ where: { id }, select: lobbySelect(userId) });
      return toLobbyResponse(updated, userId);
    }, { isolationLevel: 'ReadCommitted' });
  }

  async get(id: string, userId: string): Promise<LobbyResponseDto> {
    const lobby = await this.prisma.lobby.findFirst({
      where: { id, status: 'PUBLISHED' }, select: lobbySelect(userId),
    });
    if (!lobby) throw new NotFoundException({ code: 'LOBBY_NOT_FOUND', message: 'Lobby not found' });
    return toLobbyResponse(lobby, userId);
  }
}
