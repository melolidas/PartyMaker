-- Additive only. Existing lobbies have no activity roles; no data is rewritten.
CREATE TABLE "LobbyActivityRole" (
  "id" UUID NOT NULL,
  "lobby_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "name" VARCHAR(10) NOT NULL,
  "description" VARCHAR(50) NOT NULL DEFAULT '',
  CONSTRAINT "LobbyActivityRole_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LobbyActivityRole_position_check" CHECK ("position" >= 0 AND "position" < 20),
  CONSTRAINT "LobbyActivityRole_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 10)
);
CREATE UNIQUE INDEX "LobbyActivityRole_lobby_id_id_key" ON "LobbyActivityRole"("lobby_id", "id");
CREATE UNIQUE INDEX "LobbyActivityRole_lobby_id_position_key" ON "LobbyActivityRole"("lobby_id", "position");
ALTER TABLE "LobbyActivityRole" ADD CONSTRAINT "LobbyActivityRole_lobby_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "Lobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LobbyRoleAssignment" (
  "lobby_id" UUID NOT NULL,
  "role_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  CONSTRAINT "LobbyRoleAssignment_pkey" PRIMARY KEY ("lobby_id", "role_id")
);
CREATE UNIQUE INDEX "LobbyRoleAssignment_lobby_id_user_id_key" ON "LobbyRoleAssignment"("lobby_id", "user_id");
-- Composite FKs prohibit cross-lobby assignment, including via direct SQL.
ALTER TABLE "LobbyRoleAssignment" ADD CONSTRAINT "LobbyRoleAssignment_lobby_id_role_id_fkey" FOREIGN KEY ("lobby_id", "role_id") REFERENCES "LobbyActivityRole"("lobby_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LobbyRoleAssignment" ADD CONSTRAINT "LobbyRoleAssignment_lobby_id_user_id_fkey" FOREIGN KEY ("lobby_id", "user_id") REFERENCES "LobbyMember"("lobby_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;
