import { ApiProperty } from '@nestjs/swagger';

export class AvatarDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 512 }) width!: number;
  @ApiProperty({ example: 512 }) height!: number;
  @ApiProperty({ enum: ['image/jpeg'] }) mimeType!: 'image/jpeg';
}

export class AvatarResponseDto {
  @ApiProperty({ type: AvatarDto }) avatar!: AvatarDto;
}

export class RemovedAvatarResponseDto {
  @ApiProperty({ type: 'object', additionalProperties: false, nullable: true, enum: [null], description: 'Confirmed absence of a profile avatar' }) avatar!: null;
}
