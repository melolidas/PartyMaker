-- CreateEnum
CREATE TYPE "LobbyCategory" AS ENUM ('DRINKS', 'GAMING', 'FOOD', 'SPORT', 'MOVIES', 'OUTDOORS');

-- CreateEnum
CREATE TYPE "LobbyStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LobbyMemberRole" AS ENUM ('ORGANIZER', 'MEMBER');

-- CreateEnum
CREATE TYPE "LobbyMemberStatus" AS ENUM ('JOINED', 'LEFT', 'REMOVED');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE');

-- CreateEnum
CREATE TYPE "MomentVisibility" AS ENUM ('PUBLIC', 'FOLLOWERS');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('LOBBY_JOINED', 'MOMENT_COMMENTED', 'MOMENT_LIKED', 'LOBBY_INVITED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "handle" VARCHAR(30) NOT NULL,
    "display_name" VARCHAR(80) NOT NULL,
    "bio" VARCHAR(300),
    "city" VARCHAR(100),
    "country_code" CHAR(2),
    "avatar_media_id" UUID,
    "extroversion_score_x2" INTEGER NOT NULL DEFAULT 11,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL DEFAULT 'IMAGE',
    "storage_key" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lobby" (
    "id" UUID NOT NULL,
    "organizer_id" UUID NOT NULL,
    "title" VARCHAR(40) NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "category" "LobbyCategory" NOT NULL,
    "status" "LobbyStatus" NOT NULL DEFAULT 'PUBLISHED',
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "venue_name" VARCHAR(140),
    "address" VARCHAR(240),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "time_zone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Bishkek',
    "min_participants" INTEGER NOT NULL DEFAULT 2,
    "capacity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Lobby_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LobbyMember" (
    "lobby_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "LobbyMemberRole" NOT NULL DEFAULT 'MEMBER',
    "status" "LobbyMemberStatus" NOT NULL DEFAULT 'JOINED',
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(3),

    CONSTRAINT "LobbyMember_pkey" PRIMARY KEY ("lobby_id","user_id")
);

-- CreateTable
CREATE TABLE "LobbyMedia" (
    "lobby_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_cover" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LobbyMedia_pkey" PRIMARY KEY ("lobby_id","media_id")
);

-- CreateTable
CREATE TABLE "LobbyMessage" (
    "id" UUID NOT NULL,
    "lobby_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "LobbyMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LobbyInvite" (
    "id" UUID NOT NULL,
    "lobby_id" UUID NOT NULL,
    "inviter_id" UUID NOT NULL,
    "invitee_id" UUID NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMPTZ(3),

    CONSTRAINT "LobbyInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Moment" (
    "id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "lobby_id" UUID,
    "caption" VARCHAR(1000) NOT NULL,
    "visibility" "MomentVisibility" NOT NULL DEFAULT 'PUBLIC',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "Moment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MomentMedia" (
    "moment_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MomentMedia_pkey" PRIMARY KEY ("moment_id","media_id")
);

-- CreateTable
CREATE TABLE "MomentLike" (
    "moment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MomentLike_pkey" PRIMARY KEY ("moment_id","user_id")
);

-- CreateTable
CREATE TABLE "MomentComment" (
    "id" UUID NOT NULL,
    "moment_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "MomentComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Follow" (
    "follower_id" UUID NOT NULL,
    "following_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("follower_id","following_id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "actor_id" UUID,
    "type" "NotificationType" NOT NULL,
    "lobby_id" UUID,
    "moment_id" UUID,
    "comment_id" UUID,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "User_avatar_media_id_key" ON "User"("avatar_media_id");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_token_hash_key" ON "AuthSession"("token_hash");

-- CreateIndex
CREATE INDEX "AuthSession_user_id_expires_at_idx" ON "AuthSession"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_storage_key_key" ON "MediaAsset"("storage_key");

-- CreateIndex
CREATE INDEX "Lobby_status_starts_at_idx" ON "Lobby"("status", "starts_at");

-- CreateIndex
CREATE INDEX "Lobby_organizer_id_status_idx" ON "Lobby"("organizer_id", "status");

-- CreateIndex
CREATE INDEX "LobbyMember_user_id_status_idx" ON "LobbyMember"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LobbyMedia_lobby_id_position_key" ON "LobbyMedia"("lobby_id", "position");

-- CreateIndex
CREATE INDEX "LobbyMessage_lobby_id_created_at_id_idx" ON "LobbyMessage"("lobby_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "LobbyInvite_invitee_id_status_idx" ON "LobbyInvite"("invitee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LobbyInvite_lobby_id_invitee_id_key" ON "LobbyInvite"("lobby_id", "invitee_id");

-- CreateIndex
CREATE INDEX "Moment_created_at_id_idx" ON "Moment"("created_at", "id");

-- CreateIndex
CREATE INDEX "Moment_author_id_created_at_idx" ON "Moment"("author_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "MomentMedia_moment_id_position_key" ON "MomentMedia"("moment_id", "position");

-- CreateIndex
CREATE INDEX "MomentComment_moment_id_created_at_id_idx" ON "MomentComment"("moment_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "Follow_following_id_idx" ON "Follow"("following_id");

-- CreateIndex
CREATE INDEX "Notification_recipient_id_read_at_created_at_idx" ON "Notification"("recipient_id", "read_at", "created_at");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_avatar_media_id_fkey" FOREIGN KEY ("avatar_media_id") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lobby" ADD CONSTRAINT "Lobby_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyMember" ADD CONSTRAINT "LobbyMember_lobby_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "Lobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyMember" ADD CONSTRAINT "LobbyMember_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyMedia" ADD CONSTRAINT "LobbyMedia_lobby_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "Lobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyMedia" ADD CONSTRAINT "LobbyMedia_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyMessage" ADD CONSTRAINT "LobbyMessage_lobby_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "Lobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyMessage" ADD CONSTRAINT "LobbyMessage_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyInvite" ADD CONSTRAINT "LobbyInvite_lobby_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "Lobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyInvite" ADD CONSTRAINT "LobbyInvite_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyInvite" ADD CONSTRAINT "LobbyInvite_invitee_id_fkey" FOREIGN KEY ("invitee_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Moment" ADD CONSTRAINT "Moment_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Moment" ADD CONSTRAINT "Moment_lobby_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "Lobby"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MomentMedia" ADD CONSTRAINT "MomentMedia_moment_id_fkey" FOREIGN KEY ("moment_id") REFERENCES "Moment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MomentMedia" ADD CONSTRAINT "MomentMedia_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MomentLike" ADD CONSTRAINT "MomentLike_moment_id_fkey" FOREIGN KEY ("moment_id") REFERENCES "Moment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MomentLike" ADD CONSTRAINT "MomentLike_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MomentComment" ADD CONSTRAINT "MomentComment_moment_id_fkey" FOREIGN KEY ("moment_id") REFERENCES "Moment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MomentComment" ADD CONSTRAINT "MomentComment_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_following_id_fkey" FOREIGN KEY ("following_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_lobby_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "Lobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_moment_id_fkey" FOREIGN KEY ("moment_id") REFERENCES "Moment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "MomentComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Domain checks that Prisma schema cannot currently express.
ALTER TABLE "User"
ADD CONSTRAINT "User_extroversion_score_x2_check"
CHECK ("extroversion_score_x2" BETWEEN 2 AND 20);

ALTER TABLE "Lobby"
ADD CONSTRAINT "Lobby_capacity_check"
CHECK ("capacity" >= 2);

ALTER TABLE "Lobby"
ADD CONSTRAINT "Lobby_min_participants_check"
CHECK ("min_participants" >= 2 AND "min_participants" <= "capacity");

ALTER TABLE "Lobby"
ADD CONSTRAINT "Lobby_coordinate_pair_check"
CHECK (
  ("latitude" IS NULL AND "longitude" IS NULL)
  OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL)
);

ALTER TABLE "Lobby"
ADD CONSTRAINT "Lobby_latitude_check"
CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90);

ALTER TABLE "Lobby"
ADD CONSTRAINT "Lobby_longitude_check"
CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180);

-- PostgreSQL partial index: at most one cover image per lobby.
CREATE UNIQUE INDEX "LobbyMedia_one_cover_per_lobby"
ON "LobbyMedia" ("lobby_id")
WHERE "is_cover" = true;
