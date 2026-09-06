import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';

import { PrismaService } from '../prisma/prisma.service';
import type { ListLobbiesQueryDto } from './dto/list-lobbies-query.dto';
import type { CreateLobbyRequestDto } from './dto/create-lobby-request.dto';
import type { LobbyPageResponseDto, LobbyResponseDto, LobbyRecommendationsResponseDto } from './dto/lobby-response.dto';
import { recommendedIds } from './lobby-recommendations';
import { parseLobbyInstant } from './lobby-instant';
import type { CancelLobbyResponseDto } from './dto/cancel-lobby-response.dto';
import type { UpdateLobbyRequestDto } from './dto/update-lobby-request.dto';

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

  async recommendations(userId: string): Promise<LobbyRecommendationsResponseDto> {
    const serverNow = new Date(Date.now());
    return this.prisma.$transaction(async tx => {
      const sources = await tx.lobbyMember.findMany({
        where: { userId, status: 'JOINED', lobby: {
          organizerId: { not: userId },
          OR: [{ status: 'PUBLISHED' }, { status: 'COMPLETED', startsAt: { lte: serverNow } }],
        } },
        orderBy: [{ joinedAt: 'desc' }, { lobbyId: 'desc' }], take: 50,
        select: { lobby: { select: { title: true, description: true } } },
      });
      if (!sources.length) return { items: [] };
      // Every eligibility constraint, including whole-group occupancy and ANY
      // previous membership, is applied before LIMIT. No category/profile signal.
      const candidates = await tx.$queryRaw<{ id: string; title: string; description: string; startsAt: Date }[]>(Prisma.sql`
        SELECT l.id, l.title, l.description, l.starts_at AS "startsAt"
        FROM "Lobby" l
        WHERE l.status = 'PUBLISHED' AND l.starts_at > ${serverNow}
          AND l.organizer_id <> ${userId}::uuid
          AND NOT EXISTS (SELECT 1 FROM "LobbyMember" own
            WHERE own.lobby_id = l.id AND own.user_id = ${userId}::uuid)
          AND (SELECT count(*) FROM "LobbyMember" joined
            WHERE joined.lobby_id = l.id AND joined.status = 'JOINED') < l.capacity
        ORDER BY l.starts_at ASC, l.id ASC LIMIT 200
      `);
      const ids = recommendedIds(sources.map(source => source.lobby), candidates);
      const rows = await tx.lobby.findMany({ where: { id: { in: ids } }, select: lobbySelect(userId) });
      const byId = new Map(rows.map(row => [row.id, row]));
      return { items: ids.map(id => toLobbyResponse(byId.get(id)!, userId)) };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async create(input: CreateLobbyRequestDto, userId: string): Promise<LobbyResponseDto> {
    const startsAt = parseLobbyInstant(input.startsAt);
    if (!startsAt || startsAt.getTime() <= Date.now()) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'startsAt must be a supported future instant' });
    }
    // Nested create is a single atomic Prisma write: no lobby without its organizer membership.
    const lobby = await this.prisma.lobby.create({
      data: {
        title: input.title, description: input.description, category: input.category ?? null,
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
        // A real join/rejoin is one event. The notification and membership commit
        // together under the parent lock; no-op joins returned before this point.
        if (userId !== lobby.organizerId) await tx.notification.create({ data: {
          recipientId: lobby.organizerId, actorId: userId, lobbyId: id, type: 'LOBBY_JOINED',
        } });
      } else {
        await tx.lobbyMember.update({ where: key, data: { status: 'LEFT', leftAt: now } });
      }
      const updated = await tx.lobby.findUniqueOrThrow({ where: { id }, select: lobbySelect(userId) });
      return toLobbyResponse(updated, userId);
    }, { isolationLevel: 'ReadCommitted' });
  }

  async cancel(id: string, userId: string): Promise<CancelLobbyResponseDto> {
    return this.prisma.$transaction(async tx => {
      // Same parent lock as join/leave/send. Re-read after any preceding commit.
      await tx.$queryRaw`SELECT id FROM "Lobby" WHERE id = ${id}::uuid FOR UPDATE`;
      const lobby = await tx.lobby.findUnique({ where: { id }, select: { status: true, organizerId: true, startsAt: true, title: true } });
      if (!lobby || (lobby.status !== 'PUBLISHED' && lobby.status !== 'CANCELLED')
        || (lobby.status === 'CANCELLED' && lobby.organizerId !== userId)) {
        throw new NotFoundException({ code: 'LOBBY_NOT_FOUND', message: 'Lobby not found' });
      }
      if (lobby.organizerId !== userId) {
        throw new ForbiddenException({ code: 'LOBBY_ORGANIZER_REQUIRED', message: 'Only the organizer can cancel this lobby' });
      }
      // A replay is a true no-op, including after startsAt; never rewrite updatedAt/history.
      if (lobby.status === 'CANCELLED') return { id, status: 'CANCELLED' };
      if (lobby.startsAt.getTime() <= Date.now()) {
        throw new ConflictException({ code: 'LOBBY_STARTED', message: 'A started lobby cannot be cancelled' });
      }
      await tx.lobby.update({ where: { id }, data: { status: 'CANCELLED' } });
      // All membership/edit writers take this same parent lock. Snapshot the
      // title and current recipients here; a CANCELLED replay never inserts.
      const recipients = await tx.lobbyMember.findMany({ where: { lobbyId: id, status: 'JOINED', userId: { not: lobby.organizerId } }, select: { userId: true } });
      if (recipients.length) await tx.notification.createMany({ data: recipients.map(member => ({
        recipientId: member.userId, actorId: lobby.organizerId, lobbyId: id,
        type: 'LOBBY_CANCELLED', lobbyTitleSnapshot: lobby.title,
      })) });
      return { id, status: 'CANCELLED' };
    }, { isolationLevel: 'ReadCommitted' });
  }

  async get(id: string, userId: string): Promise<LobbyResponseDto> {
    const lobby = await this.prisma.lobby.findFirst({
      where: { id, status: 'PUBLISHED' }, select: lobbySelect(userId),
    });
    if (!lobby) throw new NotFoundException({ code: 'LOBBY_NOT_FOUND', message: 'Lobby not found' });
    return toLobbyResponse(lobby, userId);
  }

  async update(id: string, userId: string, input: UpdateLobbyRequestDto): Promise<LobbyResponseDto> {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Lobby" WHERE id = ${id}::uuid FOR UPDATE`;
      const lobby = await tx.lobby.findUnique({ where: { id }, select: {
        status: true, organizerId: true, startsAt: true, minParticipants: true, capacity: true,
      } });
      if (!lobby || lobby.status !== 'PUBLISHED') throw new NotFoundException({ code: 'LOBBY_NOT_FOUND', message: 'Lobby not found' });
      if (lobby.organizerId !== userId) throw new ForbiddenException({ code: 'LOBBY_ORGANIZER_REQUIRED', message: 'Only the organizer can edit this lobby' });
      // Time is deliberately sampled AFTER waiting for the shared row lock.
      if (lobby.startsAt.getTime() <= Date.now()) throw new ConflictException({ code: 'LOBBY_STARTED', message: 'A started lobby cannot be edited' });
      const joinedCount = await tx.lobbyMember.count({ where: { lobbyId: id, status: 'JOINED' } });
      const capacity = input.capacity ?? lobby.capacity;
      if (capacity < joinedCount) throw new ConflictException({ code: 'LOBBY_CAPACITY_BELOW_JOINED', message: 'Capacity cannot be smaller than the number of JOINED participants' });
      if (capacity < lobby.minParticipants) throw new ConflictException({ code: 'LOBBY_CAPACITY_BELOW_MIN_PARTICIPANTS', message: 'Capacity cannot be smaller than minParticipants' });
      // Do not replay a whole DTO: omitted fields keep the previous committed value.
      const updated = await tx.lobby.update({ where: { id }, data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.isOnline !== undefined ? { isOnline: input.isOnline, venueName: input.venueName } : {}),
      }, select: lobbySelect(userId) });
      return toLobbyResponse(updated, userId);
    }, { isolationLevel: 'ReadCommitted' });
  }
}
