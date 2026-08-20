-- Migration: 0003_sync_collab — P8 sync & collaboration (08_DATA_MODEL.md §4, RAVEN-SPEC/20_ROADMAP.md P8 §4).
-- Lock impact: none. Adds nullable/defaulted columns to "boards" (fast metadata-only ALTERs on
-- Postgres 16) and creates four new tables with their indexes; no existing table is rewritten.
-- Estimated duration: < 200 ms on a table with tens of thousands of boards.
-- Expand/contract: expand only.

ALTER TABLE "boards"
  ADD COLUMN "last_projected_at" TIMESTAMP(3),
  ADD COLUMN "projection_failed" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "nodes" (
    "id"             TEXT          NOT NULL,
    "board_id"       TEXT          NOT NULL,
    "type"           VARCHAR(64)   NOT NULL,
    "title"          VARCHAR(500)  NOT NULL,
    "x"              DOUBLE PRECISION NOT NULL,
    "y"              DOUBLE PRECISION NOT NULL,
    "tags"           TEXT[]        NOT NULL,
    "status"         VARCHAR(16)   NOT NULL,
    "data"           JSONB         NOT NULL DEFAULT '{}',
    "version"        INTEGER       NOT NULL,
    "doc_updated_at" TIMESTAMP(3)  NOT NULL,
    "deleted_at"     TIMESTAMP(3),
    "created_at"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3)  NOT NULL,

    CONSTRAINT "nodes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "nodes_board_id_deleted_at_idx" ON "nodes"("board_id", "deleted_at");

ALTER TABLE "nodes"
  ADD CONSTRAINT "nodes_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "edges" (
    "id"               TEXT          NOT NULL,
    "board_id"         TEXT          NOT NULL,
    "type"             VARCHAR(64)   NOT NULL,
    "source_node_id"   TEXT          NOT NULL,
    "target_node_id"   TEXT          NOT NULL,
    "status"           VARCHAR(16)   NOT NULL,
    "data"             JSONB         NOT NULL DEFAULT '{}',
    "version"          INTEGER       NOT NULL,
    "doc_updated_at"   TIMESTAMP(3)  NOT NULL,
    "deleted_at"       TIMESTAMP(3),
    "created_at"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3)  NOT NULL,

    CONSTRAINT "edges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "edges_board_id_deleted_at_idx" ON "edges"("board_id", "deleted_at");
CREATE INDEX "edges_board_id_source_node_id_idx" ON "edges"("board_id", "source_node_id");
CREATE INDEX "edges_board_id_target_node_id_idx" ON "edges"("board_id", "target_node_id");

ALTER TABLE "edges"
  ADD CONSTRAINT "edges_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "board_snapshots" (
    "id"           TEXT         NOT NULL,
    "board_id"     TEXT         NOT NULL,
    "seq"          INTEGER      NOT NULL,
    "binary"       BYTEA        NOT NULL,
    "state_vector" BYTEA        NOT NULL,
    "kind"         VARCHAR(16)  NOT NULL DEFAULT 'current',
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "board_snapshots_board_id_seq_key" ON "board_snapshots"("board_id", "seq");
CREATE INDEX "board_snapshots_board_id_kind_created_at_idx" ON "board_snapshots"("board_id", "kind", "created_at" DESC);

ALTER TABLE "board_snapshots"
  ADD CONSTRAINT "board_snapshots_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "comments" (
    "id"          TEXT         NOT NULL,
    "board_id"    TEXT         NOT NULL,
    "parent_id"   TEXT,
    "anchor"      JSONB        NOT NULL,
    "body"        VARCHAR(8000) NOT NULL,
    "author_id"   TEXT         NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "comments_board_id_resolved_at_idx" ON "comments"("board_id", "resolved_at");
CREATE INDEX "comments_parent_id_idx" ON "comments"("parent_id");

ALTER TABLE "comments"
  ADD CONSTRAINT "comments_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "presence_log" (
    "id"       TEXT         NOT NULL,
    "board_id" TEXT         NOT NULL,
    "user_id"  TEXT         NOT NULL,
    "event"    VARCHAR(16)  NOT NULL,
    "at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "presence_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "presence_log_board_id_at_idx" ON "presence_log"("board_id", "at" DESC);

ALTER TABLE "presence_log"
  ADD CONSTRAINT "presence_log_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
