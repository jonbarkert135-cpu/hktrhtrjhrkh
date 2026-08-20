/**
 * Queue `integration.parse` — stages 3–7 of the pipeline (10_INTEGRATIONS.md §2).
 *
 * Parsing lives here, not in the runner, because the runner's sandbox slot is the scarce resource:
 * parsing a 40 MB artifact in the same slot would halve run throughput. The worker touches
 * `packages/db`, `packages/domain` and `packages/integrations` — never the runner's sandbox code.
 */

import {
  buildProposal,
  builtinRegistry,
  manifestEntityExtractor,
  versionDrift,
  IntegrationError,
  payloadFor,
  toErrorPayload,
  type ArtifactRef,
  type ExistingNodeMatch,
  type ImportProposal,
  type MapContext,
  type IntegrationErrorPayload,
  type RawRunResult,
  type RunLogger,
} from '@nexus/integrations';

export const PARSE_TIMEOUT_MS = 120_000;

export interface ArtifactReader {
  read(ref: ArtifactRef): Promise<AsyncIterable<Uint8Array>>;
}

export interface RunRow {
  readonly id: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly boardId: string;
  readonly integrationId: string;
  readonly actorUserId: string;
  readonly anchorNodeId: string | null;
  readonly input: Record<string, unknown>;
  readonly artifacts: readonly ArtifactRef[];
  readonly status: string;
  readonly exitCode: number | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly durationMs: number | null;
  readonly stats: RawRunResult['stats'];
}

export interface ParseStore {
  loadRun(runId: string): Promise<RunRow | null>;
  /** Existing nodes on the board that could match an incoming identity (§8.3). */
  findCandidates(
    boardId: string,
    identityKeys: readonly string[],
  ): Promise<readonly ExistingNodeMatch[]>;
  saveProposal(proposal: ImportProposal, run: RunRow): Promise<void>;
  markSucceeded(runId: string, proposalId: string, itemsFound: number): Promise<void>;
  markFailed(runId: string, payload: IntegrationErrorPayload): Promise<void>;
  appendLog(
    runId: string,
    entries: readonly { level: string; phase: string; message: string }[],
  ): Promise<void>;
}

export interface ParseDeps {
  readonly store: ParseStore;
  readonly artifacts: ArtifactReader;
  readonly newProposalId: () => string;
  readonly now?: () => string;
  readonly publish?: (runId: string, event: Record<string, unknown>) => void;
  readonly timeoutMs?: number;
}

export interface ParseOutcome {
  readonly status: 'succeeded' | 'partial' | 'failed';
  readonly proposalId?: string;
  readonly error?: IntegrationErrorPayload;
}

/**
 * Processes one parse job. Every failure path lands on a canonical error payload and a run row that
 * says why — a run that ends without an explanation is the bug this function exists to prevent.
 */
export async function processParseJob(deps: ParseDeps, runId: string): Promise<ParseOutcome> {
  const now = deps.now ?? (() => new Date().toISOString());
  const run = await deps.store.loadRun(runId);
  if (run === null) throw new Error(`run ${runId} does not exist`);

  const entry = builtinRegistry().entries.get(run.integrationId);
  if (entry === undefined) {
    const payload = payloadFor('INTEGRATION_DISABLED', { runId });
    await deps.store.markFailed(runId, payload);
    return { status: 'failed', error: payload };
  }

  const lines: { level: string; phase: string; message: string }[] = [];
  const logger: RunLogger = {
    log(record) {
      lines.push({ level: record.level, phase: record.phase, message: record.message });
    },
  };

  const result: RawRunResult = {
    runId: run.id,
    status: run.status === 'partial' ? 'partial' : 'succeeded',
    exitCode: run.exitCode,
    startedAt: (run.startedAt ?? new Date()).toISOString(),
    finishedAt: (run.finishedAt ?? new Date()).toISOString(),
    durationMs: run.durationMs ?? 0,
    artifacts: run.artifacts,
    stats: run.stats,
  };

  try {
    const document = await withTimeout(
      entry.parser.parse(result, {
        manifest: entry.manifest,
        runId: run.id,
        input: run.input,
        readArtifact: (ref) => deps.artifacts.read(ref),
        logger,
      }),
      deps.timeoutMs ?? PARSE_TIMEOUT_MS,
    );

    const drift = versionDrift(
      document.toolReportedVersion ?? entry.manifest.toolVersion,
      entry.parser.schemaVersions,
      entry.manifest.toolVersion,
    );
    if (drift === 'minor' || drift === 'major') {
      logger.log({
        level: 'warn',
        phase: 'parse',
        message: `tool version ${document.toolReportedVersion ?? 'unknown'}, adapter targets ${entry.manifest.toolVersion}`,
      });
    }

    const extraction = (entry.extractor ?? manifestEntityExtractor(entry.manifest)).extract(
      document,
      {
        manifest: entry.manifest,
        drift,
      },
    );

    // Resolution against the board's identity index. The board is a CRDT, so this is a snapshot:
    // the Applier re-checks every reference at apply time and skips what disappeared meanwhile.
    const candidates = await deps.store.findCandidates(
      run.boardId,
      extraction.entities.map((candidate) => candidate.identityKey),
    );
    const byKey = new Map(candidates.map((candidate) => [candidate.identityKey ?? '', candidate]));

    const primary = run.artifacts[0];
    const ctx: MapContext = {
      boardId: run.boardId,
      ...(run.anchorNodeId === null ? {} : { anchorNodeId: run.anchorNodeId }),
      resolve: (key) => byKey.get(key),
      provenanceFor: (origin, confidence) => ({
        source: `${entry.manifest.name} ${entry.manifest.toolVersion}`,
        tool: entry.manifest.id,
        toolVersion: entry.manifest.version,
        runId: run.id,
        observedAt: (run.finishedAt ?? new Date()).toISOString(),
        importedAt: now(),
        confidence,
        ...(primary === undefined ? {} : { artifactRef: primary }),
        pointer: origin.pointer,
        actorUserId: run.actorUserId,
      }),
    };

    const nodes = entry.nodeMapper.map(extraction, ctx);
    const edges = entry.relationshipMapper.map(extraction, nodes, ctx);
    const proposal = buildProposal({
      proposalId: deps.newProposalId(),
      runId: run.id,
      integrationId: entry.manifest.id,
      boardId: run.boardId,
      now: now(),
      extraction,
      nodes,
      edges,
      ctx,
    });

    if (document.records.length === 0) {
      logger.log({
        level: 'info',
        phase: 'parse',
        message: 'the tool produced no records for this input',
      });
    }

    logger.log({
      level: 'info',
      phase: 'propose',
      message: `${String(proposal.summary.newNodes)} new nodes, ${String(
        proposal.summary.newEdges,
      )} new edges, ${String(proposal.summary.enriched)} enriched, ${String(
        proposal.summary.conflicts,
      )} conflicts, ${String(proposal.summary.skippedDuplicates)} duplicates skipped`,
    });

    await deps.store.saveProposal(proposal, run);
    const itemsFound = proposal.items.length;
    await deps.store.markSucceeded(run.id, proposal.id, itemsFound);
    await deps.store.appendLog(run.id, lines);
    deps.publish?.(run.id, { t: 'done', status: 'succeeded', proposalId: proposal.id });
    return { status: 'succeeded', proposalId: proposal.id };
  } catch (error) {
    const payload = toErrorPayload(error, run.id);
    await deps.store.appendLog(run.id, [
      ...lines,
      { level: 'error', phase: 'parse', message: `${payload.code}: ${payload.why}` },
    ]);
    await deps.store.markFailed(run.id, payload);
    deps.publish?.(run.id, { t: 'done', status: 'failed', error: payload });
    return { status: 'failed', error: payload };
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new IntegrationError('PARSE_TIMEOUT')), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
