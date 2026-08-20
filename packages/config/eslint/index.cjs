'use strict';

const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const reactHooks = require('eslint-plugin-react-hooks');
const jsxA11y = require('eslint-plugin-jsx-a11y');
const { plugin: designPlugin } = require('./rules/no-hardcoded-design-values.cjs');
const { plugin: graphPlugin } = require('./rules/no-direct-graph-write.cjs');
const { plugin: nodeTypePlugin } = require('./rules/no-node-type-switch.cjs');
const { plugin: toolNamePlugin } = require('./rules/no-tool-names-in-core.cjs');
const { plugin: childProcessPlugin } = require('./rules/no-child-process-in-api.cjs');

/** One `raven/*` plugin namespace for every workspace rule. */
const ravenPlugin = {
  rules: {
    ...designPlugin.rules,
    ...graphPlugin.rules,
    ...nodeTypePlugin.rules,
    ...toolNamePlugin.rules,
    ...childProcessPlugin.rules,
  },
};

const TS_FILES = ['**/*.ts', '**/*.tsx'];

/** typescript-eslint "recommended-type-checked" minus the noisy rules we do not want. */
const typeCheckedLite = tseslint.configs.recommendedTypeChecked.map((c) => ({
  ...c,
  ...(c.files ? {} : { files: TS_FILES }),
}));

/** Shared base: every package extends this. `tsconfigRootDir` is set by the consumer. */
const base = [
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', '**/*.gen.ts'] },
  js.configs.recommended,
  ...typeCheckedLite,
  {
    files: TS_FILES,
    languageOptions: {
      parserOptions: { projectService: true },
    },
    plugins: { raven: ravenPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      // Board documents are mutated only through @nexus/domain's doc helpers (08 §2.4).
      'raven/no-direct-graph-write': [
        'error',
        {
          allowFiles: [
            'packages/domain/src/doc/',
            'packages/domain/test/',
            '\\.test\\.tsx?$',
            'bench/',
          ],
        },
      ],
      // R1: the core names no tool; behaviour comes from the manifest registry (10 §1).
      'raven/no-tool-names-in-core': [
        'error',
        {
          allowFiles: [
            'packages/integrations/',
            // "github" is also an OAuth provider id here, which is an identity, not a tool.
            'apps/api/src/auth/',
            'apps/runner/src/executors/builtin-registry\\.ts$',
            '\\.test\\.tsx?$',
            'test/',
            'e2e/',
            'bench/',
          ],
        },
      ],
      // N5: only apps/runner may spawn a process.
      'raven/no-child-process-in-api': [
        'error',
        {
          allowFiles: ['apps/runner/src/executors/container\\.ts$', '\\.test\\.tsx?$', 'scripts/'],
        },
      ],
      // Node behaviour is looked up in the registry, never switched on (06_NODE_SYSTEM.md §1).
      'raven/no-node-type-switch': [
        'error',
        {
          allowFiles: [
            'packages/domain/src/nodes/',
            'packages/domain/test/',
            '\\.test\\.tsx?$',
            'bench/',
          ],
        },
      ],
    },
  },
];

/** Node services and packages. */
const node = [
  ...base,
  {
    files: TS_FILES,
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
];

/** React apps and UI packages: hooks, a11y and the design-token rule. */
const react = [
  ...base,
  {
    files: TS_FILES,
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'raven/no-hardcoded-design-values': [
        'error',
        { allowFiles: ['packages/ui/src/tokens/', '\\.test\\.tsx?$', '\\.stories\\.tsx?$'] },
      ],
    },
  },
];

/** packages/domain: zero escape hatches, the correctness-critical package. */
const domainStrict = [
  ...node,
  {
    files: TS_FILES,
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
    },
  },
];

module.exports = { base, react, node, domainStrict, ravenPlugin };
