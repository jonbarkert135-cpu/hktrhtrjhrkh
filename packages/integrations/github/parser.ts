/**
 * The `github` output parser (stage 3, 11_GITHUB.md §7, 10_INTEGRATIONS.md §3.4).
 *
 * The http executor writes one artifact per manifest request, named after its `collectAs`. Only
 * two of them carry graph records: `repo` (the repository, its owner and its homepage) and
 * `contributors`. The rest — readme, languages, license, releases, issues — are analysis inputs
 * handled by the repository agent, not import candidates, so they are skipped here rather than
 * turned into low-confidence noise.
 *
 * A missing `repo` artifact is `OUTPUT_MISSING`; unreadable JSON is `PARSE_UNSUPPORTED_SHAPE`;
 * a truncated contributors page is a non-fatal issue, never a failed run (§8 edge cases).
 */

import { IntegrationError } from '../src/errors.ts';
import type {
  ArtifactRef,
  OutputParser,
  ParsedDocument,
  ParsedRecord,
  ParseContext,
  RawRunResult,
  UserMessage,
} from '../src/pipeline.ts';

/** 8 MiB is the streaming threshold in §3.4; the manifest caps the whole run at 4 MiB. */
const MAX_ARTIFACT_BYTES = 4_194_304;

interface RepoPayload {
  readonly html_url?: unknown;
  readonly full_name?: unknown;
  readonly description?: unknown;
  readonly stargazers_count?: unknown;
  readonly language?: unknown;
  readonly homepage?: unknown;
  readonly license?: { readonly spdx_id?: unknown } | null;
  readonly owner?: {
    readonly login?: unknown;
    readonly html_url?: unknown;
    readonly type?: unknown;
  } | null;
}

interface ContributorPayload {
  readonly login?: unknown;
  readonly html_url?: unknown;
  readonly contributions?: unknown;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The artifact key ends with the request's `collectAs` name (see the http executor). */
function artifactNamed(result: RawRunResult, name: string): ArtifactRef | undefined {
  return result.artifacts.find((ref) => ref.key.endsWith(name));
}

async function readJson(ref: ArtifactRef, ctx: ParseContext, runId: string): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of await ctx.readArtifact(ref)) {
    bytes += chunk.byteLength;
    if (bytes > MAX_ARTIFACT_BYTES) break;
    chunks.push(chunk);
  }
  const joined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8').decode(joined));
  } catch {
    throw new IntegrationError('PARSE_UNSUPPORTED_SHAPE', { runId, detail: { artifact: ref.key } });
  }
}

function repositoryRecords(repo: RepoPayload, observedAt: string): ParsedRecord[] {
  const htmlUrl = str(repo.html_url);
  const records: ParsedRecord[] = [];

  if (htmlUrl !== undefined) {
    records.push({
      type: 'repository',
      data: {
        htmlUrl,
        fullName: str(repo.full_name) ?? htmlUrl,
        description: str(repo.description),
        stars: num(repo.stargazers_count),
        primaryLanguage: str(repo.language),
        license: str(repo.license?.spdx_id),
      },
      pointer: '/html_url',
      observedAt,
      parserConfidence: 1,
    });
  }

  const login = str(repo.owner?.login);
  if (login !== undefined) {
    records.push({
      type: 'owner',
      data: { login, htmlUrl: str(repo.owner?.html_url), type: str(repo.owner?.type) },
      pointer: '/owner/login',
      observedAt,
      parserConfidence: 1,
    });
  }

  const homepage = str(repo.homepage);
  if (homepage !== undefined) {
    records.push({
      type: 'homepage',
      data: { url: homepage },
      pointer: '/homepage',
      observedAt,
      parserConfidence: 1,
    });
  }

  return records;
}

function contributorRecords(payload: unknown, observedAt: string): ParsedRecord[] {
  if (!Array.isArray(payload)) return [];
  const records: ParsedRecord[] = [];
  payload.forEach((entry, index) => {
    const contributor = entry as ContributorPayload;
    const login = str(contributor.login);
    if (login === undefined) return;
    records.push({
      type: 'contributor',
      data: {
        login,
        htmlUrl: str(contributor.html_url),
        contributions: num(contributor.contributions) ?? 0,
      },
      pointer: `/${String(index)}/login`,
      observedAt,
      parserConfidence: 1,
    });
  });
  return records;
}

export const parser: OutputParser = {
  schemaVersions: ['1.0'],

  async parse(result, ctx) {
    const repoRef = artifactNamed(result, 'repo');
    if (repoRef === undefined) {
      throw new IntegrationError('OUTPUT_MISSING', { runId: result.runId });
    }

    const observedAt = result.finishedAt;
    const repo = (await readJson(repoRef, ctx, result.runId)) as RepoPayload;
    if (typeof repo !== 'object' || repo === null || str(repo.html_url) === undefined) {
      throw new IntegrationError('PARSE_UNSUPPORTED_SHAPE', {
        runId: result.runId,
        detail: { expected: 'html_url' },
      });
    }

    const records = repositoryRecords(repo, observedAt);
    const nonFatalIssues: UserMessage[] = [];

    const contributorsRef = artifactNamed(result, 'contributors');
    let contributors = 0;
    if (contributorsRef !== undefined) {
      const parsed = contributorRecords(
        await readJson(contributorsRef, ctx, result.runId),
        observedAt,
      );
      contributors = parsed.length;
      records.push(...parsed);
      if (contributorsRef.truncated) {
        nonFatalIssues.push({
          level: 'warn',
          message: 'The contributor list was truncated; only the first page was imported.',
        });
      }
    }

    ctx.logger.log({
      level: 'info',
      phase: 'parse',
      message: `parsed the repository and ${String(contributors)} contributor(s)`,
    });

    return {
      toolReportedVersion: '1.0',
      records,
      counters: { records: records.length, contributors },
      nonFatalIssues,
    } satisfies ParsedDocument;
  },
};
