-- Migration: 0002_files — P4 file uploads (09_BACKEND.md §7).
-- Lock impact: none. Creates a new enum, a new table and its indexes; no existing table is touched.
-- Estimated duration: < 50 ms.
-- Expand/contract: expand only. Indexes are created non-concurrently because the table is created
-- in this same migration and is therefore empty and unobservable while the lock is held.

CREATE TYPE "file_state" AS ENUM ('pending', 'scanning', 'ready', 'failed', 'quarantined');

CREATE TABLE "files" (
    "id"              TEXT          NOT NULL,
    "org_id"          TEXT          NOT NULL,
    "project_id"      TEXT          NOT NULL,
    "board_id"        TEXT,
    "filename"        VARCHAR(255)  NOT NULL,
    "mime"            VARCHAR(255)  NOT NULL,
    "kind"            VARCHAR(16)   NOT NULL,
    "bytes"           BIGINT        NOT NULL,
    "sha256"          VARCHAR(64),
    "storage_key"     VARCHAR(1024) NOT NULL,
    "state"           "file_state"  NOT NULL DEFAULT 'pending',
    "failure_code"    VARCHAR(64),
    "failure_message" VARCHAR(500),
    "thumb_key"       VARCHAR(1024),
    "preview_key"     VARCHAR(1024),
    "page_count"      INTEGER,
    "width"           INTEGER,
    "height"          INTEGER,
    "deleted_at"      TIMESTAMP(3),
    "created_by"      TEXT          NOT NULL,
    "created_at"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3)  NOT NULL,
    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "files_project_id_deleted_at_created_at_idx" ON "files" ("project_id", "deleted_at", "created_at" DESC);
CREATE INDEX "files_org_id_sha256_state_idx" ON "files" ("org_id", "sha256", "state");

ALTER TABLE "files" ADD CONSTRAINT "files_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "files" ADD CONSTRAINT "files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
