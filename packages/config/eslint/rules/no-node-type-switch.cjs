'use strict';

/**
 * Node types are data, not code (06_NODE_SYSTEM.md §1). Outside `packages/domain/src/nodes`, no
 * file may branch on `node.type`: the moment a `switch (node.type)` exists in the canvas, the
 * inspector or the renderer shell, adding a type stops being "add one file" and becomes a hunt
 * through the codebase — which is exactly how the 21st type ends up rendering a blank card.
 *
 * Reported:
 *   - `switch (<expr>.type)` where the discriminant reads a `.type` property;
 *   - `<expr>.type === '<literal>'` / `!==` comparisons against a string literal;
 *   - `['website', …].includes(<expr>.type)`.
 *
 * Option `allowFiles`: regex sources; a matching file is skipped (the registry, its types, tests).
 */

const MESSAGE =
  'Do not branch on node.type here. Look the behaviour up in the node type registry (@nexus/domain nodeTypes.get(type)) instead — 06_NODE_SYSTEM.md §1.';

const messages = { switchOnType: MESSAGE, compareType: MESSAGE };

/** True for `<something>.type` / `<something>['type']` member reads. */
function isTypeRead(node) {
  if (!node || node.type !== 'MemberExpression') return false;
  if (node.computed) {
    return node.property.type === 'Literal' && node.property.value === 'type';
  }
  return node.property.type === 'Identifier' && node.property.name === 'type';
}

/** Only *node-ish* objects count: `node.type`, `n.type`, `entity.type`, `card.node.type`. */
const OBJECT_NAMES = new Set(['node', 'n', 'entity', 'record', 'card', 'item', 'target', 'source']);

function isNodeTypeRead(node) {
  if (!isTypeRead(node)) return false;
  const object = node.object;
  if (object.type === 'Identifier') return OBJECT_NAMES.has(object.name);
  if (
    object.type === 'MemberExpression' &&
    !object.computed &&
    object.property.type === 'Identifier'
  ) {
    return OBJECT_NAMES.has(object.property.name);
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'node behaviour comes from the registry, never from a type switch' },
    schema: [
      {
        type: 'object',
        properties: { allowFiles: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages,
  },
  create(context) {
    const options = context.options[0] || {};
    const allow = (options.allowFiles || []).map((pattern) => new RegExp(pattern));
    const filename = (context.filename || context.getFilename() || '').replace(/\\/g, '/');
    if (allow.some((re) => re.test(filename))) return {};

    return {
      SwitchStatement(node) {
        if (isNodeTypeRead(node.discriminant)) {
          context.report({ node: node.discriminant, messageId: 'switchOnType' });
        }
      },
      BinaryExpression(node) {
        if (node.operator !== '===' && node.operator !== '!==') return;
        const literalSide =
          node.right.type === 'Literal' && typeof node.right.value === 'string'
            ? node.left
            : node.left.type === 'Literal' && typeof node.left.value === 'string'
              ? node.right
              : null;
        if (literalSide && isNodeTypeRead(literalSide)) {
          context.report({ node, messageId: 'compareType' });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed) return;
        if (callee.property.type !== 'Identifier' || callee.property.name !== 'includes') return;
        const argument = node.arguments[0];
        if (argument && isNodeTypeRead(argument)) {
          context.report({ node, messageId: 'compareType' });
        }
      },
    };
  },
};

module.exports = {
  rule,
  plugin: { rules: { 'no-node-type-switch': rule } },
};
