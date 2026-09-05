import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { LobbyCategory } from '@prisma/client';

export class ListChatsQueryDto {
  @ApiPropertyOptional({ type: 'integer', default: 20, minimum: 1, maximum: 50 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value)
  @IsInt() @Min(1) @Max(50) limit = 20;

  @ApiPropertyOptional({ maxLength: 256, description: 'Opaque nextCursor: activityAt DESC, lobbyId DESC. Pages are not a frozen snapshot.' })
  @IsOptional() @IsString() @MaxLength(256) after?: string;
}
export class ChatLobbyDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: LobbyCategory }) category!: LobbyCategory;
}
export class ChatAuthorDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
}
export class ChatLastMessageDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ maxLength: 160, description: 'First 160 Unicode code points of plain text, no markup interpretation' }) preview!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: ChatAuthorDto }) author!: ChatAuthorDto;
}
export class ChatResponseDto {
  @ApiProperty({ type: ChatLobbyDto }) lobby!: ChatLobbyDto;
  @ApiProperty({ type: ChatLastMessageDto, nullable: true }) lastMessage!: ChatLastMessageDto | null;
  @ApiProperty({ format: 'date-time', description: 'Latest nondeleted message createdAt, or lobby createdAt for an empty chat' }) activityAt!: string;
}
export class ChatPageDto {
  @ApiProperty({ type: [ChatResponseDto] }) items!: ChatResponseDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
