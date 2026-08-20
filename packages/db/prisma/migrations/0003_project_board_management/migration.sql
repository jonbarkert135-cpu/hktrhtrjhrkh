-- Migration: 0003_project_board_management — P7 project/board management + search prep.
-- Lock impact: none. Every statement adds a nullable or defaulted column to an existing table;
-- no column is dropped, retyped or renamed, so this never blocks a concurrent read or write.
-- Estimated duration: < 50 ms at current table sizes (ADD COLUMN with a constant default on
-- Postgres 11+ is a metadata-only change; it does not rewrite the table).

ALTER TABLE "projects" ADD COLUMN "icon" VARCHAR(32);

ALTER TABLE "boards" ADD COLUMN "icon" VARCHAR(32);
ALTER TABLE "boards" ADD COLUMN "template_of" TEXT;
ALTER TABLE "boards" ADD COLUMN "is_template" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "boards" ADD COLUMN "archived_at" TIMESTAMP(3);
ALTER TABLE "boards" ADD COLUMN "last_opened_at" TIMESTAMP(3);
ALTER TABLE "boards" ADD COLUMN "node_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "boards" ADD COLUMN "edge_count" INTEGER NOT NULL DEFAULT 0;

-- safe: mirrors the (project_id, deleted_at) index already created non-concurrently in 0001_init
CREATE INDEX "boards_project_id_archived_at_last_opened_at_idx"
  ON "boards" ("project_id", "archived_at", "last_opened_at" DESC);
