import { ApiProperty } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'email', example: 'user@example.com' })
  email!: string;

  @ApiProperty({ type: String, example: 'alex' })
  handle!: string;

  @ApiProperty({ type: String, example: 'Alex' })
  displayName!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  bio!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Bishkek' })
  city!: string | null;

  @ApiProperty({ type: String, nullable: true, minLength: 2, maxLength: 2, example: 'KG' })
  countryCode!: string | null;

  @ApiProperty({ type: Number, minimum: 1, maximum: 10, multipleOf: 0.5, example: 6.5 })
  extroversionLevel!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}
