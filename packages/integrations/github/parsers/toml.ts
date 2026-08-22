/**
 * Minimal TOML reader for manifests (`pyproject.toml`, `Cargo.toml`).
 *
 * Deliberately a subset: tables, array-of-tables, scalars, single-line arrays and inline tables —
 * which is all a package manifest uses. Anything it cannot read is reported by the caller as a
 * parse error rather than guessed at, so we never invent a dependency (§5.11).
 */

export type TomlValue = string | number | boolean | TomlValue[] | { [k: string]: TomlValue };
export type TomlTable = { [k: string]: TomlValue };

const unquote = (raw: string): string =>
  (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
    ? raw.slice(1, -1)
    : raw;

function splitTopLevel(body: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const ch of body) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') depth -= 1;
    else if (ch === sep && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

function parseValue(raw: string): TomlValue {
  const value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitTopLevel(value.slice(1, -1), ',').map(parseValue);
  }
  if (value.startsWith('{') && value.endsWith('}')) {
    const table: TomlTable = {};
    for (const entry of splitTopLevel(value.slice(1, -1), ',')) {
      const eq = entry.indexOf('=');
      if (eq > 0) table[unquote(entry.slice(0, eq).trim())] = parseValue(entry.slice(eq + 1));
    }
    return table;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return unquote(value);
}

/** Splits `a.b."c.d"` into path segments. */
function keyPath(key: string): string[] {
  return splitTopLevel(key, '.').map(unquote);
}

function descend(root: TomlTable, path: string[]): TomlTable {
  let node = root;
  for (const segment of path) {
    const next = node[segment];
    if (next === undefined || typeof next !== 'object' || Array.isArray(next)) {
      const created: TomlTable = {};
      node[segment] = created;
      node = created;
    } else {
      node = next;
    }
  }
  return node;
}

export function parseToml(source: string): TomlTable {
  const root: TomlTable = {};
  let current = root;
  // Multi-line arrays are the one wrap we must survive: join them before scanning lines.
  const flattened = source.replace(/\[(?:[^[\]"']|"[^"]*"|'[^']*')*\]/gs, (m) =>
    m.includes('\n') ? m.replace(/\s*\n\s*/g, ' ') : m,
  );
  for (const rawLine of flattened.split('\n')) {
    const line = rawLine.replace(/(^|\s)#.*$/, '').trim();
    if (line === '') continue;
    if (line.startsWith('[[') && line.endsWith(']]')) {
      const path = keyPath(line.slice(2, -2).trim());
      const parent = descend(root, path.slice(0, -1));
      const key = path[path.length - 1] as string;
      const existing = parent[key];
      const list = Array.isArray(existing) ? existing : [];
      const entry: TomlTable = {};
      list.push(entry);
      parent[key] = list;
      current = entry;
      continue;
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      current = descend(root, keyPath(line.slice(1, -1).trim()));
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const path = keyPath(line.slice(0, eq).trim());
    const target = path.length > 1 ? descend(current, path.slice(0, -1)) : current;
    target[path[path.length - 1] as string] = parseValue(line.slice(eq + 1));
  }
  return root;
}

export function asTable(value: TomlValue | undefined): TomlTable | null {
  return value !== undefined && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function asArray(value: TomlValue | undefined): TomlValue[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: TomlValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}
