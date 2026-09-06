import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { parseLobbyInstant } from '../lobbies/lobby-instant';
import { PrismaService } from '../prisma/prisma.service';
import type { ListLobbyHistoryQueryDto, LobbyHistoryPageDto } from './dto/lobby-history.dto';

function decodeCursor(value: string): { startsAt: Date; id: string } {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw Error();
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) throw Error();
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || Object.keys(parsed).sort().join(',') !== 'id,startsAt') throw Error();
    const { startsAt, id } = parsed as Record<string, unknown>;
    const date = parseLobbyInstant(startsAt);
    if (!date || date.toISOString() !== startsAt || typeof id !== 'string' || !isUUID(id)) throw Error();
    return { startsAt: date, id };
  } catch {
    throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid lobby history cursor' });
  }
}

@Injectable()
export class LobbyHistoryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(userId: string, query: ListLobbyHistoryQueryDto): Promise<LobbyHistoryPageDto> {
    const serverNow = new Date(Date.now()); // One boundary per request, not attendance/end-time evidence.
    const cursor = query.after === undefined ? null : decodeCursor(query.after);
    // A single bounded SQL statement: membership/status/time/cursor precede the limit.
    const rows = await this.prisma.lobby.findMany({
      where: {
        status: { in: ['PUBLISHED', 'COMPLETED'] }, startsAt: { lte: serverNow },
        members: { some: { userId, status: 'JOINED' } },
        ...(cursor ? { OR: [{ startsAt: { lt: cursor.startsAt } }, { startsAt: cursor.startsAt, id: { lt: cursor.id } }] } : {}),
      },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }], take: query.limit + 1,
      select: { id: true, title: true, description: true, category: true, startsAt: true,
        timeZone: true, isOnline: true, venueName: true, organizerId: true },
    });
    const page = rows.slice(0, query.limit), last = page.at(-1);
    return {
      items: page.map(({ organizerId, ...row }) => ({ ...row, startsAt: row.startsAt.toISOString(),
        venueName: row.isOnline ? null : row.venueName, isOrganizer: organizerId === userId })),
      nextCursor: rows.length > query.limit && last
        ? Buffer.from(JSON.stringify({ startsAt: last.startsAt.toISOString(), id: last.id })).toString('base64url') : null,
    };
  }
}
