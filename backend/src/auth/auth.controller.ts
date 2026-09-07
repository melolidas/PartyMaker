import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { ApiErrorResponseDto } from '../common/dto/api-error-response.dto';
import {
  AUTH_RATE_LIMITS,
  AUTH_RATE_LIMIT_WINDOW_MS,
} from './auth-rate-limit.constants';
import { AuthService } from './auth.service';
import { CurrentAuth } from './decorators/current-auth.decorator';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginRequestDto } from './dto/login-request.dto';
import { RefreshRequestDto } from './dto/refresh-request.dto';
import { RegisterRequestDto } from './dto/register-request.dto';
import { AccessTokenGuard } from './guards/access-token.guard';
import type { AuthContext } from './types/access-token.types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: {
      limit: AUTH_RATE_LIMITS.register,
      ttl: AUTH_RATE_LIMIT_WINDOW_MS,
    },
  })
  @ApiOperation({ summary: 'Register a user and create the first auth session' })
  @ApiBody({ type: RegisterRequestDto })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({
    type: ApiErrorResponseDto,
    description: 'EMAIL_ALREADY_EXISTS or HANDLE_ALREADY_EXISTS',
  })
  @ApiTooManyRequestsResponse({ type: ApiErrorResponseDto })
  register(@Body() input: RegisterRequestDto): Promise<AuthResponseDto> {
    return this.authService.register(input);
  }

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: {
      limit: AUTH_RATE_LIMITS.login,
      ttl: AUTH_RATE_LIMIT_WINDOW_MS,
    },
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a new auth session with email and password' })
  @ApiBody({ type: LoginRequestDto })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: ApiErrorResponseDto })
  login(@Body() input: LoginRequestDto): Promise<AuthResponseDto> {
    return this.authService.login(input);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Atomically rotate an opaque refresh token' })
  @ApiBody({ type: RefreshRequestDto })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  refresh(@Body() input: RefreshRequestDto): Promise<AuthResponseDto> {
    return this.authService.refresh(input);
  }

  @Post('logout')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke the current auth session',
    description: 'The current access token remains valid until its short TTL expires.',
  })
  @ApiNoContentResponse({ description: 'Current auth session revoked' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  async logout(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.authService.logout(auth);
  }
}
