import { describe, expect, it } from 'vitest';

import { importBoard } from '../src/export/importBoard.ts';
import {
  BUILTIN_TEMPLATES,
  buildTemplateExport,
  findBuiltinTemplate,
} from '../src/templates/boardTemplates.ts';
import { listEdges, listNodes } from '../src/doc/mutations.ts';
import { T0 } from './doc-fixtures.ts';

describe('built-in templates', () => {
  it('ships exactly the three templates named in P7 §5.4', () => {
    expect(BUILTIN_TEMPLATES.map((t) => t.id).sort()).toEqual([
      'blank-with-legend',
      'investigation-starter',
      'repository-review',
    ]);
  });

  it.each(BUILTIN_TEMPLATES)('renders a valid, importable export for "%s"', (template) => {
    const rendered = buildTemplateExport(template, {
      boardId: 'tpl-board',
      now: T0,
      appVersion: '0.0.0-test',
    });
    expect(rendered.nodes.length).toBe(template.nodes.length);

    let seq = 0;
    const result = importBoard(rendered, {
      mode: 'copy',
      newId: () => `imported-${String(seq++)}`,
      now: T0,
    });

    expect(result.report.created.nodes).toBe(template.nodes.length);
    expect(result.report.created.edges).toBe(template.edges.length);
    expect(listNodes(result.doc)).toHaveLength(template.nodes.length);
    expect(listEdges(result.doc)).toHaveLength(template.edges.length);
  });

  it('finds a template by id and returns undefined for an unknown one', () => {
    expect(findBuiltinTemplate('investigation-starter')?.title).toBe('Investigation starter');
    expect(findBuiltinTemplate('nope')).toBeUndefined();
  });
});
