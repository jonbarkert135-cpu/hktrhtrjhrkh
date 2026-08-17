import config from '@nexus/config/eslint';

export default [
  ...config.react,
  {
    files: ['src/tokens/**/*.ts'],
    // The token layer is where design values are allowed to be literals.
    rules: { 'nexus/no-hardcoded-design-values': 'off' },
  },
];
