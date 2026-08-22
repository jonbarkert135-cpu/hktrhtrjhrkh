/** Step C — language detection (11_GITHUB.md §5.3). */
import type { LanguageStat } from '@nexus/domain';

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.cs': 'C#',
  '.c': 'C',
  '.h': 'C',
  '.cc': 'C++',
  '.cpp': 'C++',
  '.hpp': 'C++',
  '.swift': 'Swift',
  '.sh': 'Shell',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.html': 'HTML',
  '.sql': 'SQL',
};

const extname = (path: string): string => {
  const file = path.slice(path.lastIndexOf('/') + 1);
  const dot = file.lastIndexOf('.');
  return dot <= 0 ? '' : file.slice(dot).toLowerCase();
};

const round2 = (value: number): number => Number(value.toFixed(2));

/**
 * Byte counts from GitHub's linguist win when present; otherwise an extension histogram over the
 * tree, marked `heuristic` so the UI never presents a guess as measured (§5.3).
 */
export function detectLanguages(
  api: Record<string, number>,
  treePaths: readonly string[],
): LanguageStat[] {
  const total = Object.values(api).reduce((a, b) => a + b, 0);
  if (total > 0) {
    return Object.entries(api)
      .map(([name, bytes]) => ({
        name,
        bytes,
        pct: round2((100 * bytes) / total),
        source: 'api' as const,
      }))
      .sort((a, b) => b.bytes - a.bytes);
  }
  const histogram = new Map<string, number>();
  for (const path of treePaths) {
    const lang = EXT_TO_LANG[extname(path)];
    if (lang) histogram.set(lang, (histogram.get(lang) ?? 0) + 1);
  }
  const files = [...histogram.values()].reduce((a, b) => a + b, 0) || 1;
  return [...histogram]
    .map(([name, count]) => ({
      name,
      bytes: 0,
      pct: round2((100 * count) / files),
      source: 'heuristic' as const,
    }))
    .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
}

export function primaryLanguage(languages: readonly LanguageStat[]): string | null {
  return (languages.find((lang) => lang.pct >= 15) ?? languages[0])?.name ?? null;
}
