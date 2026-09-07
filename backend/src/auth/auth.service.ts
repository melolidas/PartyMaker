import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

import { PrismaService } from '../prisma/prisma.service';
import {
  toUserResponse,
  userResponseSelect,
} from '../users/user-response.mapper';
import { AuthTokenService } from './auth-token.service';
import type { AuthResponseDto } from './dto/auth-response.dto';
import type { LoginRequestDto } from './dto/login-request.dto';
import type { RefreshRequestDto } from './dto/refresh-request.dto';
import type { RegisterRequestDto } from './dto/register-request.dto';
import type { AuthContext } from './types/access-token.types';

const loginUserSelect = {
  ...userResponseSelect,
  passwordHash: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthTokenService) private readonly tokenService: AuthTokenService,
  ) {}

  async register(input: RegisterRequestDto): Promise<AuthResponseDto> {
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });
    const refreshToken = this.tokenService.createRefreshToken();

    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            email: input.email,
            passwordHash,
            handle: input.handle,
            displayName: input.displayName,
          },
          select: userResponseSelect,
        });
        const session = await transaction.authSession.create({
          data: {
            userId: user.id,
            tokenHash: refreshToken.hash,
            expiresAt: refreshToken.expiresAt,
          },
          select: { id: true },
        });
        return { user, sessionId: session.id };
      });

      return this.buildAuthResponse(
        result.user,
        result.sessionId,
        refreshToken.plaintext,
      );
    } catch (error: unknown) {
      this.rethrowRegistrationError(error);
    }
  }

  async login(input: LoginRequestDto): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: loginUserSelect,
    });

    if (!user) {
      await argon2.hash(input.password, { type: argon2.argon2id });
      throw this.invalidCredentials();
    }

    const passwordMatches = await this.passwordMatches(
      user.passwordHash,
      input.password,
    );

    if (!passwordMatches) {
      throw this.invalidCredentials();
    }

    const refreshToken = this.tokenService.createRefreshToken();
    const session = await this.prisma.authSession.create({
      data: {
        userId: user.id,
        tokenHash: refreshToken.hash,
        expiresAt: refreshToken.expiresAt,
      },
      select: { id: true },
    });

    return this.buildAuthResponse(
      user,
      session.id,
      refreshToken.plaintext,
    );
  }

  async refresh(input: RefreshRequestDto): Promise<AuthResponseDto> {
    const oldTokenHash = this.tokenService.hashRefreshToken(input.refreshToken);
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: oldTokenHash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
    const now = new Date();

    if (!session || session.revokedAt || session.expiresAt <= now) {
      throw this.invalidRefreshToken();
    }

    const nextRefreshToken = this.tokenService.createRefreshToken(now);
    const accessToken = await this.tokenService.signAccessToken(
      session.userId,
      session.id,
    );
    const rotation = await this.prisma.authSession.updateMany({
      where: {
        id: session.id,
        tokenHash: oldTokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        tokenHash: nextRefreshToken.hash,
        expiresAt: nextRefreshToken.expiresAt,
      },
    });

    if (rotation.count !== 1) {
      throw this.invalidRefreshToken();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: userResponseSelect,
    });
    if (!user) {
      throw this.invalidRefreshToken();
    }

    return {
      accessToken,
      refreshToken: nextRefreshToken.plaintext,
      tokenType: 'Bearer',
      accessTokenExpiresIn: this.tokenService.accessTokenExpiresIn,
      user: toUserResponse(user),
    };
  }

  async logout(auth: AuthContext): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: {
        id: auth.sessionId,
        userId: auth.userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  private async buildAuthResponse(
    user: Parameters<typeof toUserResponse>[0],
    sessionId: string,
    refreshToken: string,
  ): Promise<AuthResponseDto> {
    return {
      accessToken: await this.tokenService.signAccessToken(user.id, sessionId),
      refreshToken,
      tokenType: 'Bearer',
      accessTokenExpiresIn: this.tokenService.accessTokenExpiresIn,
      user: toUserResponse(user),
    };
  }

  private rethrowRegistrationError(error: unknown): never {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError)
      || error.code !== 'P2002'
    ) {
      throw error;
    }

    const target = error.meta?.target;
    const fields = Array.isArray(target)
      ? target.map(String)
      : typeof target === 'string'
        ? [target]
        : [];

    if (fields.some((field) => field.toLowerCase().includes('email'))) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'An account with this email already exists',
      });
    }
    if (fields.some((field) => field.toLowerCase().includes('handle'))) {
      throw new ConflictException({
        code: 'HANDLE_ALREADY_EXISTS',
        message: 'An account with this handle already exists',
      });
    }

    throw error;
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  }

  private async passwordMatches(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  private invalidRefreshToken(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_REFRESH_TOKEN',
      message: 'Refresh token is invalid or expired',
    });
  }
}
