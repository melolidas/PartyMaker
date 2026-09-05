import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListLobbiesQueryDto {
  @ApiPropertyOptional({ maxLength: 100, description: 'Trimmed, case-insensitive literal substring of title or venueName. Empty means no search filter; %, _ and backslash are literal.' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: ['all', 'mine'], default: 'all', description: 'mine: future published lobbies where the Bearer user has a JOINED membership' })
  @IsIn(['all', 'mine'])
  scope: 'all' | 'mine' = 'all';

  @ApiPropertyOptional({ type: 'integer', default: 20, minimum: 1, maximum: 50 })
  @Transform(({ value }: { value: unknown }) => (
    typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value
  ))
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Opaque nextCursor from the previous page', maxLength: 256 })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  after?: string;
}
