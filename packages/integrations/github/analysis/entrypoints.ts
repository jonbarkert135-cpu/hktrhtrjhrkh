/**
 * Step F — entry points and run commands (11_GITHUB.md §5.6).
 *
 * Every emitted entry names the `rule` that produced it, so the UI can explain each conclusion and
 * a wrong rule is fixable in one place. Commands must be runnable verbatim: nothing here invents a
 * command that is not stated by a manifest or a conventional path.
 */
import type { EntryPoint } from '@nexus/domain';
import type { ParsedManifest } from '../parsers/index.ts';
import { composeServices, parseDockerfile } from './container.ts';

export interface BuildCommand {
  purpose: 'install' | 'build' | 'test' | 'run' | 'lint';
  command: string;
  rule: string;
}

export interface EntryPointResult {
  entryPoints: EntryPoint[];
  commands: BuildCommand[];
  systems: string[];
  runtimeVersions: Record<string, string>;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const record = (value: unknown): Record<string, string> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};

const SCRIPT_PURPOSE: Record<string, BuildCommand['purpose']> = {
  start: 'run',
  dev: 'run',
  build: 'build',
  test: 'test',
  lint: 'lint',
};

export function detectEntryPoints(
  manifests: readonly ParsedManifest[],
  treePaths: readonly string[],
  files: ReadonlyMap<string, string>,
): EntryPointResult {
  const entryPoints: EntryPoint[] = [];
  const commands: BuildCommand[] = [];
  const systems = new Set<string>();
  const runtimeVersions: Record<string, string> = {};

  for (const manifest of manifests) {
    const extras = manifest.extras;
    if (manifest.ecosystem === 'npm') {
      systems.add('npm');
      for (const name of strings(extras['bin'])) {
        entryPoints.push({
          type: 'cli',
          name,
          path: manifest.path,
          runCommand: `npx ${name}`,
          rule: 'npm.bin',
          confidence: 'high',
        });
      }
      const scripts = record(extras['scripts']);
      for (const [script, body] of Object.entries(scripts)) {
        const purpose = SCRIPT_PURPOSE[script];
        if (purpose) commands.push({ purpose, command: `npm run ${script}`, rule: 'npm.scripts' });
        if (script === 'start' || script === 'dev') {
          entryPoints.push({
            type: 'service',
            name: script,
            path: manifest.path,
            runCommand: `npm run ${script}`,
            rule: 'npm.scripts',
            confidence: body === '' ? 'low' : 'high',
          });
        }
      }
      commands.push({ purpose: 'install', command: 'npm install', rule: 'npm.scripts' });
      if (extras['hasLibraryEntry'] === true && manifest.packageName) {
        entryPoints.push({
          type: 'library',
          name: manifest.packageName,
          path: manifest.path,
          runCommand: null,
          rule: 'npm.main',
          confidence: 'high',
        });
      }
      const node = record(extras['engines'])['node'];
      if (node) runtimeVersions['node'] = node;
    }

    if (manifest.ecosystem === 'pip') {
      systems.add('pip');
      for (const name of strings(extras['consoleScripts'])) {
        entryPoints.push({
          type: 'cli',
          name,
          path: manifest.path,
          runCommand: name,
          rule: 'py.console_scripts',
          confidence: 'high',
        });
      }
      const python = extras['requiresPython'];
      if (typeof python === 'string') runtimeVersions['python'] = python;
      commands.push({
        purpose: 'install',
        command: 'pip install -r requirements.txt',
        rule: 'pip.install',
      });
    }

    if (manifest.ecosystem === 'go') {
      systems.add('go');
      const version = extras['goVersion'];
      if (typeof version === 'string') runtimeVersions['go'] = version;
      commands.push({ purpose: 'build', command: 'go build ./...', rule: 'go.build' });
      commands.push({ purpose: 'test', command: 'go test ./...', rule: 'go.build' });
    }

    if (manifest.ecosystem === 'cargo') {
      systems.add('cargo');
      for (const name of strings(extras['bins'])) {
        entryPoints.push({
          type: 'cli',
          name,
          path: manifest.path,
          runCommand: `cargo run --bin ${name}`,
          rule: 'cargo.bin',
          confidence: 'high',
        });
      }
      commands.push({ purpose: 'build', command: 'cargo build --release', rule: 'cargo.build' });
    }
  }

  // Conventional layouts — `medium` confidence: inferred from paths, not declared.
  for (const path of treePaths) {
    const cmdMatch = /^cmd\/([^/]+)\/main\.go$/.exec(path);
    if (cmdMatch) {
      entryPoints.push({
        type: 'cli',
        name: cmdMatch[1] as string,
        path,
        runCommand: `go run ./cmd/${cmdMatch[1] as string}`,
        rule: 'go.cmd',
        confidence: 'medium',
      });
    }
  }
  if (treePaths.includes('main.go')) {
    entryPoints.push({
      type: 'cli',
      name: 'main',
      path: 'main.go',
      runCommand: 'go run .',
      rule: 'go.rootmain',
      confidence: 'medium',
    });
  }
  if (treePaths.includes('src/main.rs') && !entryPoints.some((e) => e.rule === 'cargo.bin')) {
    entryPoints.push({
      type: 'cli',
      name: 'main',
      path: 'src/main.rs',
      runCommand: 'cargo run',
      rule: 'cargo.bin',
      confidence: 'medium',
    });
  }
  const dunderMain = treePaths.find((path) => path.endsWith('__main__.py'));
  if (dunderMain) {
    const pkg = dunderMain.split('/').slice(-2, -1)[0] ?? '';
    entryPoints.push({
      type: 'cli',
      name: pkg || 'module',
      path: dunderMain,
      runCommand: pkg ? `python -m ${pkg}` : null,
      rule: 'py.dunder_main',
      confidence: 'medium',
    });
  }

  const dockerfilePath = treePaths.find((path) => path === 'Dockerfile');
  const dockerfile = dockerfilePath ? files.get(dockerfilePath) : undefined;
  if (dockerfilePath && dockerfile !== undefined) {
    systems.add('docker');
    const parsed = parseDockerfile(dockerfilePath, dockerfile);
    entryPoints.push({
      type: 'container',
      name: 'docker',
      path: dockerfilePath,
      runCommand: parsed.command,
      rule: 'docker.cmd',
      confidence: parsed.command === null ? 'low' : 'high',
    });
  }
  for (const [path, content] of files) {
    if (!/^docker-compose\.ya?ml$/.test(path)) continue;
    for (const service of composeServices(content)) {
      entryPoints.push({
        type: 'container',
        name: service,
        path,
        runCommand: `docker compose up ${service}`,
        rule: 'compose.service',
        confidence: 'high',
      });
    }
  }

  const makefile = files.get('Makefile');
  if (makefile !== undefined) {
    systems.add('make');
    for (const match of makefile.matchAll(/^(run|start|dev|serve|build|test):/gm)) {
      const target = match[1] as string;
      const purpose = SCRIPT_PURPOSE[target] ?? 'run';
      commands.push({ purpose, command: `make ${target}`, rule: 'make.target' });
    }
  }

  return {
    entryPoints,
    commands,
    systems: [...systems].sort(),
    runtimeVersions,
  };
}
