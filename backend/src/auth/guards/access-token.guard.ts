import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';

import { AuthTokenService } from '../auth-token.service';
import type { AuthenticatedRequest } from '../types/access-token.types';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    @Inject(AuthTokenService) private readonly tokenService: AuthTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request.headers.authorization);

    if (!token) {
      throw this.unauthorized();
    }

    try {
      const payload = await this.tokenService.verifyAccessToken(token);
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
        throw this.unauthorized();
      }
      request.auth = {
        userId: payload.sub,
        sessionId: payload.sid,
      };
      return true;
    } catch {
      throw this.unauthorized();
    }
  }

  private extractBearerToken(header: string | undefined): string | undefined {
    if (!header) return undefined;
    const parts = header.trim().split(/\s+/);
    if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') {
      return undefined;
    }
    return parts[1] || undefined;
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_ACCESS_TOKEN',
      message: 'A valid access token is required',
    });
  }
}
