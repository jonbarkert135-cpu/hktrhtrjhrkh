/**
 * Third-party plugin discovery (10_INTEGRATIONS.md §4.3, §"Adding a tool" rule 3).
 *
 * Plugins get the *declarative path only*: a directory of `*.json` manifest files, validated by
 * the same zod schema as first-party manifests, parsed by the shared declarative parser. No plugin
 * code is imported and no `require` is computed — a plugin cannot run inside this process.
 *
 * The filesystem is injected rather than imported so this module stays runtime-agnostic (the web
 * bundle imports the registry too, and must not pull in `node:fs`). A file that is unreadable or
 * not JSON is still returned as a source with its raw content, so `buildRegistry` reports it in
 * `rejected` with the issue path instead of silently ignoring it.
 */

import type { IntegrationSource } from './registry.ts';
import { declarativeParser } from './declarativeParser.ts';

export interface PluginFs {
  readdir(dir: string): Promise<readonly string[]>;
  readFile(path: string): Promise<string>;
}

/** Reads every `*.json` manifest in `dir`. A missing directory means "no plugins installed". */
export async function discoverPlugins(dir: string, fs: PluginFs): Promise<IntegrationSource[]> {
  let files: readonly string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }

  const sources: IntegrationSource[] = [];
  for (const file of [...files].filter((name) => name.endsWith('.json')).sort()) {
    const path = `${dir.replace(/\/*$/, '')}/${file}`;
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(path));
    } catch {
      // Surfaced as a rejection with the file name, so Admin → Integrations shows what broke.
      raw = { id: file.replace(/\.json$/, '') };
    }
    sources.push({ raw, parser: declarativeParser });
  }
  return sources;
}
