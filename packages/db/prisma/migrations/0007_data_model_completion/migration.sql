-- Migration: 0007_data_model_completion — Repository, AiAction, WorkspaceSetting (§27).
-- Lock impact: none. Creates three new tables with their indexes; no existing table is altered.
-- Estimated duration: < 50 ms.
-- Expand/contract: expand only.

CREATE TABLE "repositories" (
    "id"              TEXT         NOT NULL,
    "repo_key"        VARCHAR(255) NOT NULL,
    "host"            VARCHAR(64)  NOT NULL,
    "owner"           VARCHAR(128) NOT NULL,
    "name"            VARCHAR(128) NOT NULL,
    "default_branch"  VARCHAR(128),
    "last_head_sha"   VARCHAR(64),
    "last_fetched_at" TIMESTAMP(3),
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- safe: the table is created empty in this migration, so the index build takes no meaningful lock
CREATE UNIQUE INDEX "repositories_repo_key_key" ON "repositories"("repo_key");

CREATE TABLE "ai_actions" (
    "id"          TEXT         NOT NULL,
    "org_id"      TEXT         NOT NULL,
    "project_id"  TEXT,
    "board_id"    TEXT,
    "capability"  VARCHAR(64)  NOT NULL,
    "model"       VARCHAR(120) NOT NULL,
    "status"      VARCHAR(16)  NOT NULL,
    "input_hash"  VARCHAR(64)  NOT NULL,
    "output"      JSONB,
    "error"       VARCHAR(500),
    "tokens_in"   INTEGER,
    "tokens_out"  INTEGER,
    "started_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "ai_actions_pkey" PRIMARY KEY ("id")
);

-- safe: same empty table, created above in this migration
CREATE INDEX "ai_actions_org_id_started_at_idx" ON "ai_actions"("org_id", "started_at" DESC);
-- safe: same empty table, created above in this migration
CREATE INDEX "ai_actions_capability_input_hash_idx" ON "ai_actions"("capability", "input_hash");

ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "workspace_settings" (
    "org_id"     TEXT        NOT NULL,
    "key"        VARCHAR(64) NOT NULL,
    "value"      JSONB       NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "workspace_settings_pkey" PRIMARY KEY ("org_id", "key")
);

ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
