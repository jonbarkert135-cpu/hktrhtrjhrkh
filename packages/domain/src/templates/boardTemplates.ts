/**
 * The three built-in board templates (P7 §5.4). A template is just an ordinary `raven.board.v1`
 * export: the workspace repository flags the *board metadata* (`templateOf` / `isTemplate`), and
 * `importBoard(..., { mode: 'copy' })` is what actually turns the export into a fresh board — the
 * same path a user-saved template goes through. There is nothing template-specific in the domain
 * document model, which is exactly what lets any board become a template (§5.4: "users can save
 * any board as a template").
 */

import { makeEdge, type NewEdgeInput } from '../entities/edge.ts';
import { makeNode, type NewNodeInput } from '../entities/node.ts';
import {
  BOARD_EXPORT_FORMAT,
  BoardExportV1Schema,
  type BoardExportV1,
} from '../export/schema.v1.ts';

export interface BuiltinTemplate {
  id: string;
  title: string;
  description: string;
  nodes: readonly NewNodeInput[];
  edges: readonly NewEdgeInput[];
}

const TEMPLATE_PROVENANCE = { kind: 'import' as const };

export const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = [
  {
    id: 'investigation-starter',
    title: 'Investigation starter',
    description: 'A person, their known accounts and an evidence scaffold, ready to connect.',
    nodes: [
      {
        id: 'tpl-person',
        type: 'person',
        x: 0,
        y: 0,
        w: 280,
        h: 160,
        title: 'Subject',
        data: { displayName: 'Subject', notes: 'Who this investigation is about.' },
        provenance: TEMPLATE_PROVENANCE,
      },
      {
        id: 'tpl-account-1',
        type: 'website',
        x: 400,
        y: -120,
        w: 280,
        h: 148,
        title: 'Known account',
        data: { url: 'https://example.com/profile' },
        provenance: TEMPLATE_PROVENANCE,
      },
      {
        id: 'tpl-account-2',
        type: 'website',
        x: 400,
        y: 120,
        w: 280,
        h: 148,
        title: 'Another account',
        data: { url: 'https://example.com/other-profile' },
        provenance: TEMPLATE_PROVENANCE,
      },
      {
        id: 'tpl-evidence',
        type: 'note',
        x: 0,
        y: 320,
        w: 320,
        h: 180,
        title: 'Evidence',
        data: { plain: 'Attach screenshots, quotes and source links here as you find them.' },
        provenance: TEMPLATE_PROVENANCE,
      },
    ],
    edges: [
      { id: 'tpl-edge-1', from: 'tpl-person', to: 'tpl-account-1', type: 'owns', label: 'owns' },
      { id: 'tpl-edge-2', from: 'tpl-person', to: 'tpl-account-2', type: 'owns', label: 'owns' },
      {
        id: 'tpl-edge-3',
        from: 'tpl-person',
        to: 'tpl-evidence',
        type: 'related_to',
        label: 'documented by',
      },
    ],
  },
  {
    id: 'repository-review',
    title: 'Repository review',
    description: 'A repository and a findings note, laid out for a code or dependency review.',
    nodes: [
      {
        id: 'tpl-repo',
        type: 'repo',
        x: 0,
        y: 0,
        w: 300,
        h: 160,
        title: 'Repository',
        data: { url: 'https://github.com/example/example' },
        provenance: TEMPLATE_PROVENANCE,
      },
      {
        id: 'tpl-findings',
        type: 'note',
        x: 400,
        y: 0,
        w: 320,
        h: 200,
        title: 'Findings',
        data: { plain: 'Notable dependencies, maintainers, licence and security findings.' },
        provenance: TEMPLATE_PROVENANCE,
      },
    ],
    edges: [
      {
        id: 'tpl-edge-1',
        from: 'tpl-repo',
        to: 'tpl-findings',
        type: 'related_to',
        label: 'reviewed in',
      },
    ],
  },
  {
    id: 'blank-with-legend',
    title: 'Blank with legend',
    description: 'An empty canvas with one note explaining the tag colours you plan to use.',
    nodes: [
      {
        id: 'tpl-legend',
        type: 'note',
        x: 0,
        y: 0,
        w: 300,
        h: 200,
        title: 'Legend',
        data: {
          plain: 'Tag colours: red = confirmed, amber = unconfirmed, grey = ruled out.',
        },
        provenance: TEMPLATE_PROVENANCE,
      },
    ],
    edges: [],
  },
];

export function findBuiltinTemplate(id: string): BuiltinTemplate | undefined {
  return BUILTIN_TEMPLATES.find((template) => template.id === id);
}

export interface TemplateExportOptions {
  boardId: string;
  now: string;
  appVersion: string;
}

/** Renders a built-in template into a `raven.board.v1` export, ready for `importBoard`. */
export function buildTemplateExport(
  template: BuiltinTemplate,
  options: TemplateExportOptions,
): BoardExportV1 {
  const nodes = template.nodes.map((input) => makeNode(input, options.now));
  const edges = template.edges.map((input) => makeEdge(input, options.now));

  return BoardExportV1Schema.parse({
    format: BOARD_EXPORT_FORMAT,
    exportedAt: options.now,
    generator: { app: 'raven', version: options.appVersion, schemaVersion: 1 },
    board: {
      schemaVersion: 1,
      boardId: options.boardId,
      projectId: null,
      title: template.title,
      description: template.description,
      background: 'dots',
      defaultEdgeRouting: 'smart',
      tagPalette: {},
      savedViews: [],
      createdAt: options.now,
      updatedAt: options.now,
      lastMigratedAt: null,
    },
    nodes,
    edges,
    groups: [],
    richtext: {},
    order: [...nodes.map((node) => node.id), ...edges.map((edge) => edge.id)],
    files: [],
    comments: [],
    extensions: {},
  });
}
