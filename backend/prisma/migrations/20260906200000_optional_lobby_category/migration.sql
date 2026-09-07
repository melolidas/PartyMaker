-- Preserve every existing enum value. New lobbies may have no category;
-- no default, backfill, enum replacement or record rewrite is needed.
ALTER TABLE "Lobby" ALTER COLUMN "category" DROP NOT NULL;
