import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { AccessTokenPayload } from './types/access-token.types';

export type RefreshTokenMaterial = {
  plaintext: string;
  hash: string;
  expiresAt: Date;
};

@Injectable()
export class AuthTokenService {
  readonly accessTokenExpiresIn: number;
  private readonly accessSecret: string;
  private readonly refreshTtlDays: number;

  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(ConfigService) configService: ConfigService,
  ) {
    this.accessSecret = configService.getOrThrow<string>('JWT_ACCESS_SECRET');
    this.accessTokenExpiresIn = configService.getOrThrow<number>('JWT_ACCESS_TTL_SECONDS');
    this.refreshTtlDays = configService.getOrThrow<number>('JWT_REFRESH_TTL_DAYS');
  }

  signAccessToken(userId: string, sessionId: string): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: userId,
      sid: sessionId,
    };
    return this.jwtService.signAsync(payload, {
      secret: this.accessSecret,
      algorithm: 'HS256',
      expiresIn: this.accessTokenExpiresIn,
    });
  }

  verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.jwtService.verifyAsync<AccessTokenPayload>(token, {
      secret: this.accessSecret,
      algorithms: ['HS256'],
    });
  }

  createRefreshToken(now = new Date()): RefreshTokenMaterial {
    const plaintext = randomBytes(48).toString('base64url');
    return {
      plaintext,
      hash: this.hashRefreshToken(plaintext),
      expiresAt: new Date(now.getTime() + this.refreshTtlDays * 24 * 60 * 60 * 1000),
    };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
