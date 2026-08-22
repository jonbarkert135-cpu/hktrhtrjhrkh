/**
 * Integration Proposal — repository analysis → draft integration manifest (11_GITHUB.md §6).
 *
 * Pure and deterministic: the caller supplies ids and the timestamp. Nothing here is ever
 * installed automatically — `requiresHumanReview` is a literal `true` and every field the
 * analysis could not verify is listed in `unverified[]` for the review UI (§6.4).
 */
import type { RepositoryAnalysis } from '@nexus/domain';

export type ProposalBlocker =
  | 'license'
  | 'no-entrypoint'
  | 'network-required'
  | 'unmaintained'
  | 'root-user';

export interface IntegrationProposal {
  id: string;
  repoKey: string;
  analysisId: string;
  generatedAt: string;
  executionMode: 'container' | 'http-api' | 'unsupported';
  confidence: number;
  requiresHumanReview: true;
  blockers: ProposalBlocker[];
  draftManifest: {
    id: string;
    name: string;
    version: '0.1.0-draft';
    repository: string;
    execution: {
      kind: 'container';
      image: string | null;
      build: { dockerfile: string } | null;
      command: string[];
      timeoutMs: number;
      network: 'none' | 'allowlist';
      egressAllowlist: string[];
    };
    inputs: { name: string; type: 'string'; required: boolean; flag: string | null }[];
    outputs: {
      format: 'json' | 'jsonl' | 'csv' | 'text';
      path: string | null;
      flag: string | null;
    };
    parserHint: string;
    proposedNodeKinds: string[];
    proposedEdgeKinds: string[];
  };
  rationale: string;
  unverified: string[];
}

const DEFAULT_TIMEOUT_MS = 300_000;
/** Flags that mean "write machine-readable output somewhere", in preference order (§6.3). */
const OUTPUT_FLAGS: ReadonlyArray<[string, 'json' | 'jsonl' | 'csv']> = [
  ['--json', 'json'],
  ['--jsonl', 'jsonl'],
  ['--csv', 'csv'],
  ['--output', 'json'],
  ['--out', 'json'],
  ['-o', 'json'],
];

export function slugifyRepoKey(repoKey: string): string {
  return repoKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** §6.1 — a repository is proposal-eligible when it exposes a surface and we understood its layout. */
export function isProposalEligible(analysis: RepositoryAnalysis): boolean {
  const { surface, container, layout } = analysis;
  const hasSurface =
    surface.cli.length > 0 || surface.http.spec !== null || container.dockerfile !== null;
  return hasSurface && layout.kind !== 'unknown';
}

/** §6.3 — weighted, deterministic, rounded to two decimals so it is stable in fixtures. */
export function proposalConfidence(analysis: RepositoryAnalysis): number {
  const { surface, container, health, layout } = analysis;
  const hasDeclaredCli = surface.cli.some((entry) => entry.source !== 'readme');
  const hasStructuredOutput = surface.http.spec !== null || findOutputFlag(analysis) !== null;
  const band = health.maintenanceBand;
  const score =
    0.25 * (hasDeclaredCli ? 1 : 0) +
    0.2 * (hasStructuredOutput ? 1 : 0) +
    0.2 * (container.dockerfile !== null || container.publishedImageHints.length > 0 ? 1 : 0) +
    0.15 * (health.license.permissive === true ? 1 : 0) +
    0.1 * (band === 'healthy' ? 1 : band === 'watch' ? 0.5 : 0) +
    0.1 * (layout.docsDirs.length > 0 ? 1 : 0);
  return Number(score.toFixed(2));
}

/** `< 0.4` Exploratory, `0.4–0.7` Plausible, `> 0.7` Strong candidate (§6.3). */
export function confidenceBand(
  confidence: number,
): 'Exploratory' | 'Plausible' | 'Strong candidate' {
  if (confidence < 0.4) return 'Exploratory';
  if (confidence <= 0.7) return 'Plausible';
  return 'Strong candidate';
}

function findOutputFlag(analysis: RepositoryAnalysis): [string, 'json' | 'jsonl' | 'csv'] | null {
  const flags = new Set(analysis.surface.cli.flatMap((entry) => entry.flags));
  return OUTPUT_FLAGS.find(([flag]) => flags.has(flag)) ?? null;
}

function blockersFor(analysis: RepositoryAnalysis): ProposalBlocker[] {
  const blockers: ProposalBlocker[] = [];
  if (analysis.health.license.permissive !== true) blockers.push('license');
  if (analysis.entryPoints.length === 0) blockers.push('no-entrypoint');
  // A service surface cannot run under `--network none`; an operator must approve an allowlist.
  if (analysis.surface.http.spec !== null || analysis.surface.http.framework !== null) {
    blockers.push('network-required');
  }
  if (analysis.health.archived || analysis.health.maintenanceBand === 'unmaintained') {
    blockers.push('unmaintained');
  }
  if (analysis.container.rootUser === true) blockers.push('root-user');
  return blockers;
}

function commandTemplate(analysis: RepositoryAnalysis, outputFlag: string | null): string[] {
  const cli = analysis.surface.cli[0];
  const runner = analysis.entryPoints.find((entry) => entry.type === 'cli')?.runCommand;
  const base = (cli?.command ?? runner ?? '').trim();
  const argv = base.length > 0 ? base.split(/\s+/) : [];
  argv.push('${input.target}');
  if (outflagUsable(cli?.flags ?? [], outputFlag)) argv.push(outputFlag as string, '/out/result');
  return argv;
}

function outflagUsable(flags: readonly string[], outputFlag: string | null): boolean {
  return outputFlag !== null && flags.includes(outputFlag) && outputFlag !== '--json';
}

/**
 * Builds the draft. Returns `null` for ineligible repositories — a blocked-but-eligible repo still
 * gets a proposal (§6.1), it just carries `blockers`.
 */
export function buildIntegrationProposal(
  analysis: RepositoryAnalysis,
  meta: { id: string; analysisId: string; generatedAt: string },
): IntegrationProposal | null {
  if (!isProposalEligible(analysis)) return null;

  const { container, surface } = analysis;
  const image = container.publishedImageHints[0] ?? null;
  const executionMode: IntegrationProposal['executionMode'] =
    container.dockerfile !== null || image !== null
      ? 'container'
      : surface.http.spec !== null
        ? 'http-api'
        : 'unsupported';
  const output = findOutputFlag(analysis);
  const outputFlag = output?.[0] ?? null;
  const slug = slugifyRepoKey(analysis.repoKey);
  const unverified = [
    'Command template and its `${input.target}` placeholder were inferred, not executed.',
    'Input list is a single generic argument until a dry-run proves the real signature.',
  ];
  if (image !== null) {
    unverified.push(`Container image \`${image}\` was read from repository text and never pulled.`);
  }
  if (container.dockerfile === null && executionMode === 'container') {
    unverified.push('No Dockerfile in the repository — the image is the only container evidence.');
  }
  if (output === null) {
    unverified.push('No structured-output flag was found; parser must handle plain text.');
  }

  return {
    id: meta.id,
    repoKey: analysis.repoKey,
    analysisId: meta.analysisId,
    generatedAt: meta.generatedAt,
    executionMode,
    confidence: proposalConfidence(analysis),
    requiresHumanReview: true,
    blockers: blockersFor(analysis),
    draftManifest: {
      id: slug,
      name: analysis.repoKey,
      version: '0.1.0-draft',
      repository: `https://github.com/${analysis.repoKey}`,
      execution: {
        kind: 'container',
        image,
        build: container.dockerfile !== null ? { dockerfile: container.dockerfile } : null,
        command: commandTemplate(analysis, outputFlag),
        timeoutMs: DEFAULT_TIMEOUT_MS,
        network: surface.http.spec !== null ? 'allowlist' : 'none',
        egressAllowlist: [],
      },
      inputs: [{ name: 'target', type: 'string', required: true, flag: null }],
      outputs: {
        format: output?.[1] ?? 'text',
        path: outflagUsable(surface.cli[0]?.flags ?? [], outputFlag) ? '/out/result' : null,
        flag: outputFlag,
      },
      parserHint:
        output === null
          ? 'Output format unknown — inspect stdout from the dry-run before writing a parser.'
          : `Parse ${output[1]} from ${outputFlag === '--json' ? 'stdout' : '/out/result'}.`,
      proposedNodeKinds: ['finding'],
      proposedEdgeKinds: ['produced_by'],
    },
    rationale: '',
    unverified,
  };
}
