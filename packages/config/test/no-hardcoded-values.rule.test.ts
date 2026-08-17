import { createRequire } from 'node:module';
import { RuleTester } from 'eslint';
import type { Rule } from 'eslint';
import { describe, it } from 'vitest';

const require = createRequire(import.meta.url);
const { rule } = require('../eslint/rules/no-hardcoded-design-values.cjs') as {
  rule: Rule.RuleModule;
};

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
});

describe('nexus/no-hardcoded-design-values', () => {
  it('accepts tokens and rejects raw design values', () => {
    tester.run('no-hardcoded-design-values', rule, {
      valid: [
        { code: "const c = 'var(--color-surface-1)';" },
        { code: "const p = 'var(--space-4)';" },
        { code: "const b = '1px solid var(--color-border)';" },
        { code: "const z = '0px';" },
        { code: "const t = 'transform var(--motion-fast)';" },
        { code: 'const n = 240;' },
        {
          code: "const hex = '#0f172a';",
          filename: 'packages/ui/src/tokens/colors.ts',
          options: [{ allowFiles: ['packages/ui/src/tokens/'] }],
        },
      ],
      invalid: [
        { code: "const c = '#0f172a';", errors: [{ messageId: 'color' }] },
        { code: 'const c = `color: #fff`;', errors: [{ messageId: 'color' }] },
        { code: "const p = 'padding: 12px';", errors: [{ messageId: 'size' }] },
        { code: "const d = 'all 200ms ease';", errors: [{ messageId: 'duration' }] },
        { code: "const d = 'all 0.3s ease';", errors: [{ messageId: 'duration' }] },
        {
          code: "const hex = '#0f172a';",
          filename: 'packages/web/src/App.ts',
          options: [{ allowFiles: ['packages/ui/src/tokens/'] }],
          errors: [{ messageId: 'color' }],
        },
      ],
    });
  });
});
