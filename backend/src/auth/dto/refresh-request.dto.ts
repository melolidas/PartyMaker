import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshRequestDto {
  @ApiProperty({
    type: String,
    description: 'Opaque refresh token returned by register, login, or refresh',
    writeOnly: true,
  })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
