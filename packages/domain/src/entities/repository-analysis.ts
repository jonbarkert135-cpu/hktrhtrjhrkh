/**
 * RepositoryAnalysis — output schema of the Repository Analysis Agent (11_GITHUB.md §5.10).
 *
 * Deterministic steps A–I fill everything except `narrative`, which is the only LLM-authored part
 * (§5.11) and stays in its own object so a reader can always tell measured facts from prose.
 */
import { z } from 'zod';

export const ANALYZER_VERSION = '1.0.0';

export const LanguageStatSchema = z.object({
  name: z.string(),
  bytes: z.number(),
  pct: z.number(),
  source: z.enum(['api', 'heuristic']),
});

export const EntryPointSchema = z.object({
  type: z.enum(['cli', 'service', 'library', 'script', 'container']),
  name: z.string(),
  path: z.string().nullable(),
  runCommand: z.string().nullable(),
  rule: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
});

export const RepositoryAnalysisSchema = z.object({
  repoKey: z.string(),
  headSha: z.string(),
  inputsDigest: z.string(),
  analyzerVersion: z.string(),
  producedAt: z.string(),
  completeness: z.number().min(0).max(1),
  skippedSteps: z.array(z.string()),
  treeComplete: z.boolean(),

  languages: z.array(LanguageStatSchema),
  primaryLanguage: z.string().nullable(),

  layout: z.object({
    kind: z.enum(['single-package', 'monorepo', 'multi-module', 'unknown']),
    packages: z.array(
      z.object({ path: z.string(), ecosystem: z.string(), name: z.string().nullable() }),
    ),
    docsDirs: z.array(z.string()),
    testDirs: z.array(z.string()),
    ciProviders: z.array(z.string()),
  }),

  entryPoints: z.array(EntryPointSchema),

  build: z.object({
    systems: z.array(z.string()),
    commands: z.array(
      z.object({
        purpose: z.enum(['install', 'build', 'test', 'run', 'lint']),
        command: z.string(),
        rule: z.string(),
      }),
    ),
    runtimeVersions: z.record(z.string()),
  }),

  dependencies: z.array(
    z.object({
      ecosystem: z.string(),
      path: z.string(),
      packageName: z.string().nullable(),
      direct: z.number().int(),
      dev: z.number().int(),
      truncated: z.number().int(),
      top: z.array(z.object({ name: z.string(), range: z.string().nullable(), scope: z.string() })),
      parseErrors: z.array(z.string()),
    }),
  ),

  surface: z.object({
    cli: z.array(z.object({ command: z.string(), flags: z.array(z.string()), source: z.string() })),
    http: z.object({
      spec: z.string().nullable(),
      framework: z.string().nullable(),
      routesKnown: z.boolean(),
      routes: z.array(z.string()),
    }),
    grpc: z.array(z.string()),
    library: z.boolean(),
    mcp: z.boolean(),
  }),

  container: z.object({
    dockerfile: z.string().nullable(),
    compose: z.array(z.string()),
    baseImages: z.array(z.string()),
    exposedPorts: z.array(z.number().int()),
    publishedImageHints: z.array(z.string()),
    rootUser: z.boolean().nullable(),
  }),

  health: z.object({
    license: z.object({
      spdxId: z.string().nullable(),
      method: z.enum(['api', 'text-match', 'none']),
      permissive: z.boolean().nullable(),
    }),
    maintenanceScore: z.number().int().min(0).max(100),
    maintenanceBand: z.enum(['healthy', 'watch', 'at-risk', 'unmaintained']),
    signals: z.array(z.object({ signal: z.string(), value: z.string(), points: z.number() })),
    archived: z.boolean(),
    contributorsCount: z.number().int().nullable(),
  }),

  narrative: z.object({
    summary: z.string().nullable(),
    architecture: z.string().nullable(),
    integrationNotes: z.string().nullable(),
    model: z.string().nullable(),
    generatedAt: z.string().nullable(),
  }),
});

export type LanguageStat = z.infer<typeof LanguageStatSchema>;
export type EntryPoint = z.infer<typeof EntryPointSchema>;
export type RepositoryAnalysis = z.infer<typeof RepositoryAnalysisSchema>;
