import type { Prisma } from '@prisma/client';

import type { UserResponseDto } from './dto/user-response.dto';

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
} satisfies Prisma.UserSelect;

export type UserResponseRecord = Prisma.UserGetPayload<{
  select: typeof userResponseSelect;
}>;

export function toUserResponse(user: UserResponseRecord): UserResponseDto {
  return {
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
