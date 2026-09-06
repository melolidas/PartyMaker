import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LobbyCategory } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListLobbyHistoryQueryDto {
  @ApiPropertyOptional({ type: 'integer', default: 20, minimum: 1, maximum: 50 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value)
  @IsInt() @Min(1) @Max(50)
  limit: number = 20;

  @ApiPropertyOptional({ maxLength: 256, description: 'Opaque nextCursor: startsAt DESC, id DESC' })
  @IsOptional() @IsString() @MaxLength(256)
  after?: string;
}

export class LobbyHistoryItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: LobbyCategory, nullable: true }) category!: LobbyCategory | null;
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiProperty() timeZone!: string;
  @ApiProperty() isOnline!: boolean;
  @ApiProperty({ type: String, nullable: true }) venueName!: string | null;
  @ApiProperty() isOrganizer!: boolean;
}

export class LobbyHistoryPageDto {
  @ApiProperty({ type: [LobbyHistoryItemDto] }) items!: LobbyHistoryItemDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
