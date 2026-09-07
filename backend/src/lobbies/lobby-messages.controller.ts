import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiExtraModels, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AuthContext } from '../auth/types/access-token.types';
import { ApiErrorResponseDto } from '../common/dto/api-error-response.dto';
import { ListLobbyMessagesQueryDto, LobbyMessagePageDto, LobbyMessageResponseDto, SendLobbyMessageDto } from './dto/lobby-message.dto';
import { LobbyMessagesService } from './lobby-messages.service';

// Validates even POST query fields: no alternate author/lobby selectors.
class NoMessageQueryDto {}

@ApiTags('lobby-messages')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiForbiddenResponse({ type: ApiErrorResponseDto, description: 'LOBBY_CHAT_FORBIDDEN: JOINED membership required, including for organizers' })
@ApiNotFoundResponse({ type: ApiErrorResponseDto, description: 'LOBBY_NOT_FOUND: missing or not PUBLISHED' })
@ApiBadRequestResponse({ type: ApiErrorResponseDto, description: 'VALIDATION_FAILED' })
@UseGuards(AccessTokenGuard)
@Controller('lobbies/:id/messages')
export class LobbyMessagesController {
  constructor(@Inject(LobbyMessagesService) private readonly messages: LobbyMessagesService) {}

  @Get()
  @ApiOperation({ summary: 'Read JOINED-only history, newest first', description: 'createdAt DESC, id DESC. Deleted messages excluded. startsAt does not close chat. Manual refresh; a read begun before leave may complete.' })
  @ApiOkResponse({ type: LobbyMessagePageDto })
  @ApiExtraModels(ListLobbyMessagesQueryDto)
  list(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() auth: AuthContext, @Query() query: ListLobbyMessagesQueryDto): Promise<LobbyMessagePageDto> {
    return this.messages.list(id, auth.userId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Send plain text with a stable clientMessageId', description: 'First insert: 201. Same UUID/author/lobby/trimmed body: 200, original createdAt unchanged. Different payload/owner/lobby or deleted id: 409 MESSAGE_ID_CONFLICT, no foreign data. Access is rechecked under the same lobby row lock as join/leave.' })
  @ApiCreatedResponse({ type: LobbyMessageResponseDto })
  @ApiBody({ type: SendLobbyMessageDto })
  @ApiOkResponse({ type: LobbyMessageResponseDto, description: 'Idempotent repeat' })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'MESSAGE_ID_CONFLICT' })
  async send(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() auth: AuthContext,
    @Body() input: SendLobbyMessageDto, @Query() _query: NoMessageQueryDto, @Res({ passthrough: true }) res: Response): Promise<LobbyMessageResponseDto> {
    const result = await this.messages.send(id, auth.userId, input);
    res.status(result.created ? 201 : 200);
    return result.message;
  }
}
