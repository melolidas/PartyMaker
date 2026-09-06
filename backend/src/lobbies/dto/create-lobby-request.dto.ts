import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LobbyCategory } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsTimeZone, Matches, Max, MaxLength, Min, Validate, ValidatorConstraint } from 'class-validator';
import type { ValidationArguments, ValidatorConstraintInterface } from 'class-validator';

import { toTrimmedString } from '../../common/transforms/string.transforms';
import { parseLobbyInstant } from '../lobby-instant';

@ValidatorConstraint({ name: 'futureLobbyInstant', async: false })
export class FutureLobbyInstant implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    const instant = parseLobbyInstant(value);
    return instant !== null && instant.getTime() > Date.now();
  }
  defaultMessage(): string {
    return 'startsAt must be a future RFC3339 instant (years 0001–9999, at most 3 fractional digits)';
  }
}

@ValidatorConstraint({ name: 'lobbyVenue', async: false })
export class LobbyVenue implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const { isOnline } = args.object as { isOnline?: unknown };
    return isOnline === true ? value === null : isOnline === false
      && typeof value === 'string' && value.trim().length > 0 && Array.from(value).length <= 140;
  }
  defaultMessage(): string { return 'venueName must be null online, or a nonempty string up to 140 characters offline'; }
}

export class CreateLobbyRequestDto {
  @ApiProperty({ minLength: 1, maxLength: 40 })
  @Transform(toTrimmedString) @IsString() @IsNotEmpty() @MaxLength(40)
  title!: string;

  @ApiProperty({ minLength: 1, maxLength: 200 })
  @Transform(toTrimmedString) @IsString() @IsNotEmpty() @MaxLength(200)
  description!: string;

  @ApiPropertyOptional({ enum: LobbyCategory, nullable: true, description: 'Optional legacy category. Omitted or null is stored as null; a supplied enum value is preserved.' })
  @IsOptional() @IsEnum(LobbyCategory)
  category?: LobbyCategory | null;

  @ApiProperty({ format: 'date-time', example: '2030-09-06T13:00:00.000Z', description: 'Future RFC3339 instant, explicit Z or offset; years 0001–9999, millisecond precision' })
  @Validate(FutureLobbyInstant)
  startsAt!: string;

  @ApiProperty({ example: 'Asia/Bishkek', maxLength: 64 })
  @IsString() @MaxLength(64) @Matches(/^[A-Za-z][A-Za-z0-9_+/-]*$/) @IsTimeZone()
  timeZone!: string;

  @ApiProperty({ type: 'integer', minimum: 2, maximum: 2147483647 })
  @IsInt() @Min(2) @Max(2147483647)
  capacity!: number;

  @ApiProperty() @IsBoolean()
  isOnline!: boolean;

  @ApiProperty({ type: String, nullable: true, maxLength: 140, description: 'Required: null online, nonempty trimmed venue offline' })
  @Transform(toTrimmedString) @Validate(LobbyVenue)
  venueName!: string | null;
}
