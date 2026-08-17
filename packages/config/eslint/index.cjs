'use strict';

const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const reactHooks = require('eslint-plugin-react-hooks');
const jsxA11y = require('eslint-plugin-jsx-a11y');
const { plugin: nexusPlugin } = require('./rules/no-hardcoded-design-values.cjs');

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
    plugins: { nexus: nexusPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
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
      'nexus/no-hardcoded-design-values': [
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

module.exports = { base, react, node, domainStrict, nexusPlugin };
