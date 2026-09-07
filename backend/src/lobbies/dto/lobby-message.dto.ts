import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, NotContains, Max, MaxLength, Min } from 'class-validator';
import { toTrimmedString } from '../../common/transforms/string.transforms';

export class ListLobbyMessagesQueryDto {
  @ApiPropertyOptional({ type: 'integer', default: 30, minimum: 1, maximum: 50 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value)
  @IsInt() @Min(1) @Max(50)
  limit: number = 30;

  @ApiPropertyOptional({ maxLength: 256, description: 'Opaque nextCursor from the previous page, ordered by createdAt DESC, id DESC' })
  @IsOptional() @IsString() @MaxLength(256)
  before?: string;
}

export class SendLobbyMessageDto {
  @ApiProperty({ format: 'uuid', description: 'Stable UUID for one logical send. Reuse with identical normalized body on explicit retry.' })
  @IsUUID()
  clientMessageId!: string;

  @ApiProperty({ minLength: 1, maxLength: 2000, description: 'Trimmed plain text. NUL is unsupported by PostgreSQL text.' })
  @Transform(toTrimmedString) @IsString() @IsNotEmpty() @MaxLength(2000) @NotContains('\u0000')
  body!: string;
}

export class LobbyMessageAuthorDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() handle!: string;
}
export class LobbyMessageResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) lobbyId!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: LobbyMessageAuthorDto }) author!: LobbyMessageAuthorDto;
}
export class LobbyMessagePageDto {
  @ApiProperty({ type: [LobbyMessageResponseDto] }) items!: LobbyMessageResponseDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
