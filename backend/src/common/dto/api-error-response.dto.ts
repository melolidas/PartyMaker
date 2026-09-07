import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class ApiErrorDetailsDto {
  @ApiProperty({ type: String, example: 'VALIDATION_FAILED' })
  code!: string;

  @ApiProperty({ type: String, example: 'Request validation failed' })
  message!: string;

  @ApiPropertyOptional({ type: [String] })
  details?: string[];
}

export class ApiErrorResponseDto {
  @ApiProperty({ type: Number, example: 400 })
  statusCode!: number;

  @ApiProperty({ type: () => ApiErrorDetailsDto })
  error!: ApiErrorDetailsDto;

  @ApiProperty({ type: String, example: '/api/v1/auth/register' })
  path!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-09-05T12:00:00.000Z',
  })
  timestamp!: string;
}
