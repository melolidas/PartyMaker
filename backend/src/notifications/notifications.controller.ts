import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiExtraModels, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import type { AuthContext } from '../auth/types/access-token.types';
import { ApiErrorResponseDto } from '../common/dto/api-error-response.dto';
import { ListNotificationsQueryDto, NotificationPageDto, NotificationReadDto, NotificationUnreadCountDto } from './notification.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications') @ApiTags('notifications') @ApiBearerAuth('access-token') @UseGuards(AccessTokenGuard)
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiBadRequestResponse({ type: ApiErrorResponseDto, description: 'VALIDATION_FAILED: invalid/unknown query, cursor, UUID or body' })
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}
  @Get('unread-count')
  @ApiOperation({ summary: 'Count own unread LOBBY_JOINED and LOBBY_CANCELLED notifications', description: 'No query parameters. Exact database count across all pages; null actor/lobby, current membership and lobby status do not exclude notifications. No other types.' })
  @ApiOkResponse({ type: NotificationUnreadCountDto })
  unreadCount(@CurrentAuth() auth: AuthContext, @Query() query: Record<string, unknown>): Promise<NotificationUnreadCountDto> {
    if (Object.keys(query).length) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'This endpoint accepts no query parameters' });
    return this.notifications.unreadCount(auth.userId);
  }
  @Get()
  @ApiExtraModels(ListNotificationsQueryDto)
  @ApiOperation({ summary: 'Own LOBBY_JOINED and LOBBY_CANCELLED notifications', description: 'Shared supported-type/recipient filter before pagination. Current actor profile; JOINED exposes only a current PUBLISHED lobby. CANCELLED exposes a historical lobbyTitleSnapshot, never lobby access. A past join does not guarantee current membership. One page snapshot; refresh/reopen for external updates. No push or polling.' })
  @ApiOkResponse({ type: NotificationPageDto })
  list(@CurrentAuth() auth: AuthContext, @Query() query: ListNotificationsQueryDto): Promise<NotificationPageDto> {
    return this.notifications.list(auth.userId, query);
  }
  @Post(':id/read') @HttpCode(200)
  @ApiOperation({ summary: 'Mark one own supported notification read', description: 'No body/query fields. Idempotent: repeated/concurrent requests retain first readAt. Unknown, foreign and unsupported notifications all return the same 404.' })
  @ApiOkResponse({ type: NotificationReadDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto, description: 'NOTIFICATION_NOT_FOUND' })
  read(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown, @Query() query: Record<string, unknown>): Promise<NotificationReadDto> {
    if ((body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)) || Object.keys(query).length) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'This action accepts no body or query fields' });
    }
    return this.notifications.read(auth.userId, id);
  }
}
