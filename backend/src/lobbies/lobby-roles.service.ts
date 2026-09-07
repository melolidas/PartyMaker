import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { LobbyRolesDto } from './dto/lobby-role.dto';

@Injectable()
export class LobbyRolesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  private async authorize(tx: Prisma.TransactionClient, lobbyId: string, userId: string) {
    const lobby = await tx.lobby.findUnique({ where: { id: lobbyId }, select: { status: true } });
    if (!lobby || lobby.status !== 'PUBLISHED') throw new NotFoundException({ code: 'LOBBY_NOT_FOUND', message: 'Lobby not found' });
    const member = await tx.lobbyMember.findUnique({ where: { lobbyId_userId: { lobbyId, userId } }, select: { status: true } });
    if (member?.status !== 'JOINED') throw new ForbiddenException({ code: 'LOBBY_CHAT_FORBIDDEN', message: 'Only JOINED participants can access roles' });
  }
  private async project(tx: Prisma.TransactionClient, lobbyId: string): Promise<LobbyRolesDto> {
    const roles = await tx.lobbyActivityRole.findMany({ where: { lobbyId }, orderBy: { position: 'asc' }, take: 20,
      select: { id: true, name: true, description: true, assignment: { select: { userId: true } } } });
    return { items: roles.map(role => ({ id: role.id, name: role.name, description: role.description, assignedUserId: role.assignment?.userId ?? null })) };
  }
  list(lobbyId: string, userId: string): Promise<LobbyRolesDto> {
    return this.prisma.$transaction(async tx => {
      await this.authorize(tx, lobbyId, userId);
      return this.project(tx, lobbyId);
    }, { isolationLevel: 'RepeatableRead' });
  }
  change(lobbyId: string, roleId: string, userId: string, action: 'select' | 'release'): Promise<LobbyRolesDto> {
    return this.prisma.$transaction(async tx => {
      // Same parent lock as join/leave/send/cancel, including after startsAt.
      await tx.$queryRaw`SELECT id FROM "Lobby" WHERE id = ${lobbyId}::uuid FOR UPDATE`;
      await this.authorize(tx, lobbyId, userId);
      const role = await tx.lobbyActivityRole.findFirst({ where: { id: roleId, lobbyId },
        select: { assignment: { select: { userId: true } } } });
      if (!role) throw new NotFoundException({ code: 'LOBBY_ROLE_NOT_FOUND', message: 'Role not found in this lobby' });
      if (action === 'release') {
        // A late release(A) cannot release B or another participant's assignment.
        await tx.lobbyRoleAssignment.deleteMany({ where: { lobbyId, roleId, userId } });
      } else if (role.assignment?.userId !== userId) {
        if (role.assignment) throw new ConflictException({ code: 'LOBBY_ROLE_TAKEN', message: 'This role is occupied; previous role is unchanged' });
        await tx.lobbyRoleAssignment.deleteMany({ where: { lobbyId, userId } });
        await tx.lobbyRoleAssignment.create({ data: { lobbyId, roleId, userId } });
      }
      return this.project(tx, lobbyId);
    }, { isolationLevel: 'ReadCommitted' });
  }
}
