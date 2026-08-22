/**
 * The declarative output parser (10_INTEGRATIONS.md §3.4, "Adding a tool" rule 3).
 *
 * Third-party plugins may not ship parser code, so their JSON output is turned into records by a
 * fixed rule instead: each artifact's name (the request's `collectAs`, or the output name) becomes
 * the record type, an array artifact yields one record per element, an object artifact yields one.
 * `entityMappings` in the manifest then map those record types to nodes and edges — the same path
 * first-party integrations use.
 */

import { IntegrationError } from './errors.ts';
import type { ArtifactRef, OutputParser, ParsedRecord, ParseContext } from './pipeline.ts';

const MAX_ARTIFACT_BYTES = 8_388_608;

/** The artifact key is `…/<runId>/<name>…`; the name is the last path segment's leading token. */
export function artifactName(ref: ArtifactRef): string {
  const last = ref.key.split('/').pop() ?? ref.key;
  return last.replace(/\.[^.]+$/, '');
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

export const declarativeParser: OutputParser = {
  schemaVersions: ['1.0'],

  async parse(result, ctx) {
    const refs = result.artifacts.length > 0 ? result.artifacts : [result.stdoutRef];
    const present = refs.filter((ref): ref is ArtifactRef => ref !== undefined);
    if (present.length === 0) {
      throw new IntegrationError('OUTPUT_MISSING', { runId: result.runId });
    }

    const records: ParsedRecord[] = [];
    for (const ref of present) {
      const type = artifactName(ref);
      const payload = await readJson(ref, ctx, result.runId);
      const items = Array.isArray(payload) ? payload : [payload];
      items.forEach((item, index) => {
        if (typeof item !== 'object' || item === null) return;
        records.push({
          type,
          data: item as Record<string, unknown>,
          pointer: Array.isArray(payload) ? `/${String(index)}` : '/',
          observedAt: result.finishedAt,
          parserConfidence: 1,
        });
      });
    }

    ctx.logger.log({
      level: 'info',
      phase: 'parse',
      message: `declarative parse produced ${String(records.length)} record(s)`,
    });

    return {
      records,
      counters: { records: records.length },
      nonFatalIssues: [],
    };
  },
};
