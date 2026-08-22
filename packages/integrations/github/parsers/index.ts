/**
 * Parser registry (11_GITHUB.md §5.5).
 *
 * v1 covers the four ecosystems the analysis rules in §5.6/§5.7 actually consume (npm, pip, go,
 * cargo). Maven/Gradle/composer/gem/nuget are declared `low` confidence in the spec and are added
 * behind the same `DependencyParser` interface when a repository needs them.
 */
import { cargoParser } from './cargo.ts';
import { goParser } from './go.ts';
import { npmParser } from './npm.ts';
import { pipParser } from './pip.ts';
import type { DependencyParser, ParsedManifest } from './types.ts';

export const PARSERS: readonly DependencyParser[] = [npmParser, pipParser, goParser, cargoParser];

export function parserFor(path: string): DependencyParser | null {
  return PARSERS.find((parser) => parser.matches(path)) ?? null;
}

/** Parses every key file we recognise; unknown paths are ignored, not errors. */
export function parseManifests(files: ReadonlyMap<string, string>): ParsedManifest[] {
  const parsed: ParsedManifest[] = [];
  for (const [path, content] of files) {
    const parser = parserFor(path);
    if (parser) parsed.push(parser.parse(path, content));
  }
  return parsed;
}

export * from './types.ts';
export { npmParser, pipParser, goParser, cargoParser };
