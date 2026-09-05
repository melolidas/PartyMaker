import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiCreatedResponse, ApiExtraModels, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';

import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AuthContext } from '../auth/types/access-token.types';
import { ApiErrorResponseDto } from '../common/dto/api-error-response.dto';
import { ListLobbiesQueryDto } from './dto/list-lobbies-query.dto';
import { CreateLobbyRequestDto } from './dto/create-lobby-request.dto';
import { LobbyPageResponseDto, LobbyResponseDto } from './dto/lobby-response.dto';
import { LobbiesService } from './lobbies.service';

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
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Membership actions do not accept body or query fields' });
    }
  }

  @Post()
  @ApiOperation({ summary: 'Publish a lobby and atomically join its authenticated organizer' })
  @ApiBody({ type: CreateLobbyRequestDto })
  @ApiCreatedResponse({ type: LobbyResponseDto })
  create(@Body() input: CreateLobbyRequestDto, @CurrentAuth() auth: AuthContext): Promise<LobbyResponseDto> {
    return this.lobbies.create(input, auth.userId);
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
