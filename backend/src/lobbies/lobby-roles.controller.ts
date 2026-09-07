import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AuthContext } from '../auth/types/access-token.types';
import { ApiErrorResponseDto } from '../common/dto/api-error-response.dto';
import { LobbyRolesDto } from './dto/lobby-role.dto';
import { LobbyRolesService } from './lobby-roles.service';

@ApiTags('lobby roles') @ApiBearerAuth('access-token') @UseGuards(AccessTokenGuard)
@ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
@ApiBadRequestResponse({ type: ApiErrorResponseDto })
@ApiNotFoundResponse({ type: ApiErrorResponseDto, description: 'LOBBY_NOT_FOUND or LOBBY_ROLE_NOT_FOUND (also for a role from another lobby)' })
@ApiForbiddenResponse({ type: ApiErrorResponseDto, description: 'LOBBY_CHAT_FORBIDDEN: JOINED membership required, including organizer' })
@Controller('lobbies/:id/roles')
export class LobbyRolesController {
  constructor(@Inject(LobbyRolesService) private readonly roles: LobbyRolesService) {}
  private empty(...values: unknown[]) {
    if (values.some(v => v !== undefined && (v === null || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length))) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'No body or query fields accepted' });
    }
  }
  @Get() @ApiOkResponse({ type: LobbyRolesDto })
  @ApiOperation({ summary: 'Current optional duties and assignments in creation order', description: 'JOINED/PUBLISHED only, even after startsAt. Max 20. Not authorization roles. Current assignments can be mapped to message/member user ids without fetching histories or private profiles.' })
  list(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAuth() auth: AuthContext, @Query() query: unknown, @Body() body: unknown) {
    this.empty(query, body); return this.roles.list(id, auth.userId);
  }
  @Post(':roleId/select') @HttpCode(200) @ApiOkResponse({ type: LobbyRolesDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'LOBBY_ROLE_TAKEN: keeps previous assignment intact' })
  @ApiOperation({ summary: 'Atomically replace own optional role', description: 'Only Bearer user. Identical retries are safe; one slot per role and one role per lobby member. A conflicting new role never removes the previous role.' })
  select(@Param('id', new ParseUUIDPipe()) id: string, @Param('roleId', new ParseUUIDPipe()) roleId: string,
    @CurrentAuth() auth: AuthContext, @Query() query: unknown, @Body() body: unknown) {
    this.empty(query, body); return this.roles.change(id, roleId, auth.userId, 'select');
  }
  @Post(':roleId/release') @HttpCode(200) @ApiOkResponse({ type: LobbyRolesDto })
  @ApiOperation({ summary: 'Release only the named own role', description: 'Safe no-op when not owned, including late release of A after selecting B. Does not leave lobby. Selection is never restored by rejoining.' })
  release(@Param('id', new ParseUUIDPipe()) id: string, @Param('roleId', new ParseUUIDPipe()) roleId: string,
    @CurrentAuth() auth: AuthContext, @Query() query: unknown, @Body() body: unknown) {
    this.empty(query, body); return this.roles.change(id, roleId, auth.userId, 'release');
  }
}
