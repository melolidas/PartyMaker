import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { AvatarDto } from '../avatars/avatar.dto';
import { supportedNotificationTypes, type SupportedNotificationType } from './supported-notification-types';

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 50, default: 20 })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value)
  @IsInt() @Min(1) @Max(50) limit = 20;

  @ApiPropertyOptional({ maxLength: 256, description: 'Opaque cursor: createdAt DESC, id DESC' })
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsString() @MaxLength(256) after?: string;
}
export class NotificationActorDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() handle!: string;
  @ApiProperty({ type: AvatarDto, nullable: true }) avatar!: AvatarDto | null;
}
export class NotificationLobbyDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
}
export class NotificationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: [...supportedNotificationTypes] }) type!: SupportedNotificationType;
  @ApiProperty({ type: String, nullable: true, maxLength: 40, description: 'Title at cancellation, only for LOBBY_CANCELLED; null for LOBBY_JOINED. Does not grant lobby access.' }) lobbyTitleSnapshot!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) readAt!: string | null;
  @ApiProperty({ type: NotificationActorDto, nullable: true, description: 'Current actor profile, not a historical snapshot; null if deleted' }) actor!: NotificationActorDto | null;
  @ApiProperty({ type: NotificationLobbyDto, nullable: true, description: 'Current PUBLISHED lobby for LOBBY_JOINED only; otherwise null' }) lobby!: NotificationLobbyDto | null;
}
export class NotificationPageDto {
  @ApiProperty({ type: [NotificationDto] }) items!: NotificationDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
export class NotificationReadDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'date-time', description: 'First confirmed read timestamp, never rewritten on retry' }) readAt!: string;
}
export class NotificationUnreadCountDto {
  @ApiProperty({ type: 'integer', minimum: 0, description: 'All own unread LOBBY_JOINED and LOBBY_CANCELLED notifications, including null actor/lobby' }) unreadCount!: number;
}
