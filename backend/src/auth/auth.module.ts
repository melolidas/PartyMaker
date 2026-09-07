import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import {
  AUTH_RATE_LIMITS,
  AUTH_RATE_LIMIT_WINDOW_MS,
} from './auth-rate-limit.constants';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';
import { AccessTokenGuard } from './guards/access-token.guard';

@Module({
  imports: [
    JwtModule.register({}),
    ThrottlerModule.forRoot({
      errorMessage: 'Too many authentication attempts. Try again later.',
      throttlers: [
        {
          limit: AUTH_RATE_LIMITS.login,
          ttl: AUTH_RATE_LIMIT_WINDOW_MS,
        },
      ],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthTokenService, AccessTokenGuard, ThrottlerGuard],
  exports: [AccessTokenGuard, AuthTokenService],
})
export class AuthModule {}
