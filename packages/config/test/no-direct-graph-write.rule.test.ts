import { createRequire } from 'node:module';
import { RuleTester } from 'eslint';
import type { Rule } from 'eslint';
import { describe, it } from 'vitest';

const require = createRequire(import.meta.url);
const { rule } = require('../eslint/rules/no-direct-graph-write.cjs') as { rule: Rule.RuleModule };

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2023, sourceType: 'module' } });

describe('nexus/no-direct-graph-write', () => {
  it('allows the domain doc module and the helper API, and rejects direct writes', () => {
    tester.run('no-direct-graph-write', rule, {
      valid: [
        { code: "addNode(doc, node, { origin: 'local:create', now });" },
        { code: "tx(doc, 'local:edit', () => undefined);" },
        // Non-graph roots stay readable: comments and meta are not part of the guarded surface.
        { code: "doc.getMap('comments');" },
        { code: 'doc.getMap(rootName);' },
        { code: 'store.transact = 1;' },
        {
          code: "doc.transact(() => undefined, 'local:edit');",
          filename: '/repo/packages/domain/src/doc/mutations.ts',
          options: [{ allowFiles: ['packages/domain/src/doc/'] }],
        },
        {
          code: "doc.getMap('nodes');",
          filename: '/repo/apps/web/src/data/persistence.test.ts',
          options: [{ allowFiles: ['\\.test\\.tsx?$'] }],
        },
      ],
      invalid: [
        {
          code: "doc.transact(() => undefined, 'local:edit');",
          errors: [{ messageId: 'transact' }],
        },
        { code: "doc.getMap('nodes').set('n1', value);", errors: [{ messageId: 'root' }] },
        { code: "doc.getArray('order').push(['n1']);", errors: [{ messageId: 'root' }] },
        {
          code: "doc.getMap('nodes');",
          filename: '/repo/apps/web/src/data/persistence.ts',
          options: [{ allowFiles: ['packages/domain/src/doc/'] }],
          errors: [{ messageId: 'root' }],
        },
      ],
    });
  });
});
