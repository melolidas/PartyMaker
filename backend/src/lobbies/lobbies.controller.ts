import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiCreatedResponse, ApiExtraModels, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';

import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AuthContext } from '../auth/types/access-token.types';
import { ApiErrorResponseDto } from '../common/dto/api-error-response.dto';
import { ListLobbiesQueryDto } from './dto/list-lobbies-query.dto';
import { CreateLobbyRequestDto } from './dto/create-lobby-request.dto';
import { LobbyPageResponseDto, LobbyResponseDto } from './dto/lobby-response.dto';
import { LobbiesService } from './lobbies.service';
import { CancelLobbyResponseDto } from './dto/cancel-lobby-response.dto';
import { UpdateLobbyRequestDto } from './dto/update-lobby-request.dto';

@ApiTags('lobbies')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiBadRequestResponse({ type: ApiErrorResponseDto })
@UseGuards(AccessTokenGuard)
@Controller('lobbies')
export class LobbiesController {
  constructor(@Inject(LobbiesService) private readonly lobbies: LobbiesService) {}

  @Post(':id/join')
  @HttpCode(200)
  @ApiOperation({ summary: 'Join as the Bearer user; repeated JOINED is a no-op', description: 'No body fields accepted. LEFT may rejoin before startsAt if capacity allows. REMOVED cannot self-rejoin.' })
  @ApiOkResponse({ type: LobbyResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'LOBBY_FULL, LOBBY_STARTED or LOBBY_MEMBERSHIP_REMOVED' })
  join(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() auth: AuthContext, @Body() body: unknown, @Query() query: Record<string, unknown>): Promise<LobbyResponseDto> {
    this.assertEmptyBody(body);
    this.assertEmptyBody(query);
    return this.lobbies.changeMembership(id, auth.userId, 'join');
  }

  @Post(':id/leave')
  @HttpCode(200)
  @ApiOperation({ summary: 'Leave as the Bearer user, preserving membership history', description: 'No body fields accepted. LEFT/absent membership is a no-op, including after startsAt. Organizer cannot leave. REMOVED cannot be changed to LEFT.' })
  @ApiOkResponse({ type: LobbyResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'LOBBY_ORGANIZER_CANNOT_LEAVE, LOBBY_STARTED or LOBBY_MEMBERSHIP_REMOVED' })
  leave(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() auth: AuthContext, @Body() body: unknown, @Query() query: Record<string, unknown>): Promise<LobbyResponseDto> {
    this.assertEmptyBody(body);
    this.assertEmptyBody(query);
    return this.lobbies.changeMembership(id, auth.userId, 'leave');
  }

  private assertEmptyBody(body: unknown): void {
    if (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0)) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'This action does not accept body or query fields' });
    }
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a future published lobby as its organizer', description: 'No body or query fields. Organizer comes from Lobby.organizerId, not membership. CANCELLED replay by the organizer is a no-op even after startsAt; timestamps and all membership/message history are preserved. Cancelled lobbies disappear from catalogs/inbox and chat becomes unavailable. No restore or physical deletion.' })
  @ApiOkResponse({ type: CancelLobbyResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto, description: 'LOBBY_ORGANIZER_REQUIRED: non-organizer of a PUBLISHED lobby' })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto, description: 'LOBBY_NOT_FOUND: missing/DRAFT/COMPLETED, or CANCELLED for a non-organizer' })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'LOBBY_STARTED: PUBLISHED event has started. CANCELLED replay is checked first.' })
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() auth: AuthContext, @Body() body: unknown, @Query() query: Record<string, unknown>): Promise<CancelLobbyResponseDto> {
    this.assertEmptyBody(body); this.assertEmptyBody(query);
    return this.lobbies.cancel(id, auth.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Publish a lobby and atomically join its authenticated organizer' })
  @ApiBody({ type: CreateLobbyRequestDto })
  @ApiCreatedResponse({ type: LobbyResponseDto })
  create(@Body() input: CreateLobbyRequestDto, @CurrentAuth() auth: AuthContext): Promise<LobbyResponseDto> {
    return this.lobbies.create(input, auth.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit basic fields of a future lobby as organizer', description: 'Only changed title/description/category/capacity and paired isOnline/venueName. Empty body and query fields rejected. Schedule, organizer, status and history never change. Serialized with join/leave/cancel/send: independent fields are merged; same field uses last successful commit. No participant notifications.' })
  @ApiBody({ type: UpdateLobbyRequestDto })
  @ApiOkResponse({ type: LobbyResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto, description: 'LOBBY_ORGANIZER_REQUIRED' })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto, description: 'LOBBY_NOT_FOUND: missing or not PUBLISHED' })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'LOBBY_STARTED, LOBBY_CAPACITY_BELOW_JOINED, LOBBY_CAPACITY_BELOW_MIN_PARTICIPANTS' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() auth: AuthContext,
    @Body() input: UpdateLobbyRequestDto, @Query() query: Record<string, unknown>): Promise<LobbyResponseDto> {
    this.assertEmptyBody(query);
    const fields: (keyof UpdateLobbyRequestDto)[] = ['title', 'description', 'category', 'capacity', 'isOnline', 'venueName'];
    if (Array.isArray(input) || !fields.some(key => input[key] !== undefined) || input.venueName?.includes('\u0000')) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'A nonempty patch of supported fields is required; NUL is not supported' });
    }
    return this.lobbies.update(id, auth.userId, input);
  }

  @Get()
  @ApiOperation({ summary: 'Upcoming published lobbies, ordered by startsAt ASC then id ASC', description: 'Optional literal case-insensitive substring q matches title OR venueName in PostgreSQL before pagination. Search, scope and cursor apply together.' })
  @ApiOkResponse({ type: LobbyPageResponseDto })
  @ApiExtraModels(ListLobbiesQueryDto)
  list(@Query() query: ListLobbiesQueryDto, @CurrentAuth() auth: AuthContext): Promise<LobbyPageResponseDto> {
    return this.lobbies.list(query, auth.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read a published lobby (past published events remain viewable)' })
  @ApiOkResponse({ type: LobbyResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() auth: AuthContext): Promise<LobbyResponseDto> {
    return this.lobbies.get(id, auth.userId);
  }
}
