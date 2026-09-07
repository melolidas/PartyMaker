import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber } from 'class-validator';

const EXTROVERSION_LEVELS = [
  1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5,
  6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10,
] as const;

export class UpdateExtroversionRequestDto {
  @ApiProperty({
    type: Number,
    minimum: 1,
    maximum: 10,
    multipleOf: 0.5,
    example: 6.5,
  })
  @IsNumber()
  @IsIn(EXTROVERSION_LEVELS, {
    message: 'level must be between 1 and 10 in increments of 0.5',
  })
  level!: number;
}
