-- raven:initial
-- Migration: 0001_init — P1 foundation schema (orgs, users, auth, projects, boards, audit).
-- Lock impact: none. Creates new objects only; no existing table is touched.
-- Estimated duration: < 100 ms on an empty database.
-- Expand/contract: not applicable (nothing exists yet to retire).
-- Indexes are created non-concurrently on purpose: the tables are empty at creation time, so the
-- lock is instantaneous. Every later migration must use CREATE INDEX CONCURRENTLY.

CREATE TYPE "org_role" AS ENUM ('owner', 'admin', 'editor', 'viewer');

CREATE TABLE "organizations" (
    "id"         TEXT         NOT NULL,
    "slug"       VARCHAR(60)  NOT NULL,
    "name"       VARCHAR(200) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations" ("slug");

CREATE TABLE "users" (
    "id"             TEXT         NOT NULL,
    "email"          VARCHAR(320) NOT NULL,
    "email_verified" BOOLEAN      NOT NULL DEFAULT false,
    "name"           VARCHAR(200) NOT NULL,
    "image"          VARCHAR(2000),
    "locale"         VARCHAR(16)  NOT NULL DEFAULT 'en',
    "timezone"       VARCHAR(64)  NOT NULL DEFAULT 'UTC',
    "last_seen_at"   TIMESTAMP(3),
    "deleted_at"     TIMESTAMP(3),
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users" ("email");
CREATE INDEX "users_last_seen_at_idx" ON "users" ("last_seen_at");

CREATE TABLE "memberships" (
    "id"         TEXT         NOT NULL,
    "org_id"     TEXT         NOT NULL,
    "user_id"    TEXT         NOT NULL,
    "role"       "org_role"   NOT NULL,
    "invited_by" TEXT,
    "joined_at"  TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "memberships_org_id_user_id_key" ON "memberships" ("org_id", "user_id");
CREATE INDEX "memberships_user_id_idx" ON "memberships" ("user_id");
ALTER TABLE "memberships"
    ADD CONSTRAINT "memberships_org_id_fkey" FOREIGN KEY ("org_id")
        REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id")
        REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sessions" (
    "id"         TEXT         NOT NULL,
    "user_id"    TEXT         NOT NULL,
    "token"      VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(400),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions" ("token");
CREATE INDEX "sessions_user_id_idx" ON "sessions" ("user_id");
CREATE INDEX "sessions_expires_at_idx" ON "sessions" ("expires_at");
ALTER TABLE "sessions"
    ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id")
        REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "accounts" (
    "id"                        TEXT         NOT NULL,
    "user_id"                   TEXT         NOT NULL,
    "account_id"                VARCHAR(255) NOT NULL,
    "provider_id"               VARCHAR(64)  NOT NULL,
    "access_token"              TEXT,
    "refresh_token"             TEXT,
    "id_token"                  TEXT,
    "access_token_expires_at"   TIMESTAMP(3),
    "refresh_token_expires_at"  TIMESTAMP(3),
    "scope"                     VARCHAR(1000),
    "password"                  TEXT,
    "created_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                TIMESTAMP(3) NOT NULL,
    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounts_provider_id_account_id_key" ON "accounts" ("provider_id", "account_id");
CREATE INDEX "accounts_user_id_idx" ON "accounts" ("user_id");
ALTER TABLE "accounts"
    ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id")
        REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "projects" (
    "id"          TEXT          NOT NULL,
    "org_id"      TEXT          NOT NULL,
    "key"         VARCHAR(24)   NOT NULL,
    "name"        VARCHAR(200)  NOT NULL,
    "description" VARCHAR(2000),
    "color"       VARCHAR(40),
    "archived_at" TIMESTAMP(3),
    "deleted_at"  TIMESTAMP(3),
    "created_by"  TEXT          NOT NULL,
    "created_at"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3)  NOT NULL,
    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "projects_org_id_key_key" ON "projects" ("org_id", "key");
CREATE INDEX "projects_org_id_archived_at_idx" ON "projects" ("org_id", "archived_at");
-- project.list: filter by org, exclude soft-deleted, order by name.
CREATE INDEX "projects_org_id_deleted_at_name_idx" ON "projects" ("org_id", "deleted_at", "name");
ALTER TABLE "projects"
    ADD CONSTRAINT "projects_org_id_fkey" FOREIGN KEY ("org_id")
        REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "boards" (
    "id"             TEXT         NOT NULL,
    "org_id"         TEXT         NOT NULL,
    "project_id"     TEXT         NOT NULL,
    "title"          VARCHAR(300) NOT NULL,
    "description"    VARCHAR(2000),
    "schema_version" INTEGER      NOT NULL DEFAULT 1,
    "last_edited_at" TIMESTAMP(3),
    "deleted_at"     TIMESTAMP(3),
    "created_by"     TEXT         NOT NULL,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "boards_project_id_deleted_at_idx" ON "boards" ("project_id", "deleted_at");
CREATE INDEX "boards_org_id_last_edited_at_idx" ON "boards" ("org_id", "last_edited_at" DESC);
-- org_id is denormalized for org-scoped queries; the owning FK is project_id (08_DATA_MODEL.md §4.4).
ALTER TABLE "boards"
    ADD CONSTRAINT "boards_project_id_fkey" FOREIGN KEY ("project_id")
        REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- audit_log is APPEND-ONLY (15_SECURITY.md C-42).
-- Enforcement lives in two places:
--   1. code: packages/db exports only recordAudit(); no update/delete helper exists.
--   2. grants: the application role gets INSERT/SELECT only. Run once per environment, as the
--      owner role, after the app role exists (it is not created by this migration):
--        REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM raven_app;
--        GRANT  INSERT, SELECT ON audit_log TO raven_app;
CREATE TABLE "audit_log" (
    "id"          TEXT         NOT NULL,
    "org_id"      TEXT         NOT NULL,
    "actor_id"    TEXT,
    "actor_kind"  VARCHAR(12)  NOT NULL,
    "action"      VARCHAR(64)  NOT NULL,
    "target_kind" VARCHAR(32)  NOT NULL,
    "target_id"   TEXT,
    "ip"          VARCHAR(45),
    "user_agent"  VARCHAR(400),
    "metadata"    JSONB        NOT NULL DEFAULT '{}',
    "outcome"     VARCHAR(16)  NOT NULL,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id"),
    -- an audited row is never edited, so updated_at must equal created_at forever
    CONSTRAINT "audit_log_immutable_timestamps" CHECK ("updated_at" = "created_at"),
    CONSTRAINT "audit_log_outcome_check" CHECK ("outcome" IN ('success', 'denied', 'error')),
    CONSTRAINT "audit_log_actor_kind_check" CHECK ("actor_kind" IN ('user', 'system', 'integration'))
);
CREATE INDEX "audit_log_org_id_created_at_idx" ON "audit_log" ("org_id", "created_at" DESC);
CREATE INDEX "audit_log_org_id_action_created_at_idx" ON "audit_log" ("org_id", "action", "created_at" DESC);
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log" ("actor_id");
CREATE INDEX "audit_log_target_id_idx" ON "audit_log" ("target_id");
ALTER TABLE "audit_log"
    ADD CONSTRAINT "audit_log_org_id_fkey" FOREIGN KEY ("org_id")
        REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id")
        REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
