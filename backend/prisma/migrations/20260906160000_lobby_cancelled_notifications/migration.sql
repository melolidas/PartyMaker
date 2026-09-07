-- Additive only: existing notifications keep a NULL snapshot. No backfill.
ALTER TYPE "NotificationType" ADD VALUE 'LOBBY_CANCELLED';

ALTER TABLE "Notification" ADD COLUMN "lobby_title_snapshot" VARCHAR(40);
