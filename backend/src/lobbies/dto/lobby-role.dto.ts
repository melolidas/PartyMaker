import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength, ValidateIf, NotContains } from 'class-validator';
import { toTrimmedString } from '../../common/transforms/string.transforms';

export class CreateLobbyRoleDto {
  @ApiProperty({ minLength: 1, maxLength: 10, description: 'Trimmed Unicode code points, not UTF-16 units' })
  @Transform(toTrimmedString) @IsString() @MinLength(1) @MaxLength(10) @NotContains('\u0000')
  name!: string;

  @ApiPropertyOptional({ maxLength: 50, default: '', description: 'Trimmed; Unicode code points' })
  @ValidateIf((_o, v: unknown) => v !== undefined)
  @Transform(toTrimmedString) @IsString() @MaxLength(50) @NotContains('\u0000')
  description?: string;
}

export class LobbyRoleDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ maxLength: 10 }) name!: string;
  @ApiProperty({ maxLength: 50 }) description!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Current assignee membership user id, no private profile fields' })
  assignedUserId!: string | null;
}
export class LobbyRolesDto {
  @ApiProperty({ type: [LobbyRoleDto], maxItems: 20, description: 'Creation order; current assignments, not historical message roles' })
  items!: LobbyRoleDto[];
}
