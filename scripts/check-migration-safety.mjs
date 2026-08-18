#!/usr/bin/env node
// 19_DEPLOYMENT.md §7: expand/contract only. Destructive or lock-taking DDL must be labelled.
// Labels are line comments inside the migration SQL:
//   -- raven:contract  retires <expand-migration-name>   → allows DROP/RENAME/ALTER TYPE
//   -- raven:no-transaction                              → required for CREATE INDEX CONCURRENTLY
// Any other justification uses `-- safe: <reason>` on the line above the statement.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { repoRoot, exists, rel, report } from './lib.mjs';

const MIGRATIONS = path.join(repoRoot, 'packages', 'db', 'prisma', 'migrations');
if (!exists(MIGRATIONS)) {
  console.log('check-migration-safety: no migrations yet');
  process.exit(0);
}

const DESTRUCTIVE = [
  [/\bDROP\s+TABLE\b/i, 'DROP TABLE'],
  [/\bDROP\s+COLUMN\b/i, 'DROP COLUMN'],
  [/\bDROP\s+CONSTRAINT\b/i, 'DROP CONSTRAINT'],
  [/\bALTER\s+COLUMN\b[\s\S]*\bTYPE\b/i, 'ALTER COLUMN TYPE'],
  [/\bRENAME\s+(TABLE|COLUMN|TO)\b/i, 'RENAME'],
  [/\bTRUNCATE\b/i, 'TRUNCATE'],
];

const violations = [];
for (const dir of readdirSync(MIGRATIONS, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const file = path.join(MIGRATIONS, dir.name, 'migration.sql');
  if (!exists(file)) continue;
  const sql = readFileSync(file, 'utf8');
  const lines = sql.split('\n');
  const contract = /--\s*raven:contract\b/.test(sql);
  const retires = /--\s*raven:contract\b.*\bretires\s+\S+/i.test(sql);
  const noTransaction = /--\s*raven:no-transaction\b/.test(sql);

  lines.forEach((rawLine, i) => {
    const at = `${rel(file)}:${i + 1}`;
    // Only the SQL before a `--` is a statement; the rest is prose and must not trip the rules.
    const line = rawLine.split('--')[0] ?? '';
    const justified = /--\s*safe:/i.test(rawLine) || /--\s*safe:/i.test(lines[i - 1] ?? '');

    for (const [re, what] of DESTRUCTIVE) {
      if (!re.test(line) || justified) continue;
      if (!contract)
        violations.push(
          `${at}: ${what} without a "-- raven:contract" label or a "-- safe:" justification`,
        );
      else if (!retires)
        violations.push(`${at}: "-- raven:contract" must name the expand migration it retires`);
    }

    if (/\bCREATE\s+(UNIQUE\s+)?INDEX\b/i.test(line) && !/CONCURRENTLY/i.test(line) && !justified) {
      // Indexing a table created in the same migration takes no lock anyone can observe.
      const target = /\bON\s+"?([\w.]+)"?/i.exec(line)?.[1];
      const fresh = target != null && new RegExp(`CREATE TABLE[^;]*\\b${target}\\b`, 'i').test(sql);
      if (!fresh) {
        violations.push(
          `${at}: blocking CREATE INDEX — use CONCURRENTLY (plus "-- raven:no-transaction") or "-- safe:"`,
        );
      }
    }
    if (/CONCURRENTLY/i.test(line) && !noTransaction) {
      violations.push(
        `${at}: CREATE INDEX CONCURRENTLY requires "-- raven:no-transaction" in this file`,
      );
    }
    if (
      /\bADD\s+COLUMN\b/i.test(line) &&
      /\bNOT\s+NULL\b/i.test(line) &&
      /\bDEFAULT\b/i.test(line) &&
      !justified
    ) {
      const volatile =
        /\b(now\(\)|current_timestamp|random\(\)|gen_random_uuid\(\)|uuid_generate)/i.test(line);
      if (volatile)
        violations.push(
          `${at}: ADD COLUMN NOT NULL DEFAULT <volatile> rewrites the table — backfill instead`,
        );
    }
  });

  if (!/^\s*--/m.test(sql)) {
    violations.push(
      `${rel(file)}:1: missing header comment stating lock impact and estimated duration`,
    );
  }
}

report('check-migration-safety', violations, 'all migrations are expand/contract safe');
