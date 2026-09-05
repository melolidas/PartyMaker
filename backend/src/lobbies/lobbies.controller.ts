import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiExtraModels, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';

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

  @Post()
  @ApiOperation({ summary: 'Publish a lobby and atomically join its authenticated organizer' })
  @ApiBody({ type: CreateLobbyRequestDto })
  @ApiCreatedResponse({ type: LobbyResponseDto })
  create(@Body() input: CreateLobbyRequestDto, @CurrentAuth() auth: AuthContext): Promise<LobbyResponseDto> {
    return this.lobbies.create(input, auth.userId);
  }

  @Get()
  @ApiOperation({ summary: 'Upcoming published lobbies, ordered by startsAt ASC then id ASC' })
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
