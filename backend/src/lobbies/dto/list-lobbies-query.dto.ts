import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListLobbiesQueryDto {
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
