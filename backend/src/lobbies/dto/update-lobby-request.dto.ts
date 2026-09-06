import { ApiPropertyOptional } from '@nestjs/swagger';
import { LobbyCategory } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, NotContains, Validate, ValidateIf } from 'class-validator';
import { toTrimmedString } from '../../common/transforms/string.transforms';
import { LobbyVenue } from './create-lobby-request.dto';

const hasVenuePair = (input: UpdateLobbyRequestDto) => input.isOnline !== undefined || input.venueName !== undefined;

/** Undefined means omitted. Null is accepted ONLY for an online venueName. */
export class UpdateLobbyRequestDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 40 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(toTrimmedString) @IsString() @IsNotEmpty() @MaxLength(40) @NotContains('\u0000')
  title?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 200 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(toTrimmedString) @IsString() @IsNotEmpty() @MaxLength(200) @NotContains('\u0000')
  description?: string;

  @ApiPropertyOptional({ enum: LobbyCategory })
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsEnum(LobbyCategory)
  category?: LobbyCategory;

  @ApiPropertyOptional({ type: 'integer', minimum: 2, maximum: 2147483647 })
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsInt() @Min(2) @Max(2147483647)
  capacity?: number;

  @ApiPropertyOptional({ description: 'Must be sent together with venueName' })
  @ValidateIf(hasVenuePair) @IsBoolean()
  isOnline?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 140, description: 'Together with isOnline: null online, nonempty trimmed name offline' })
  @ValidateIf(hasVenuePair) @Transform(toTrimmedString) @Validate(LobbyVenue)
  venueName?: string | null;
}
