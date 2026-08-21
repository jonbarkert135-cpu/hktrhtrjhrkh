/**
 * The `expand-url` output parser (stage 3).
 *
 * The builtin executor writes one small JSON document, so this parser can buffer it — the 8 MiB
 * streaming rule in §3.4 applies to tools that emit big artifacts, and the manifest caps this one
 * at 64 KiB. A missing or unreadable document is `PARSE_UNSUPPORTED_SHAPE`; an already-canonical
 * URL is *not* an error, it is a run with zero records (§8, edge cases).
 */

import { IntegrationError } from '../src/errors.ts';
import type { OutputParser, ParsedDocument, ParsedRecord } from '../src/pipeline.ts';

export interface ExpandUrlOutput {
  readonly version: string;
  readonly inputUrl: string;
  readonly finalUrl: string;
  readonly hops: number;
  readonly status: number;
  readonly chain: readonly string[];
  readonly observedAt: string;
}

function decodeChunks(chunks: readonly Uint8Array[]): string {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(joined);
}

export const parser: OutputParser = {
  schemaVersions: ['1.0'],

  async parse(result, ctx) {
    const ref = result.artifacts[0] ?? result.stdoutRef;
    if (ref === undefined) {
      throw new IntegrationError('OUTPUT_MISSING', { runId: result.runId });
    }

    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of await ctx.readArtifact(ref)) {
      bytes += chunk.byteLength;
      if (bytes > 1_048_576) break; // the manifest caps at 64 KiB; this is the hard stop
      chunks.push(chunk);
    }

    let payload: ExpandUrlOutput;
    try {
      payload = JSON.parse(decodeChunks(chunks)) as ExpandUrlOutput;
    } catch {
      throw new IntegrationError('PARSE_UNSUPPORTED_SHAPE', { runId: result.runId });
    }

    if (typeof payload?.finalUrl !== 'string' || typeof payload.inputUrl !== 'string') {
      throw new IntegrationError('PARSE_UNSUPPORTED_SHAPE', {
        runId: result.runId,
        detail: { expected: 'finalUrl and inputUrl' },
      });
    }

    const records: ParsedRecord[] =
      payload.finalUrl === payload.inputUrl
        ? []
        : [
            {
              type: 'expanded_url',
              data: {
                finalUrl: payload.finalUrl,
                inputUrl: payload.inputUrl,
                hops: payload.hops,
                status: payload.status,
                chain: payload.chain,
              },
              pointer: '/finalUrl',
              observedAt: payload.observedAt,
              parserConfidence: 1,
            },
          ];

    ctx.logger.log({
      level: 'info',
      phase: 'parse',
      message:
        records.length === 0
          ? 'the URL is already canonical — no redirects were followed'
          : `expanded through ${String(payload.hops)} redirect hop(s)`,
    });

    const document: ParsedDocument = {
      toolReportedVersion: payload.version,
      records,
      counters: { hops: payload.hops ?? 0, records: records.length },
      nonFatalIssues:
        records.length === 0
          ? [{ level: 'info', message: 'This URL does not redirect; nothing to import.' }]
          : [],
    };
    return document;
  },
};
