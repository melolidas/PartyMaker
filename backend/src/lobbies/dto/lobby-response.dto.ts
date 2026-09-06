import { ApiProperty } from '@nestjs/swagger';
import { LobbyCategory, LobbyMemberStatus } from '@prisma/client';

export class LobbyResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: LobbyCategory, nullable: true }) category!: LobbyCategory | null;
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiProperty({ example: 'Asia/Bishkek' }) timeZone!: string;
  @ApiProperty() isOnline!: boolean;
  @ApiProperty({ type: String, nullable: true }) venueName!: string | null;
  @ApiProperty() capacity!: number;
  @ApiProperty({ description: 'Only JOINED memberships, including the organizer if joined' })
  joinedCount!: number;
  @ApiProperty({ description: 'Current user has a JOINED membership' }) isJoined!: boolean;
  @ApiProperty({ enum: LobbyMemberStatus, nullable: true, description: 'Only the Bearer user membership; null if never joined' })
  membershipStatus!: LobbyMemberStatus | null;
  @ApiProperty({ description: 'Bearer user is the lobby organizer; cannot leave in this stage' }) isOrganizer!: boolean;
  @ApiProperty({
    type: Number, nullable: true, minimum: 1, maximum: 10, multipleOf: 0.5,
    description: 'Mean of JOINED users, rounded to the nearest 0.5 (ties up); null when empty',
  })
  groupExtroversionLevel!: number | null;
}

export class LobbyPageResponseDto {
  @ApiProperty({ type: [LobbyResponseDto] }) items!: LobbyResponseDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Pass as after; null when no more results' })
  nextCursor!: string | null;
}

export class LobbyRecommendationsResponseDto {
  @ApiProperty({ type: [LobbyResponseDto], maxItems: 5, description: 'Positive lexical matches only; empty for cold start or no matches. No scores or source history exposed.' })
  items!: LobbyResponseDto[];
}
