import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiExtraModels, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AuthContext } from '../auth/types/access-token.types';
import { ApiErrorResponseDto } from '../common/dto/api-error-response.dto';
import { ListLobbyMembersQueryDto, LobbyMemberPageDto } from './dto/lobby-member.dto';
import { LobbyMembersService } from './lobby-members.service';

@ApiTags('lobby-members')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard)
@Controller('lobbies/:id/members')
export class LobbyMembersController {
  constructor(@Inject(LobbyMembersService) private readonly members: LobbyMembersService) {}

  @Get()
  @ApiOperation({ summary: 'Read current JOINED participants', description: 'JOINED-only access, including organizer and past PUBLISHED events. joinedAt ASC, userId ASC. Access and page share one snapshot; separate pages are not frozen. A read begun before leave/cancel may complete. Refresh to see external changes.' })
  @ApiOkResponse({ type: LobbyMemberPageDto })
  @ApiExtraModels(ListLobbyMembersQueryDto)
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto, description: 'LOBBY_MEMBERS_FORBIDDEN: JOINED membership required' })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto, description: 'LOBBY_NOT_FOUND: missing or not PUBLISHED' })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto, description: 'VALIDATION_FAILED: UUID, limit, cursor or unknown query fields' })
  list(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() auth: AuthContext, @Query() query: ListLobbyMembersQueryDto): Promise<LobbyMemberPageDto> {
    return this.members.list(id, auth.userId, query);
  }
}
