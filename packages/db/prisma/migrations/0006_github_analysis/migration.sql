-- Migration: 0006_github_analysis — repository analysis cache (11_GITHUB.md §5.10, §6).
-- Lock impact: none. Creates one new table with its indexes; no existing table is altered.
-- Estimated duration: < 50 ms.
-- Expand/contract: expand only.

CREATE TABLE "github_analyses" (
    "id"               TEXT         NOT NULL,
    "repo_key"         VARCHAR(255) NOT NULL,
    "head_sha"         VARCHAR(64)  NOT NULL,
    "analyzer_version" VARCHAR(32)  NOT NULL,
    "payload"          JSONB        NOT NULL,
    "proposal"         JSONB,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_analyses_pkey" PRIMARY KEY ("id")
);

-- safe: the table is created empty in this migration, so both index builds take no meaningful lock
CREATE UNIQUE INDEX "github_analyses_repo_key_head_sha_analyzer_version_key"
  ON "github_analyses"("repo_key", "head_sha", "analyzer_version");
-- safe: same empty table, created above in this migration
CREATE INDEX "github_analyses_repo_key_created_at_idx"
  ON "github_analyses"("repo_key", "created_at" DESC);
