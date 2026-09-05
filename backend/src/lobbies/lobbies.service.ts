import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';

import { PrismaService } from '../prisma/prisma.service';
import type { ListLobbiesQueryDto } from './dto/list-lobbies-query.dto';
import type { CreateLobbyRequestDto } from './dto/create-lobby-request.dto';
import type { LobbyPageResponseDto, LobbyResponseDto } from './dto/lobby-response.dto';
import { parseLobbyInstant } from './lobby-instant';

const lobbySelect = {
  id: true, title: true, description: true, category: true, startsAt: true,
  timeZone: true, isOnline: true, venueName: true, capacity: true,
  members: {
    where: { status: 'JOINED' },
    select: { userId: true, user: { select: { extroversionScoreX2: true } } },
  },
} satisfies Prisma.LobbySelect;
type LobbyRow = Prisma.LobbyGetPayload<{ select: typeof lobbySelect }>;
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
  const joinedCount = lobby.members.length;
  return {
    id: lobby.id, title: lobby.title, description: lobby.description, category: lobby.category,
    startsAt: lobby.startsAt.toISOString(), timeZone: lobby.timeZone,
    isOnline: lobby.isOnline, venueName: lobby.isOnline ? null : lobby.venueName,
    capacity: lobby.capacity, joinedCount,
    isJoined: lobby.members.some((member) => member.userId === userId),
    groupExtroversionLevel: joinedCount === 0 ? null : Math.round(
      lobby.members.reduce((sum, member) => sum + member.user.extroversionScoreX2, 0) / joinedCount,
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
      select: lobbySelect,
    });
    return toLobbyResponse(lobby, userId);
  }

  async list(query: ListLobbiesQueryDto, userId: string): Promise<LobbyPageResponseDto> {
    const cursor = query.after === undefined ? null : decodeCursor(query.after);
    const rows = await this.prisma.lobby.findMany({
      where: {
        status: 'PUBLISHED', startsAt: { gt: new Date() },
        ...(cursor ? { OR: [
          { startsAt: { gt: new Date(cursor.startsAt) } },
          { startsAt: new Date(cursor.startsAt), id: { gt: cursor.id } },
        ] } : {}),
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      select: lobbySelect,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => toLobbyResponse(row, userId)),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  async get(id: string, userId: string): Promise<LobbyResponseDto> {
    const lobby = await this.prisma.lobby.findFirst({
      where: { id, status: 'PUBLISHED' }, select: lobbySelect,
    });
    if (!lobby) throw new NotFoundException({ code: 'LOBBY_NOT_FOUND', message: 'Lobby not found' });
    return toLobbyResponse(lobby, userId);
  }
}
