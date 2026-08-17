'use strict';

/**
 * Board documents are mutated only through `packages/domain/src/doc` (08_DATA_MODEL.md §2.4,
 * 20_ROADMAP.md P3 §5.3). Everything else must call the exported helpers, which is what makes undo,
 * the size guard and (from P8) projection batching possible in one place.
 *
 * Reported:
 *   - `<doc>.transact(...)`   — the transaction helper `tx(doc, origin, fn)` is the only entry point;
 *   - `<doc>.getMap('nodes' | 'edges' | 'groups' | 'richtext' | 'assets')` and
 *     `<doc>.getArray('order')` — reaching into a content root bypasses validation.
 *
 * Option `allowFiles`: regex sources; a matching file is skipped (the doc module itself, tests).
 */

const GRAPH_ROOTS = new Set(['nodes', 'edges', 'groups', 'richtext', 'assets', 'order']);

const MESSAGES = {
  transact:
    'Do not call doc.transact directly. Use tx(doc, origin, fn) from @nexus/domain so the mutation has an origin.',
  root: 'Do not read the "{{name}}" root directly. Use the helpers from @nexus/domain (boardRoots, addNodes, updateNode, …).',
};

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'board document writes go through @nexus/domain doc helpers' },
    schema: [
      {
        type: 'object',
        properties: { allowFiles: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: MESSAGES,
  },
  create(context) {
    const options = context.options[0] || {};
    const allow = (options.allowFiles || []).map((p) => new RegExp(p));
    const filename = (context.filename || context.getFilename() || '').replace(/\\/g, '/');
    if (allow.some((re) => re.test(filename))) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed) return;
        const property = callee.property;
        if (property.type !== 'Identifier') return;

        if (property.name === 'transact') {
          context.report({ node, messageId: 'transact' });
          return;
        }
        if (property.name !== 'getMap' && property.name !== 'getArray') return;
        const first = node.arguments[0];
        if (!first || first.type !== 'Literal' || typeof first.value !== 'string') return;
        if (!GRAPH_ROOTS.has(first.value)) return;
        context.report({ node, messageId: 'root', data: { name: first.value } });
      },
    };
  },
};

module.exports = {
  rule,
  plugin: { rules: { 'no-direct-graph-write': rule } },
};
