import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsISO31661Alpha2,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import {
  toTrimmedString,
  toTrimmedUppercase,
} from '../../common/transforms/string.transforms';

export class UpdateProfileRequestDto {
  @ApiPropertyOptional({ type: String, maxLength: 80, example: 'Alex' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(toTrimmedString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  displayName?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300, example: null })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  bio?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100, example: 'Bishkek' })
  @IsOptional()
  @Transform(toTrimmedString)
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 2,
    maxLength: 2,
    example: 'KG',
  })
  @IsOptional()
  @Transform(toTrimmedUppercase)
  @IsString()
  @IsISO31661Alpha2({
    message: 'countryCode must be a valid ISO 3166-1 alpha-2 code',
  })
  countryCode?: string | null;
}
