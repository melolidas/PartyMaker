import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import {
  toTrimmedLowercase,
  toTrimmedString,
} from '../../common/transforms/string.transforms';

export class RegisterRequestDto {
  @ApiProperty({ type: String, format: 'email', example: 'user@example.com' })
  @Transform(toTrimmedLowercase)
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ type: String, format: 'password', minLength: 8, writeOnly: true })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ type: String, minLength: 3, maxLength: 30, example: 'alex' })
  @Transform(toTrimmedLowercase)
  @IsString()
  @Length(3, 30)
  @Matches(/^[a-z0-9_]+$/, {
    message: 'handle may contain only lowercase letters, digits, and underscores',
  })
  handle!: string;

  @ApiProperty({ type: String, maxLength: 80, example: 'Alex' })
  @Transform(toTrimmedString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  displayName!: string;
}
