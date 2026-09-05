import { ApiProperty } from '@nestjs/swagger';

import { UserResponseDto } from '../../users/dto/user-response.dto';

export class AuthResponseDto {
  @ApiProperty({ type: String, description: 'Short-lived JWT access token' })
  accessToken!: string;

  @ApiProperty({ type: String, description: 'Opaque rotating refresh token' })
  refreshToken!: string;

  @ApiProperty({ type: String, enum: ['Bearer'], example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({ type: Number, example: 900 })
  accessTokenExpiresIn!: number;

  @ApiProperty({ type: () => UserResponseDto })
  user!: UserResponseDto;
}
