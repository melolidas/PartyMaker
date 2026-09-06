import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AvatarFiles } from './avatar-files.service';
import { AvatarImage } from './avatar-image.service';
import { avatarSelect, toAvatar } from './avatar-record';
import type { AvatarResponseDto, RemovedAvatarResponseDto } from './avatar.dto';

@Injectable()
export class AvatarsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AvatarFiles) private readonly files: AvatarFiles,
    @Inject(AvatarImage) private readonly image: AvatarImage) {}

  async replace(userId: string, file: Express.Multer.File): Promise<AvatarResponseDto> {
    const bytes = await this.image.normalize(file.buffer, file.mimetype);
    const id = randomUUID();
    try { await this.files.prepare(id, bytes); }
    catch { throw new ServiceUnavailableException({ code: 'AVATAR_STORAGE_UNAVAILABLE', message: 'Avatar file could not be prepared; the profile is unchanged' }); }
    // Filesystem and PostgreSQL are NOT a single atomic resource. Retain the new file on DB error:
    // the commit acknowledgement may have been lost, or the file may be an orphan for later cleanup.
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
      if (!await tx.user.findUnique({ where: { id: userId }, select: { id: true } })) {
        throw new UnauthorizedException({ code: 'INVALID_ACCESS_TOKEN', message: 'A valid access token is required' });
      }
      await tx.mediaAsset.create({ data: { id, ownerId: userId, kind: 'IMAGE', storageKey: `avatars/${id}.jpg`,
        mimeType: 'image/jpeg', width: 512, height: 512, bytes: bytes.length } });
      await tx.user.update({ where: { id: userId }, data: { avatarMediaId: id } });
      return { avatar: { id, width: 512, height: 512, mimeType: 'image/jpeg' as const } };
    }, { isolationLevel: 'ReadCommitted' });
  }

  async remove(userId: string, avatarId: string): Promise<RemovedAvatarResponseDto> {
    return this.prisma.$transaction(async tx => {
      // Same lock as replace: recheck the condition AFTER the preceding writer.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId }, select: { avatarMediaId: true } });
      if (!user) throw new UnauthorizedException({ code: 'INVALID_ACCESS_TOKEN', message: 'A valid access token is required' });
      if (user.avatarMediaId === null) return { avatar: null }; // No UPDATE, including updatedAt.
      if (user.avatarMediaId !== avatarId.toLowerCase()) throw new ConflictException({ code: 'AVATAR_CHANGED', message: 'The profile avatar has changed; reload your profile' });
      await tx.user.update({ where: { id: userId }, data: { avatarMediaId: null } });
      return { avatar: null };
    }, { isolationLevel: 'ReadCommitted' });
  }

  async readAssigned(id: string): Promise<Buffer> {
    const media = await this.prisma.mediaAsset.findUnique({ where: { id }, select: { ...avatarSelect, avatarFor: { select: { id: true } } } });
    if (!media?.avatarFor || !toAvatar(media, media.avatarFor.id)) throw this.notFound();
    try { return await this.files.read(id); } catch { throw this.notFound(); }
  }
  private notFound() { return new NotFoundException({ code: 'AVATAR_NOT_FOUND', message: 'Avatar is not available' }); }
}
