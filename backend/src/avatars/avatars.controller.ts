import { BadRequestException, Body, Controller, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConsumes, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiPayloadTooLargeResponse, ApiProduces, ApiResponse, ApiTags, ApiUnauthorizedResponse, ApiUnsupportedMediaTypeResponse } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import type { AuthContext } from '../auth/types/access-token.types';
import { ApiErrorResponseDto } from '../common/dto/api-error-response.dto';
import { AvatarResponseDto } from './avatar.dto';
import { AvatarUploadInterceptor } from './avatar-upload.interceptor';
import { AvatarsService } from './avatars.service';

@ApiTags('avatars')
@Controller()
export class AvatarsController {
  constructor(@Inject(AvatarsService) private readonly avatars: AvatarsService) {}

  @Post('users/me/avatar')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth('access-token')
  @UseInterceptors(AvatarUploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Replace your public profile avatar', description: 'One file only, no body/query fields. JPEG/PNG, matching MIME, <=5 MiB, <=20 MP, one static frame. Server auto-orients/crops to 512x512 JPEG without original metadata. Original is never published. Old assets retained but no longer served. Uncertain failures require profile refresh and explicit retry, not automatic retry.' })
  @ApiBody({ schema: { type: 'object', required: ['file'], additionalProperties: false, properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOkResponse({ type: AvatarResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto, description: 'VALIDATION_FAILED: multipart shape; AVATAR_INVALID_IMAGE: corrupt/undecodable image' })
  @ApiPayloadTooLargeResponse({ type: ApiErrorResponseDto, description: 'AVATAR_TOO_LARGE (5 MiB) or AVATAR_PIXEL_LIMIT (20 MP)' })
  @ApiUnsupportedMediaTypeResponse({ type: ApiErrorResponseDto, description: 'AVATAR_UNSUPPORTED_FORMAT: non-JPEG/PNG, MIME mismatch or animation' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiResponse({ status: 503, type: ApiErrorResponseDto, description: 'AVATAR_STORAGE_UNAVAILABLE: disk preparation failed' })
  @ApiResponse({ status: 500, type: ApiErrorResponseDto, description: 'Unconfirmed database outcome; re-read profile before explicit retry' })
  replace(@CurrentAuth() auth: AuthContext, @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown, @Query() query: Record<string, unknown>): Promise<AvatarResponseDto> {
    if (!file || (body && Object.keys(body).length) || Object.keys(query).length) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Exactly one file and no other fields are required' });
    }
    return this.avatars.replace(auth.userId, file);
  }

  @Get('media/avatars/:id')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Read a currently assigned public processed avatar', description: 'Public, no Bearer required. Only assigned server-processed JPEGs; no static uploads directory, original, demo, temporary, orphan or former avatar access. Downloaded public copies cannot be revoked. An in-flight read may finish across replacement.' })
  @ApiProduces('image/jpeg')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto, description: 'AVATAR_NOT_FOUND: not assigned/processed or file unavailable' })
  async get(@Param('id', new ParseUUIDPipe()) id: string): Promise<StreamableFile> {
    return new StreamableFile(await this.avatars.readAssigned(id), { type: 'image/jpeg' });
  }
}
