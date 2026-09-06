import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type { AuthContext } from '../auth/types/access-token.types';
import type { UpdateExtroversionRequestDto } from './dto/update-extroversion-request.dto';
import type { UpdateProfileRequestDto } from './dto/update-profile-request.dto';
import type { UserResponseDto } from './dto/user-response.dto';
import { toUserResponse, userResponseSelect } from './user-response.mapper';

@Injectable()
export class UsersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getMe(auth: AuthContext): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: auth.userId },
      select: userResponseSelect,
    });
    if (!user) throw this.invalidAccessToken();
    return toUserResponse(user);
  }

  async updateMe(
    auth: AuthContext,
    input: UpdateProfileRequestDto,
  ): Promise<UserResponseDto> {
    const data: Prisma.UserUpdateInput = {};
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.bio !== undefined) data.bio = input.bio;
    if (input.city !== undefined) data.city = input.city;
    if (input.countryCode !== undefined) data.countryCode = input.countryCode;

    try {
      const user = await this.prisma.user.update({
        where: { id: auth.userId },
        data,
        select: userResponseSelect,
      });
      return toUserResponse(user);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2025'
      ) {
        throw this.invalidAccessToken();
      }
      throw error;
    }
  }

  async updateExtroversion(
    auth: AuthContext,
    input: UpdateExtroversionRequestDto,
  ): Promise<UserResponseDto> {
    try {
      const user = await this.prisma.user.update({
        where: { id: auth.userId },
        data: { extroversionScoreX2: Math.round(input.level * 2) },
        select: userResponseSelect,
      });
      return toUserResponse(user);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2025'
      ) {
        throw this.invalidAccessToken();
      }
      throw error;
    }
  }

  private invalidAccessToken(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_ACCESS_TOKEN',
      message: 'A valid access token is required',
    });
  }
}
