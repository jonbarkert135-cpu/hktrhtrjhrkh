/**
 * Detection → node plan → document (P6 §5.2, §7). Every capture path (paste, drop, quick-add, the
 * extension endpoint) goes through `planCapture` + `createNodesFromPlan`, so they cannot diverge:
 * one plan is one transaction and therefore one undo step (§12.6), even for 50 URLs.
 */

import type * as Y from 'yjs';

import { tx } from '../doc/transactions.ts';
import { listNodes } from '../doc/mutations.ts';
import type { Provenance } from '../entities/provenance.ts';
import { builtinNodeTypes } from '../nodes/builtins.ts';
import { decideCapture } from '../nodes/capture.ts';
import { createNode } from '../nodes/lifecycle.ts';
import { findFreePlacement } from '../nodes/placement.ts';
import type { CaptureDetection, TransferFile } from './detect.ts';
import { MAX_PASTE_URLS, TEXT_NODE_MAX_CHARS } from './parse.ts';

/** How the payload reached the board. Recorded on every captured node (§5.13). */
export type CaptureOrigin = 'paste' | 'drop' | 'extension' | 'quick-add';

/** Provenance kinds are a fixed vocabulary (08 §8.1); the exact door is kept in `capturedVia`. */
const PROVENANCE_KIND: Readonly<Record<CaptureOrigin, Provenance['kind']>> = {
  paste: 'paste',
  drop: 'drop',
  extension: 'import',
  'quick-add': 'manual',
};

export const CAPTURE_GRID_GAP = 24;

export interface CapturePlanItem {
  readonly type: string;
  readonly title: string;
  readonly data: Record<string, unknown>;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The file this node was planned from, for the caller's upload step (images, files). */
  readonly file?: TransferFile | undefined;
  readonly source: string | null;
}

export interface CapturePlan {
  readonly items: readonly CapturePlanItem[];
  /** Toast copy: what happened, in the analyst's words. `null` when nothing was planned. */
  readonly message: string | null;
  /** Set when the paste was over `MAX_PASTE_URLS` and was capped rather than truncated silently. */
  readonly overflow: { readonly total: number; readonly kept: number } | null;
}

export interface PlanOptions {
  /** World point the user aimed at (pointer, else viewport centre). */
  readonly at: { readonly x: number; readonly y: number };
  readonly origin: CaptureOrigin;
  /** Boxes already on the board, so a paste never lands on top of existing work. */
  readonly occupied?: readonly { x: number; y: number; w: number; h: number }[];
  /** Over-limit URL pastes become one note listing them (§8) instead of 500 nodes. */
  readonly asList?: boolean | undefined;
}

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

interface Draft {
  type: string;
  title: string;
  data: Record<string, unknown>;
  file?: TransferFile | undefined;
  source: string | null;
}

const draftForUrl = (url: string): Draft => {
  const decision = decideCapture({ kind: 'url', text: url }, builtinNodeTypes());
  return { type: decision.type, title: decision.title, data: decision.data, source: url };
};

const draftForFile = (file: TransferFile): Draft => {
  const decision = decideCapture(
    { kind: 'file', filename: file.name, mime: file.type, size: file.size },
    builtinNodeTypes(),
  );
  return { type: decision.type, title: decision.title, data: decision.data, file, source: null };
};

const draftForText = (text: string, extra: Record<string, unknown> = {}): Draft => {
  // Short text is a sticky `text` card; anything longer is a `note` with a body (§5.3).
  const type = text.length <= TEXT_NODE_MAX_CHARS ? 'text' : 'note';
  const def = builtinNodeTypes().get(type);
  const built = def.capture?.build({ kind: 'text', text });
  return {
    type,
    title: built?.title ?? text.slice(0, 96),
    data: { ...(built?.data ?? {}), ...extra },
    source: null,
  };
};

/** Pure: detection + aim → the exact nodes to create, already laid out. */
export function planCapture(detection: CaptureDetection, options: PlanOptions): CapturePlan {
  const drafts: Draft[] = [];
  let message: string | null = null;
  let overflow: CapturePlan['overflow'] = null;

  switch (detection.kind) {
    case 'urls': {
      if (detection.truncated && options.asList === true) {
        drafts.push(draftForText(detection.urls.join('\n')));
        message = `Imported ${plural(detection.total, 'link')} as a list.`;
        break;
      }
      for (const url of detection.urls) drafts.push(draftForUrl(url));
      message = `Added ${plural(drafts.length, 'link')}`;
      if (detection.truncated) {
        overflow = { total: detection.total, kept: drafts.length };
        message = `Added the first ${plural(MAX_PASTE_URLS, 'link')} of ${String(detection.total)} — import the rest as a list?`;
      }
      break;
    }
    case 'image': {
      for (const file of detection.files) {
        const draft = draftForFile(file);
        if (detection.caption !== null) draft.data = { ...draft.data, alt: detection.caption };
        drafts.push(draft);
      }
      message = `Added ${plural(drafts.length, 'image')}`;
      break;
    }
    case 'files': {
      for (const file of detection.files) drafts.push(draftForFile(file));
      message = `Added ${plural(drafts.length, 'file')}`;
      break;
    }
    case 'text': {
      drafts.push(draftForText(detection.text));
      message = 'Added 1 note';
      break;
    }
    default:
      return { items: [], message: null, overflow: null };
  }

  return { items: layout(drafts, options), message, overflow };
}

/**
 * Grid layout at the aim point with 24 px gaps, then the whole block is nudged to the nearest free
 * slot — a paste never buries existing nodes (§6).
 */
function layout(drafts: readonly Draft[], options: PlanOptions): CapturePlanItem[] {
  if (drafts.length === 0) return [];
  const sizes = drafts.map((draft) => builtinNodeTypes().get(draft.type).defaults.size);
  const cols = Math.ceil(Math.sqrt(drafts.length));
  const colWidth = Math.max(...sizes.map((size) => size.w)) + CAPTURE_GRID_GAP;
  const rowHeight = Math.max(...sizes.map((size) => size.h)) + CAPTURE_GRID_GAP;
  const rows = Math.ceil(drafts.length / cols);
  const blockW = cols * colWidth - CAPTURE_GRID_GAP;
  const blockH = rows * rowHeight - CAPTURE_GRID_GAP;

  const corner = findFreePlacement({
    desired: { x: options.at.x - blockW / 2, y: options.at.y - blockH / 2 },
    size: { w: blockW, h: blockH },
    occupied: options.occupied ?? [],
    gap: CAPTURE_GRID_GAP,
  });

  return drafts.map((draft, index) => {
    const size = sizes[index] ?? { w: 240, h: 160 };
    return {
      type: draft.type,
      title: draft.title,
      data: draft.data,
      x: corner.x + (index % cols) * colWidth,
      y: corner.y + Math.floor(index / cols) * rowHeight,
      w: size.w,
      h: size.h,
      file: draft.file,
      source: draft.source,
    };
  });
}

export interface CreateFromPlanOptions {
  readonly now: string;
  readonly origin: CaptureOrigin;
  readonly makeId?: (() => string) | undefined;
  readonly actorId?: string | null | undefined;
}

/** Writes the plan in one transaction: one paste = one undo step, whatever its size (§14). */
export function createNodesFromPlan(
  doc: Y.Doc,
  plan: CapturePlan,
  options: CreateFromPlanOptions,
): string[] {
  if (plan.items.length === 0) return [];
  return tx(doc, 'local:create', () =>
    plan.items.map((item) => {
      const { node } = createNode(
        doc,
        {
          type: item.type,
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
          title: item.title,
          data: item.data,
          provenance: {
            kind: PROVENANCE_KIND[options.origin],
            source: item.source,
            observedAt: options.now,
            capturedVia: options.origin,
          },
        },
        {
          now: options.now,
          origin: 'local:create',
          makeId: options.makeId,
          actorId: options.actorId ?? null,
        },
      );
      return node.id;
    }),
  );
}

/** Boxes of the nodes already on the board — the `occupied` argument of `planCapture`. */
export function occupiedBoxes(doc: Y.Doc): { x: number; y: number; w: number; h: number }[] {
  return listNodes(doc).map((node) => ({ x: node.x, y: node.y, w: node.w, h: node.h }));
}
