import { Body, Controller, Get, Inject, Patch, Put, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AuthContext } from '../auth/types/access-token.types';
import { ApiErrorResponseDto } from '../common/dto/api-error-response.dto';
import { UpdateExtroversionRequestDto } from './dto/update-extroversion-request.dto';
import { UpdateProfileRequestDto } from './dto/update-profile-request.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard)
@Controller('users')
export class UsersController {
  constructor(@Inject(UsersService) private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the current user profile' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  getMe(@CurrentAuth() auth: AuthContext): Promise<UserResponseDto> {
    return this.usersService.getMe(auth);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update editable fields of the current profile' })
  @ApiBody({ type: UpdateProfileRequestDto })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  updateMe(
    @CurrentAuth() auth: AuthContext,
    @Body() input: UpdateProfileRequestDto,
  ): Promise<UserResponseDto> {
    return this.usersService.updateMe(auth, input);
  }

  @Put('me/extroversion')
  @ApiOperation({ summary: 'Set the current user extroversion level' })
  @ApiBody({ type: UpdateExtroversionRequestDto })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  updateExtroversion(
    @CurrentAuth() auth: AuthContext,
    @Body() input: UpdateExtroversionRequestDto,
  ): Promise<UserResponseDto> {
    return this.usersService.updateExtroversion(auth, input);
  }
}
