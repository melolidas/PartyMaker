import { Body, Controller, Get, Inject, Patch, Put, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiExtraModels,
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
import { LobbyHistoryService } from './lobby-history.service';
import { ListLobbyHistoryQueryDto, LobbyHistoryPageDto } from './dto/lobby-history.dto';

@ApiTags('users')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard)
@Controller('users')
export class UsersController {
  constructor(@Inject(UsersService) private readonly usersService: UsersService,
    @Inject(LobbyHistoryService) private readonly history: LobbyHistoryService) {}

  @Get('me/lobby-history')
  @ApiExtraModels(ListLobbyHistoryQueryDto)
  @ApiOperation({ summary: 'Read your scheduled participation history', description: 'Only own JOINED memberships in PUBLISHED/COMPLETED lobbies with startsAt <= one serverNow per request. Organizer receives no membership bypass. This is not proof of attendance or completion. startsAt DESC, id DESC; independent pages are not frozen, Refresh discovers new leading records. Read-only projection does not extend access to details, chat or members.' })
  @ApiOkResponse({ type: LobbyHistoryPageDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto, description: 'VALIDATION_FAILED: limit, cursor or unknown query fields' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  lobbyHistory(@CurrentAuth() auth: AuthContext, @Query() query: ListLobbyHistoryQueryDto): Promise<LobbyHistoryPageDto> {
    return this.history.list(auth.userId, query);
  }

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
