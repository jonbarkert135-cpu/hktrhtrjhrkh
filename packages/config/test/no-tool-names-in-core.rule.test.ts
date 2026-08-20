/**
 * R1 is only real if the rule that enforces it is itself tested (§11 of the phase spec): the moment
 * `no-tool-names-in-core` stops matching, the core can grow a tool branch without CI noticing.
 */

import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { rule } = require('../eslint/rules/no-tool-names-in-core.cjs') as {
  rule: import('eslint').Rule.RuleModule;
};
const { rule: childProcessRule } = require('../eslint/rules/no-child-process-in-api.cjs') as {
  rule: import('eslint').Rule.RuleModule;
};

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
});

describe('no-tool-names-in-core', () => {
  it('flags tool identifiers and literals in the core, and allows the integrations package', () => {
    tester.run('no-tool-names-in-core', rule, {
      valid: [
        { code: 'const entry = registry.get(integrationId);', filename: '/repo/apps/api/src/x.ts' },
        {
          code: "import { manifest } from '@nexus/integrations';",
          filename: '/repo/apps/api/src/x.ts',
        },
        // Outside the core, a tool name is ordinary data (a node type's example host).
        {
          code: "const host = 'github.com';",
          filename: '/repo/packages/domain/src/nodes/types/repo.ts',
        },
        {
          code: "const id = 'github';",
          filename: '/repo/packages/integrations/github/manifest.ts',
          options: [{ allowFiles: ['packages/integrations/'] }],
        },
      ],
      invalid: [
        {
          code: "const id = 'github';",
          filename: '/repo/apps/api/src/x.ts',
          errors: [{ messageId: 'toolName' }],
        },
        {
          code: 'const sherlockRunner = 1;',
          filename: '/repo/apps/api/src/x.ts',
          errors: [{ messageId: 'toolName' }],
        },
        {
          code: "import x from '@nexus/integrations/spiderfoot/parser';",
          filename: '/repo/apps/web/src/app/x.ts',
          errors: [{ messageId: 'toolName' }],
        },
        {
          code: 'const label = `run ${1} expand-url`;',
          filename: '/repo/packages/canvas-engine/src/x.ts',
          errors: [{ messageId: 'toolName' }],
        },
      ],
    });
  });
});

describe('no-child-process-in-api', () => {
  it('flags every way to reach a process spawner outside the runner', () => {
    tester.run('no-child-process-in-api', childProcessRule, {
      valid: [
        { code: "import { readFile } from 'node:fs/promises';" },
        {
          code: "import { spawn } from 'node:child_process';",
          filename: '/repo/apps/runner/src/executors/container.ts',
          options: [{ allowFiles: ['apps/runner/src/executors/container\\.ts$'] }],
        },
      ],
      invalid: [
        {
          code: "import { spawn } from 'node:child_process';",
          errors: [{ messageId: 'forbidden' }],
        },
        { code: "const cp = require('child_process');", errors: [{ messageId: 'forbidden' }] },
        { code: "import Docker from 'dockerode';", errors: [{ messageId: 'forbidden' }] },
        { code: "await import('execa');", errors: [{ messageId: 'forbidden' }] },
      ],
    });
  });
});
