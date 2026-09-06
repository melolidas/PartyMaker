import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AvatarDto } from '../../avatars/avatar.dto';

export class ListLobbyMembersQueryDto {
  @ApiPropertyOptional({ type: 'integer', default: 20, minimum: 1, maximum: 50 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value)
  @IsInt() @Min(1) @Max(50)
  limit: number = 20;

  @ApiPropertyOptional({ maxLength: 256, description: 'Opaque nextCursor; joinedAt ASC, userId ASC' })
  @IsOptional() @IsString() @MaxLength(256)
  after?: string;
}

export class LobbyMemberUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() handle!: string;
  @ApiProperty({ type: AvatarDto, nullable: true }) avatar!: AvatarDto | null;
}
export class LobbyMemberResponseDto {
  @ApiProperty({ type: LobbyMemberUserDto }) user!: LobbyMemberUserDto;
  @ApiProperty() isOrganizer!: boolean;
  @ApiProperty({ format: 'date-time' }) joinedAt!: string;
}
export class LobbyMemberPageDto {
  @ApiProperty({ type: [LobbyMemberResponseDto] }) items!: LobbyMemberResponseDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
