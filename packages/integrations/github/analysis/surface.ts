/**
 * Step G — API/CLI/library surface (11_GITHUB.md §5.7).
 *
 * The rule that matters: we never claim an HTTP route we did not read from a spec file. Framework
 * signatures only yield `{ framework, routesKnown: false }`.
 */
import type { EntryPoint } from '@nexus/domain';
import type { ParsedManifest } from '../parsers/index.ts';

export interface Surface {
  cli: { command: string; flags: string[]; source: string }[];
  http: { spec: string | null; framework: string | null; routesKnown: boolean; routes: string[] };
  grpc: string[];
  library: boolean;
  mcp: boolean;
}

const MAX_FLAGS = 40;
const MAX_ROUTES = 200;

const FRAMEWORKS: ReadonlyArray<[string, readonly string[]]> = [
  ['express', ['express']],
  ['fastify', ['fastify']],
  ['flask', ['flask']],
  ['fastapi', ['fastapi']],
  ['django', ['django']],
  ['gin', ['github.com/gin-gonic/gin']],
  ['actix', ['actix-web']],
  ['spring', ['spring-boot-starter-web']],
];

/** Flags found in README fenced code blocks, deduped and capped (§5.7). */
export function readmeFlags(readme: string): string[] {
  const flags = new Set<string>();
  for (const block of readme.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    for (const match of (block[1] as string).matchAll(/(?:^|\s)(--?[a-z0-9][\w-]*)/g)) {
      flags.add(match[1] as string);
      if (flags.size >= MAX_FLAGS) return [...flags];
    }
  }
  return [...flags];
}

function openapiRoutes(content: string): string[] {
  // Both YAML and JSON specs list paths as keys starting with `/`; read only those keys.
  const routes = new Set<string>();
  for (const match of content.matchAll(/^\s{0,4}["']?(\/[^\s"':]*)["']?\s*:/gm)) {
    routes.add(match[1] as string);
    if (routes.size >= MAX_ROUTES) break;
  }
  return [...routes];
}

export function detectSurface(
  entryPoints: readonly EntryPoint[],
  manifests: readonly ParsedManifest[],
  files: ReadonlyMap<string, string>,
  treePaths: readonly string[],
  readme: string | null,
): Surface {
  const flags = readme ? readmeFlags(readme) : [];
  const cli = entryPoints
    .filter((entry) => entry.type === 'cli')
    .map((entry) => ({
      command: entry.name,
      flags,
      source: flags.length > 0 ? 'readme' : 'manifest',
    }));

  const specPath = treePaths.find((path) =>
    /(^|\/)(openapi\.(ya?ml|json)|swagger\.json)$/.test(path),
  );
  const specContent = specPath ? files.get(specPath) : undefined;
  const routes = specContent === undefined ? [] : openapiRoutes(specContent);

  const dependencyNames = new Set(
    manifests.flatMap((manifest) => manifest.dependencies.map((dep) => dep.name.toLowerCase())),
  );
  const framework =
    FRAMEWORKS.find(([, markers]) => markers.some((marker) => dependencyNames.has(marker)))?.[0] ??
    null;

  const grpc: string[] = [];
  for (const [path, content] of files) {
    if (!path.endsWith('.proto')) continue;
    for (const match of content.matchAll(/service\s+(\w+)/g)) grpc.push(match[1] as string);
  }

  return {
    cli,
    http: {
      spec: specPath ?? null,
      framework: specPath ? framework : framework,
      routesKnown: routes.length > 0,
      routes,
    },
    grpc,
    library: manifests.some((manifest) => manifest.extras['hasLibraryEntry'] === true),
    mcp:
      dependencyNames.has('modelcontextprotocol') ||
      [...dependencyNames].some((name) => name.includes('modelcontextprotocol')) ||
      treePaths.includes('mcp.json'),
  };
}
