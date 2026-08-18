/**
 * The node type contract (06_NODE_SYSTEM.md §3). A node type is *data*: a definition object with a
 * schema, defaults, an LOD appearance, inspector field descriptors and IO mappings. Nothing outside
 * `packages/domain/src/nodes` may branch on `node.type` — the `no-node-type-switch` lint rule
 * enforces that, which is what keeps the engine and the React shell type-agnostic.
 *
 * React components are referenced by a string `componentId`, never imported here: `packages/domain`
 * stays free of DOM and React (00_MASTER.md §5 dependency boundary).
 */

import type { BoardNode } from '../entities/node.ts';

/**
 * The only thing the registry needs from a payload schema is "turn unknown input into TData".
 * Typing it structurally instead of as `z.ZodType<TData>` avoids zod's invariant input parameter,
 * which otherwise rejects every `.passthrough()` object (its input and output types differ).
 */
export interface DataParser<TData> {
  parse(value: unknown): TData;
}

/**
 * A node narrowed to one type's payload. `BoardNode` carries an index signature (unknown keys are
 * preserved), so this is an intersection rather than an `Omit`: `Omit` would erase every named
 * field and leave only the index signature.
 */
export type TypedNode<TData> = BoardNode & { data: TData };

/** Resize behaviour of a card. `ratio` keeps the aspect of the underlying media. */
export type ResizeMode = 'free' | 'width' | 'ratio' | 'none';

export interface NodeSizeDefaults {
  size: { w: number; h: number };
  minSize: { w: number; h: number };
  maxSize: { w: number; h: number };
  resize: ResizeMode;
  /** Height follows the content until `maxSize.h` (text-ish cards). */
  autoHeight: boolean;
}

/**
 * What the canvas engine needs to paint a node at L0/L1. The engine receives colours and a glyph
 * id — never a type name it has to interpret (06 §14, "engine only receives an accent and a glyph").
 */
export interface LodGlyph {
  /** Design-token name, e.g. `--node-web`. Resolved to a colour by the theme layer. */
  colorToken: string;
  /** Icon id from the lucide subset in `packages/ui`. */
  icon: string;
  /** Glyph shape used at L0/L1; the engine knows these four shapes and nothing else. */
  shape: 'rounded' | 'circle' | 'diamond' | 'document';
}

export type InspectorControl =
  | 'text'
  | 'textarea'
  | 'url'
  | 'email'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'datetime'
  | 'toggle'
  | 'tags'
  | 'confidence'
  | 'richtext'
  | 'file'
  | 'readonly'
  | 'json';

export type InspectorSection = 'identity' | 'content' | 'attributes' | 'provenance' | 'appearance';

/** A generically rendered inspector row (04_DESIGN_SYSTEM.md §11). */
export interface InspectorField {
  /** Dot path into the entity, e.g. `data.url`. */
  key: string;
  label: string;
  control: InspectorControl;
  section: InspectorSection;
  options?: ReadonlyArray<{ value: string; label: string }>;
  placeholder?: string;
  help?: string;
  required?: boolean;
  multiline?: boolean;
}

export interface ValidationIssue {
  code: string;
  field: string;
  /** User-facing, specific, and it says what to do (03_UX.md §12). */
  message: string;
  severity: 'error' | 'warning';
}

/** Text fed into the search index (P7) and into export. */
export interface SearchFields {
  title: string;
  body: string;
  keywords: string[];
}

/** A clipboard / drop payload offered to every type's `capture.match` (06 §7.1). */
export interface CaptureInput {
  kind: 'url' | 'text' | 'file';
  text?: string | undefined;
  mime?: string | undefined;
  filename?: string | undefined;
  size?: number | undefined;
}

export interface CaptureResult<TData> {
  title?: string | undefined;
  data: Partial<TData>;
}

export interface NodeCapabilities {
  editableText: boolean;
  resizable: boolean;
  connectable: boolean;
  groupable: boolean;
  enrichable: boolean;
  duplicatable: boolean;
  hasMedia: boolean;
  aiSummarizable: boolean;
}

export interface NodeTypeDefinition<TData = Record<string, unknown>> {
  /** Stable id, also the persisted `nodes.type` value. Never renamed (06 §11). */
  type: string;
  label: string;
  labelPlural: string;
  /** Validates and fills `data` only; `EntityBase` is validated by `NodeSchema`. */
  schema: DataParser<TData>;
  glyph: LodGlyph;
  defaults: NodeSizeDefaults & { data: TData };
  capabilities: NodeCapabilities;
  /** Resolved lazily by the UI layer; `packages/domain` never imports React. */
  componentId: string;
  inspector: readonly InspectorField[];
  /** Normalised identity keys used by dedupe; empty means "never auto-deduped". */
  identityKeys(node: TypedNode<TData>): string[];
  searchFields(node: TypedNode<TData>): SearchFields;
  /** Extra, cross-field checks beyond zod. */
  validate?(node: TypedNode<TData>): ValidationIssue[];
  /** Confidence in [0,1] that a pasted/dropped payload should become this type. */
  capture?: {
    match(input: CaptureInput): number;
    build(input: CaptureInput): CaptureResult<TData>;
  };
  io: {
    /** Payload written to `nexus.board.v1`; must round-trip through `fromExport` (N9). */
    toExport(node: TypedNode<TData>): Record<string, unknown>;
    fromExport(raw: unknown): TData;
    toMarkdown(node: TypedNode<TData>): string;
  };
}

/**
 * Any definition, for registry storage where the payload type is not statically known. Method
 * parameters are bivariant, so a concrete `NodeTypeDefinition<WebsiteData>` is storable as-is.
 */
export type AnyNodeTypeDefinition = NodeTypeDefinition<unknown>;
