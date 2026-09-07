import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { toTrimmedLowercase } from '../../common/transforms/string.transforms';

export class LoginRequestDto {
  @ApiProperty({ type: String, format: 'email', example: 'user@example.com' })
  @Transform(toTrimmedLowercase)
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ type: String, format: 'password', writeOnly: true })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
