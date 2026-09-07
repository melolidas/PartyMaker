import type { Prisma } from '@prisma/client';

import type { UserResponseDto } from './dto/user-response.dto';
import { avatarSelect, toAvatar } from '../avatars/avatar-record';

export const userResponseSelect = {
  id: true,
  email: true,
  handle: true,
  displayName: true,
  bio: true,
  city: true,
  countryCode: true,
  extroversionScoreX2: true,
  createdAt: true,
  updatedAt: true,
  avatar: { select: avatarSelect },
} satisfies Prisma.UserSelect;

export type UserResponseRecord = Prisma.UserGetPayload<{
  select: typeof userResponseSelect;
}>;

export function toUserResponse(user: UserResponseRecord): UserResponseDto {
  return {
    avatar: toAvatar(user.avatar, user.id),
    id: user.id,
    email: user.email,
    handle: user.handle,
    displayName: user.displayName,
    bio: user.bio,
    city: user.city,
    countryCode: user.countryCode,
    extroversionLevel: user.extroversionScoreX2 / 2,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
