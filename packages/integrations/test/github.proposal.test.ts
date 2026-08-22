/**
 * Integration Proposal generator (11_GITHUB.md §6).
 *
 * Built on a real `analyzeRepository` output rather than a hand-written analysis object, so the
 * test breaks if the analysis shape and the proposal drift apart.
 */
import { describe, expect, it } from 'vitest';

import { analyzeRepository, type AnalysisInputs } from '../github/analysis/analyze.ts';
import {
  buildIntegrationProposal,
  confidenceBand,
  isProposalEligible,
  proposalConfidence,
  slugifyRepoKey,
} from '../github/proposal.ts';

const README = `# Sherlock

\`\`\`console
$ sherlock user123 --json --site GitHub --timeout 5
\`\`\`

Or with docker: \`docker run --rm sherlock/sherlock user123\`
`;

const inputs = (): AnalysisInputs => ({
  repoKey: 'gh:repo:sherlock-project/sherlock',
  headSha: 'a'.repeat(40),
  treeComplete: true,
  treePaths: [
    'README.md',
    'pyproject.toml',
    'Dockerfile',
    'docs/index.md',
    'tests/test_cli.py',
    '.github/workflows/ci.yml',
    'sherlock_project/__main__.py',
  ],
  languagesApi: { Python: 250_000 },
  files: new Map([
    [
      'pyproject.toml',
      `[project]
name = "sherlock-project"
version = "0.16.0"
dependencies = ["requests >= 2.31"]

[project.scripts]
sherlock = "sherlock_project.sherlock:main"
`,
    ],
    ['Dockerfile', 'FROM python:3.12-slim\nENTRYPOINT ["sherlock"]\n'],
  ]),
  readme: README,
  health: {
    pushedAt: '2026-05-20T00:00:00.000Z',
    latestReleaseAt: '2025-09-16T00:00:00.000Z',
    archived: false,
    stars: 62_000,
    openIssues: 30,
    contributorsCount: 200,
    licenseSpdxId: 'MIT',
    licenseFileText: null,
  },
  producedAt: '2026-06-01T00:00:00.000Z',
  nowMs: Date.parse('2026-06-01T00:00:00.000Z'),
});

const meta = {
  id: 'prop_1',
  analysisId: 'an_1',
  generatedAt: '2026-06-01T00:00:00.000Z',
};

describe('buildIntegrationProposal', () => {
  it('drafts a container manifest for an eligible CLI repository', () => {
    const analysis = analyzeRepository(inputs());
    expect(isProposalEligible(analysis)).toBe(true);

    const proposal = buildIntegrationProposal(analysis, meta);
    expect(proposal).not.toBeNull();
    const draft = proposal!.draftManifest;

    expect(proposal!.executionMode).toBe('container');
    expect(proposal!.requiresHumanReview).toBe(true);
    expect(draft.id).toBe('gh-repo-sherlock-project-sherlock');
    expect(draft.version).toBe('0.1.0-draft');
    expect(draft.execution.build).toEqual({ dockerfile: 'Dockerfile' });
    expect(draft.execution.image).toBe('sherlock/sherlock');
    expect(draft.execution.network).toBe('none');
    expect(draft.execution.timeoutMs).toBe(300_000);
    // `--json` prints to stdout, so no output path is invented for it.
    expect(draft.outputs).toEqual({ format: 'json', path: null, flag: '--json' });
    expect(draft.execution.command).toEqual(['sherlock', '${input.target}']);
  });

  it('is deterministic', () => {
    const analysis = analyzeRepository(inputs());
    expect(buildIntegrationProposal(analysis, meta)).toEqual(
      buildIntegrationProposal(analysis, meta),
    );
  });

  it('flags a root-user container as a blocker but still proposes', () => {
    const analysis = analyzeRepository(inputs());
    expect(analysis.container.rootUser).toBe(true);
    expect(buildIntegrationProposal(analysis, meta)!.blockers).toEqual(['root-user']);
  });

  it('blocks a non-permissive license instead of dropping the proposal', () => {
    const raw = inputs();
    const analysis = analyzeRepository({
      ...raw,
      health: { ...raw.health, licenseSpdxId: 'GPL-3.0' },
    });
    const proposal = buildIntegrationProposal(analysis, meta)!;
    expect(proposal.blockers).toContain('license');
    expect(proposal.draftManifest.id).toBe('gh-repo-sherlock-project-sherlock');
  });

  it('marks an archived, unmaintained repository', () => {
    const raw = inputs();
    const analysis = analyzeRepository({
      ...raw,
      health: { ...raw.health, archived: true, pushedAt: '2019-01-01T00:00:00.000Z' },
    });
    expect(buildIntegrationProposal(analysis, meta)!.blockers).toContain('unmaintained');
  });

  it('returns null when the repository exposes no surface and no layout', () => {
    const analysis = analyzeRepository({
      ...inputs(),
      treePaths: ['README.md'],
      files: new Map(),
      readme: null,
    });
    expect(isProposalEligible(analysis)).toBe(false);
    expect(buildIntegrationProposal(analysis, meta)).toBeNull();
  });

  it('lists every unverified inference', () => {
    const proposal = buildIntegrationProposal(analyzeRepository(inputs()), meta)!;
    expect(proposal.unverified.join('\n')).toContain('never pulled');
    expect(proposal.unverified.length).toBeGreaterThanOrEqual(3);
  });

  it('scores confidence with the §6.3 weights and bands it', () => {
    const confidence = proposalConfidence(analyzeRepository(inputs()));
    // structured output + container + permissive + healthy + docs = 0.75; the CLI flags were
    // only observed in the README, so the 0.25 "declared CLI" term does not apply.
    expect(confidence).toBe(0.75);
    expect(confidenceBand(confidence)).toBe('Strong candidate');
    expect(confidenceBand(0.39)).toBe('Exploratory');
    expect(confidenceBand(0.7)).toBe('Plausible');
  });

  it('slugifies repo keys', () => {
    expect(slugifyRepoKey('gh:repo:Owner/Name_x')).toBe('gh-repo-owner-name-x');
  });
});
