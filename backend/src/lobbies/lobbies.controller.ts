import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiExtraModels, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';

import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AuthContext } from '../auth/types/access-token.types';
import { ApiErrorResponseDto } from '../common/dto/api-error-response.dto';
import { ListLobbiesQueryDto } from './dto/list-lobbies-query.dto';
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
