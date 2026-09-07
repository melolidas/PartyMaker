import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiExtraModels, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import type { AuthContext } from '../auth/types/access-token.types';
import { ApiErrorResponseDto } from '../common/dto/api-error-response.dto';
import { ChatPageDto, ListChatsQueryDto } from './chat.dto';
import { ChatsService } from './chats.service';

@Controller('chats')
@ApiTags('chats')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard)
export class ChatsController {
  constructor(@Inject(ChatsService) private readonly chats: ChatsService) {}
  @Get()
  @ApiOperation({ summary: 'Own JOINED chats, including past PUBLISHED events', description: 'Latest nondeleted message or lobby createdAt defines activityAt. activityAt DESC, lobbyId DESC. Membership filtering precedes pagination. Pages are not a frozen snapshot: new messages can lift a chat above an already passed cursor; refresh for current order. No unread counters or archives.' })
  @ApiOkResponse({ type: ChatPageDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto, description: 'VALIDATION_FAILED: malformed/unknown query parameters or cursor' })
  @ApiExtraModels(ListChatsQueryDto)
  list(@CurrentAuth() auth: AuthContext, @Query() query: ListChatsQueryDto): Promise<ChatPageDto> {
    return this.chats.list(auth.userId, query);
  }
}
