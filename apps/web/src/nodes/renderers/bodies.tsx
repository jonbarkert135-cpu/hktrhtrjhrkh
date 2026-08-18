/**
 * Per-type card bodies (P4 §5.3, §6). Every one of these is a pure presentational component: it
 * receives a plain node object and renders it. None of them reads the Y.Doc, holds state or knows
 * how to write — that is what keeps re-renders bounded to the node that actually changed (§7).
 *
 * The registry maps `componentId` → component; nothing here is selected by a `node.type` switch.
 */

import type { BoardNode } from '@nexus/domain';

import { relativeTime } from '../cardState.ts';

export interface NodeBodyProps {
  node: BoardNode;
  /** Full detail (L3) vs. compact (L2). The card decides; the body only reads it. */
  detailed: boolean;
  now?: number;
}

export type NodeBodyComponent = (props: NodeBodyProps) => React.ReactElement | null;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${String(bytes)} B`;
  if (bytes < 1_000_000) return `${String(Math.round(bytes / 100) / 10)} KB`;
  if (bytes < 1_000_000_000) return `${String(Math.round(bytes / 100_000) / 10)} MB`;
  return `${String(Math.round(bytes / 100_000_000) / 10)} GB`;
}

function WebsiteBody({ node, detailed, now }: NodeBodyProps) {
  const url = text(node.data['url']);
  const fetchedAt = text(node.data['fetchedAt']);
  return (
    <div className="nx-card-body">
      <span className="nx-card-meta">{url === '' ? 'Add a URL' : hostOf(url)}</span>
      {detailed && text(node.data['description']) !== '' ? (
        <p className="nx-card-text" data-clamp="3">
          {text(node.data['description'])}
        </p>
      ) : null}
      {fetchedAt !== '' ? (
        <span className="nx-card-foot">Fetched {relativeTime(fetchedAt, now)}</span>
      ) : null}
    </div>
  );
}

function LinkBody({ node }: NodeBodyProps) {
  const url = text(node.data['url']);
  const label = text(node.data['label']);
  return (
    <div className="nx-card-body">
      <span className="nx-card-text" data-clamp="1">
        {label === '' ? (url === '' ? 'Paste a link' : url) : label}
      </span>
      {url === '' ? null : <span className="nx-card-meta">{hostOf(url)}</span>}
    </div>
  );
}

function TextBody({ node, detailed }: NodeBodyProps) {
  const plain = text(node.data['plain']);
  return (
    <div className="nx-card-body">
      {plain === '' ? (
        <span className="nx-card-placeholder">Write, paste, or press N for another note</span>
      ) : (
        <p className="nx-card-text" data-clamp={detailed ? '8' : '3'}>
          {plain}
        </p>
      )}
    </div>
  );
}

function NoteBody({ node, detailed }: NodeBodyProps) {
  const severity = text(node.data['severity']) || 'info';
  const plain = text(node.data['plain']);
  const sourceRef = text(node.data['sourceRef']);
  return (
    <div className="nx-card-body">
      <span className="nx-chip" data-severity={severity}>
        {severity}
      </span>
      {plain === '' ? (
        <span className="nx-card-placeholder">What did you find?</span>
      ) : (
        <p className="nx-card-text" data-clamp={detailed ? '8' : '3'}>
          {plain}
        </p>
      )}
      {detailed && sourceRef !== '' ? (
        <span className="nx-card-foot">Refers to {sourceRef}</span>
      ) : null}
    </div>
  );
}

function ImageBody({ node }: NodeBodyProps) {
  const alt = text(node.data['alt']);
  const width = num(node.data['naturalWidth']);
  const height = num(node.data['naturalHeight']);
  const dominant = text(node.data['dominantColor']);
  const hasGps = (node.data['exif'] as { hasGps?: unknown } | null)?.hasGps === true;
  return (
    <div className="nx-card-body">
      {/* The real bitmap arrives with the upload pipeline; until then the dominant colour stands
          in, which is also the blur-up placeholder the loaded image fades from (P4 §6). */}
      <div
        className="nx-card-thumb"
        data-testid="image-placeholder"
        role="img"
        aria-label={alt === '' ? 'Image preview' : alt}
        style={dominant === '' ? undefined : { background: dominant }}
      />
      <span className="nx-card-meta">
        {width !== null && height !== null && width > 0
          ? `${String(width)} × ${String(height)}`
          : 'Not uploaded yet'}
        {hasGps ? ' · GPS' : ''}
      </span>
    </div>
  );
}

function FileBody({ node }: NodeBodyProps) {
  const filename = text(node.data['filename']);
  const size = num(node.data['size']) ?? 0;
  const pages = num(node.data['pages']);
  return (
    <div className="nx-card-body">
      <span className="nx-card-text" data-clamp="1">
        {filename === '' ? 'Untitled file' : filename}
      </span>
      <span className="nx-card-meta">
        {text(node.data['mime']) || 'unknown type'}
        {size > 0 ? ` · ${formatBytes(size)}` : ''}
        {pages !== null && pages > 0 ? ` · ${String(pages)} pages` : ''}
      </span>
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter((part) => part !== '');
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${second}`.toUpperCase();
}

function PersonBody({ node, detailed }: NodeBodyProps) {
  const displayName = text(node.data['displayName']);
  const usernames = list(node.data['usernames']);
  const emails = list(node.data['emails']);
  return (
    <div className="nx-card-body nx-card-person">
      <span className="nx-avatar" aria-hidden="true">
        {initialsOf(displayName === '' ? node.title : displayName)}
      </span>
      <div className="nx-card-person-detail">
        <span className="nx-card-text" data-clamp="1">
          {displayName === '' ? 'Unnamed person' : displayName}
        </span>
        <span className="nx-chip-row">
          {usernames.slice(0, detailed ? 6 : 2).map((username) => (
            <span key={username} className="nx-chip">
              {username}
            </span>
          ))}
        </span>
        {detailed && emails.length > 0 ? <span className="nx-card-meta">{emails[0]}</span> : null}
      </div>
    </div>
  );
}

function RepoBody({ node, detailed }: NodeBodyProps) {
  const owner = text(node.data['owner']);
  const name = text(node.data['name']);
  const stars = num(node.data['stars']);
  const language = text(node.data['language']);
  const analysis = node.data['analysis'] as { summary?: unknown } | null;
  const summary = text(analysis?.summary);
  return (
    <div className="nx-card-body">
      <span className="nx-card-text" data-clamp="1">
        {owner === '' && name === '' ? 'Add a repository URL' : `${owner}/${name}`}
      </span>
      <span className="nx-card-meta">
        {language === '' ? 'Language unknown' : language}
        {stars !== null ? ` · ★ ${String(stars)}` : ''}
      </span>
      {detailed && summary !== '' ? (
        <p className="nx-card-text" data-clamp="3">
          {summary}
        </p>
      ) : null}
    </div>
  );
}

function UnknownBody({ node }: NodeBodyProps) {
  return (
    <div className="nx-card-body">
      <span className="nx-card-meta">Unsupported type “{node.type}”</span>
      {/* Read-only on purpose: this build cannot validate the payload, so it must not edit it. */}
      <pre className="nx-card-json" data-testid="unknown-payload">
        {JSON.stringify(node.data, null, 2).slice(0, 600)}
      </pre>
    </div>
  );
}

/** `componentId` → component. A type the build does not know renders through `node.unknown`. */
export const NODE_BODIES: Record<string, NodeBodyComponent> = {
  'node.website': WebsiteBody,
  'node.link': LinkBody,
  'node.text': TextBody,
  'node.note': NoteBody,
  'node.image': ImageBody,
  'node.file': FileBody,
  'node.person': PersonBody,
  'node.repo': RepoBody,
  'node.unknown': UnknownBody,
};

export function bodyFor(componentId: string): NodeBodyComponent {
  return NODE_BODIES[componentId] ?? UnknownBody;
}
