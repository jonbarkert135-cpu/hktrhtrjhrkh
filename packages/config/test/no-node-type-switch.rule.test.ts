import { createRequire } from 'node:module';
import { RuleTester } from 'eslint';
import type { Rule } from 'eslint';
import { describe, it } from 'vitest';

const require = createRequire(import.meta.url);
const { rule } = require('../eslint/rules/no-node-type-switch.cjs') as { rule: Rule.RuleModule };

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2023, sourceType: 'module' } });

describe('nexus/no-node-type-switch', () => {
  it('allows registry lookups and rejects type branching outside the registry', () => {
    tester.run('no-node-type-switch', rule, {
      valid: [
        { code: 'const def = nodeTypes.get(node.type);' },
        { code: 'const label = registry.get(node.type).label;' },
        // Not a node: switching on an intent or an event discriminant stays legal.
        { code: "switch (intent.t) { case 'move-nodes': break; }" },
        { code: "if (event.type === 'click') doThing();" },
        { code: 'switch (node.status) { default: break; }' },
        {
          code: "switch (node.type) { case 'website': break; }",
          filename: '/repo/packages/domain/src/nodes/registry.ts',
          options: [{ allowFiles: ['packages/domain/src/nodes/'] }],
        },
      ],
      invalid: [
        {
          code: "switch (node.type) { case 'website': break; }",
          errors: [{ messageId: 'switchOnType' }],
        },
        {
          code: "if (node.type === 'image') render();",
          errors: [{ messageId: 'compareType' }],
        },
        {
          code: "const isText = 'text' !== entity.type;",
          errors: [{ messageId: 'compareType' }],
        },
        {
          code: "const editable = ['text', 'note'].includes(node.type);",
          errors: [{ messageId: 'compareType' }],
        },
        {
          code: "if (card.node.type === 'file') preview();",
          errors: [{ messageId: 'compareType' }],
        },
        {
          code: "if (node['type'] === 'file') preview();",
          errors: [{ messageId: 'compareType' }],
        },
        {
          code: 'switch (node.type) { default: break; }',
          filename: '/repo/apps/web/src/nodes/NodeRenderer.tsx',
          options: [{ allowFiles: ['packages/domain/src/nodes/'] }],
          errors: [{ messageId: 'switchOnType' }],
        },
      ],
    });
  });
});
