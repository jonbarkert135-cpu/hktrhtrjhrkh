-- Migration: 0005_integration_framework — P9 integration framework
-- (10_INTEGRATIONS.md §5/§12.1, 09_BACKEND.md §4.1, 20_ROADMAP.md P9 §5.5).
-- Lock impact: none. Creates one enum and five new tables with their indexes and foreign keys.
-- No existing table is altered, so nothing blocks a concurrent read or write.
-- Estimated duration: < 100 ms.
-- Expand/contract: expand only.

CREATE TYPE "run_status" AS ENUM (
  'queued', 'awaiting_approval', 'starting', 'running', 'parsing',
  'succeeded', 'partial', 'failed', 'cancelled', 'timed_out'
);

CREATE TABLE "consents" (
    "id"              TEXT         NOT NULL,
    "org_id"          TEXT         NOT NULL,
    "project_id"      TEXT         NOT NULL,
    "user_id"         TEXT         NOT NULL,
    "integration_id"  VARCHAR(64)  NOT NULL,
    "scope"           VARCHAR(24)  NOT NULL,
    "targets_hash"    VARCHAR(64)  NOT NULL,
    "scope_text_hash" VARCHAR(64)  NOT NULL,
    "accepted_at"     TIMESTAMP(3) NOT NULL,
    "expires_at"      TIMESTAMP(3) NOT NULL,
    "revoked_at"      TIMESTAMP(3),
    "used_at"         TIMESTAMP(3),
    "ip"              VARCHAR(45),
    "user_agent"      VARCHAR(400),
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- safe: the table is created empty in this migration; the index build takes no lock worth naming
CREATE INDEX "consents_project_id_integration_id_user_id_expires_at_idx"
  ON "consents"("project_id", "integration_id", "user_id", "expires_at");

ALTER TABLE "consents"
  ADD CONSTRAINT "consents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "integration_runs" (
    "id"              TEXT         NOT NULL,
    "org_id"          TEXT         NOT NULL,
    "project_id"      TEXT         NOT NULL,
    "board_id"        TEXT         NOT NULL,
    "integration_id"  VARCHAR(64)  NOT NULL,
    "adapter_version" VARCHAR(40)  NOT NULL,
    "tool_version"    VARCHAR(40)  NOT NULL,
    "image_digest"    VARCHAR(80),
    "actor_user_id"   TEXT         NOT NULL,
    "anchor_node_id"  TEXT,
    "input"           JSONB        NOT NULL,
    "input_hash"      VARCHAR(64)  NOT NULL,
    "targets"         JSONB        NOT NULL,
    "consent_id"      TEXT,
    "status"          "run_status" NOT NULL,
    "attempt"         INTEGER      NOT NULL DEFAULT 1,
    "exit_code"       INTEGER,
    "error_code"      VARCHAR(48),
    "error_detail"    JSONB,
    "started_at"      TIMESTAMP(3),
    "finished_at"     TIMESTAMP(3),
    "duration_ms"     INTEGER,
    "stats"           JSONB        NOT NULL DEFAULT '{}',
    "artifacts"       JSONB        NOT NULL DEFAULT '[]',
    "proposal_id"     TEXT,
    "applied_at"      TIMESTAMP(3),
    "parent_run_id"   TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_runs_pkey" PRIMARY KEY ("id")
);

-- safe: the table is created empty in this migration; the index build takes no lock worth naming
CREATE INDEX "integration_runs_project_id_created_at_idx" ON "integration_runs"("project_id", "created_at" DESC);
CREATE INDEX "integration_runs_board_id_created_at_idx" ON "integration_runs"("board_id", "created_at" DESC);
-- safe: new empty table
CREATE INDEX "integration_runs_integration_id_input_hash_created_at_idx"
  ON "integration_runs"("integration_id", "input_hash", "created_at" DESC);
CREATE INDEX "integration_runs_org_id_status_idx" ON "integration_runs"("org_id", "status");

CREATE TABLE "import_proposals" (
    "id"             TEXT         NOT NULL,
    "org_id"         TEXT         NOT NULL,
    "project_id"     TEXT         NOT NULL,
    "board_id"       TEXT         NOT NULL,
    "run_id"         TEXT         NOT NULL,
    "integration_id" VARCHAR(64)  NOT NULL,
    "payload"        JSONB        NOT NULL,
    "summary"        JSONB        NOT NULL DEFAULT '{}',
    "applied_items"  JSONB        NOT NULL DEFAULT '{}',
    "applied_at"     TIMESTAMP(3),
    "applied_by"     TEXT,
    "discarded_at"   TIMESTAMP(3),
    "expires_at"     TIMESTAMP(3) NOT NULL,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_proposals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "import_proposals_board_id_created_at_idx" ON "import_proposals"("board_id", "created_at" DESC);
CREATE INDEX "import_proposals_expires_at_idx" ON "import_proposals"("expires_at");

ALTER TABLE "import_proposals"
  ADD CONSTRAINT "import_proposals_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "import_proposals_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "integration_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "integration_runs"
  ADD CONSTRAINT "integration_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_runs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_runs_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "consents"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_runs_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "import_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_runs_parent_run_id_fkey" FOREIGN KEY ("parent_run_id") REFERENCES "integration_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "run_log_entries" (
    "run_id"  TEXT          NOT NULL,
    "seq"     INTEGER       NOT NULL,
    "at"      TIMESTAMP(3)  NOT NULL,
    "level"   VARCHAR(8)    NOT NULL,
    "phase"   VARCHAR(16)   NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "data"    JSONB,

    CONSTRAINT "run_log_entries_pkey" PRIMARY KEY ("run_id", "seq"),
    CONSTRAINT "run_log_entries_level_check" CHECK ("level" IN ('debug', 'info', 'warn', 'error'))
);

ALTER TABLE "run_log_entries"
  ADD CONSTRAINT "run_log_entries_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "integration_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "api_tokens" (
    "id"           TEXT         NOT NULL,
    "org_id"       TEXT         NOT NULL,
    "user_id"      TEXT         NOT NULL,
    "name"         VARCHAR(120) NOT NULL,
    "prefix"       VARCHAR(16)  NOT NULL,
    "hash"         VARCHAR(255) NOT NULL,
    "scopes"       TEXT[]       NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "expires_at"   TIMESTAMP(3),
    "revoked_at"   TIMESTAMP(3),
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_tokens_prefix_key" ON "api_tokens"("prefix");
CREATE INDEX "api_tokens_org_id_user_id_idx" ON "api_tokens"("org_id", "user_id");

ALTER TABLE "api_tokens"
  ADD CONSTRAINT "api_tokens_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "api_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
