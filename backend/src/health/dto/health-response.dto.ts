import { ApiProperty } from '@nestjs/swagger';

class DatabaseHealthDto {
  @ApiProperty({ type: String, example: 'connected', enum: ['connected'] })
  status!: 'connected';

  @ApiProperty({ type: String, example: 'partymaker' })
  name!: string;
}

export class HealthResponseDto {
  @ApiProperty({ type: String, example: 'ok', enum: ['ok'] })
  status!: 'ok';

  @ApiProperty({ type: () => DatabaseHealthDto })
  database!: DatabaseHealthDto;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-09-04T12:00:00.000Z',
  })
  timestamp!: string;
}
