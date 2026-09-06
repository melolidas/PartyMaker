import type { Prisma } from '@prisma/client';
import type { AvatarDto } from './avatar.dto';

export const avatarSelect = {
  id: true, ownerId: true, kind: true, storageKey: true, width: true, height: true, mimeType: true, bytes: true,
} satisfies Prisma.MediaAssetSelect;
type Record = Prisma.MediaAssetGetPayload<{ select: typeof avatarSelect }>;

// Only this server-owned namespace/shape is a processed avatar, never legacy demo media.
export function toAvatar(media: Record | null, ownerId: string): AvatarDto | null {
  if (!media || media.ownerId !== ownerId || media.kind !== 'IMAGE' || media.mimeType !== 'image/jpeg'
    || media.width !== 512 || media.height !== 512 || media.bytes <= 0 || media.bytes > 5 * 1024 * 1024
    || media.storageKey !== `avatars/${media.id}.jpg`) return null;
  return { id: media.id, width: 512, height: 512, mimeType: 'image/jpeg' };
}
