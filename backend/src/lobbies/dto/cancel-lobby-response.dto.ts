import { ApiProperty } from '@nestjs/swagger';

export class CancelLobbyResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['CANCELLED'] }) status!: 'CANCELLED';
}
