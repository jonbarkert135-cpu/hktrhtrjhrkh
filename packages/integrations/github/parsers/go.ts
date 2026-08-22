/** `go.mod` parser (11_GITHUB.md §5.5). `// indirect` requirements land in scope `build`. */
import {
  basename,
  capDependencies,
  type Dependency,
  type DependencyParser,
  type ParsedManifest,
} from './types.ts';

const requirement = (line: string): Dependency | null => {
  const match = /^([^\s]+)\s+([^\s]+)/.exec(line.trim());
  if (!match) return null;
  const [, name, range] = match as unknown as [string, string, string];
  return {
    name,
    range,
    scope: /\/\/\s*indirect/.test(line) ? 'build' : 'runtime',
    ecosystem: 'go',
    registryUrl: `https://pkg.go.dev/${name}`,
    repoUrlGuess: null,
  };
};

export const goParser: DependencyParser = {
  ecosystem: 'go',
  matches: (path) => basename(path) === 'go.mod',
  parse(path, content): ParsedManifest {
    const dependencies: Dependency[] = [];
    let moduleName: string | null = null;
    let goVersion: string | null = null;
    let inBlock = false;
    for (const rawLine of content.split('\n')) {
      const line = rawLine.replace(/^\s+/, '').replace(/\s+$/, '');
      if (line === '' || line.startsWith('//')) continue;
      if (inBlock) {
        if (line.startsWith(')')) inBlock = false;
        else {
          const dep = requirement(line);
          if (dep) dependencies.push(dep);
        }
        continue;
      }
      if (line.startsWith('module ')) moduleName = line.slice(7).trim();
      else if (line.startsWith('go ')) goVersion = line.slice(3).trim();
      else if (line.startsWith('require (')) inBlock = true;
      else if (line.startsWith('require ')) {
        const dep = requirement(line.slice(8));
        if (dep) dependencies.push(dep);
      }
    }
    return {
      ecosystem: 'go',
      path,
      packageName: moduleName,
      version: null,
      ...capDependencies(dependencies),
      errors: [],
      extras: { goVersion, hasLibraryEntry: moduleName !== null },
    };
  },
};
