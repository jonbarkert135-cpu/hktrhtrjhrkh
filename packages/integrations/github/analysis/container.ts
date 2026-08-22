/** Step H — container support (11_GITHUB.md §5.8). Pure text scan of Dockerfile/compose. */

export interface ContainerInfo {
  dockerfile: string | null;
  compose: string[];
  baseImages: string[];
  exposedPorts: number[];
  publishedImageHints: string[];
  rootUser: boolean | null;
}

export interface DockerCommand {
  /** The `ENTRYPOINT`/`CMD` line as written, joined for exec-form arrays. */
  command: string | null;
}

const execForm = (rest: string): string => {
  const trimmed = rest.trim();
  if (!trimmed.startsWith('[')) return trimmed;
  try {
    const parts: unknown = JSON.parse(trimmed);
    return Array.isArray(parts) ? parts.filter((p) => typeof p === 'string').join(' ') : trimmed;
  } catch {
    return trimmed;
  }
};

export function parseDockerfile(path: string, content: string): ContainerInfo & DockerCommand {
  const baseImages: string[] = [];
  const exposedPorts: number[] = [];
  let user: string | null = null;
  let entrypoint: string | null = null;
  let cmd: string | null = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    const match = /^(FROM|EXPOSE|USER|ENTRYPOINT|CMD)\s+(.*)$/i.exec(line);
    if (!match) continue;
    const directive = (match[1] as string).toUpperCase();
    const rest = match[2] as string;
    if (directive === 'FROM') baseImages.push((rest.split(/\s+as\s+/i)[0] as string).trim());
    else if (directive === 'EXPOSE') {
      for (const token of rest.split(/\s+/)) {
        const port = Number.parseInt((token.split('/')[0] as string) ?? '', 10);
        if (Number.isInteger(port) && !exposedPorts.includes(port)) exposedPorts.push(port);
      }
    } else if (directive === 'USER') user = rest.trim();
    else if (directive === 'ENTRYPOINT') entrypoint = execForm(rest);
    else cmd = execForm(rest);
  }

  const command =
    [entrypoint, cmd].filter((part): part is string => part !== null).join(' ') || null;
  return {
    dockerfile: path,
    compose: [],
    baseImages,
    exposedPorts,
    publishedImageHints: [],
    // §5.8: no USER directive means the image runs as root.
    rootUser: user === null ? true : user === 'root' || user === '0',
    command,
  };
}

/** compose `services:` names — read from indentation, not a full YAML model. */
export function composeServices(content: string): string[] {
  const services: string[] = [];
  let inServices = false;
  let indent: number | null = null;
  for (const rawLine of content.split('\n')) {
    if (rawLine.trim() === '' || rawLine.trim().startsWith('#')) continue;
    const currentIndent = rawLine.length - rawLine.trimStart().length;
    if (/^services:\s*$/.test(rawLine.trim()) && currentIndent === 0) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;
    if (currentIndent === 0) break;
    if (indent === null) indent = currentIndent;
    if (currentIndent === indent) {
      const name = /^([A-Za-z0-9._-]+):\s*$/.exec(rawLine.trim())?.[1];
      if (name) services.push(name);
    }
  }
  return services;
}

/** Image references mentioned in compose/README — recorded as hints, never verified (§5.8). */
export function imageHints(content: string): string[] {
  const hints = new Set<string>();
  for (const match of content.matchAll(/^\s*image:\s*["']?([^\s"']+)/gm)) {
    hints.add(match[1] as string);
  }
  for (const match of content.matchAll(
    /docker (?:run|pull)[^\n]*?\s([\w.-]+\/[\w.-]+(?::[\w.-]+)?)/g,
  )) {
    hints.add(match[1] as string);
  }
  return [...hints];
}
