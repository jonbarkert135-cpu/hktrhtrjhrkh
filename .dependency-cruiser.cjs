/** Layer boundaries from 00_MASTER.md §6 and 19_DEPLOYMENT.md §6. */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'canvas-engine-is-framework-free',
      comment: 'packages/canvas-engine must never depend on React or any app.',
      severity: 'error',
      from: { path: '^packages/canvas-engine' },
      to: { path: '(^apps/)|(node_modules/react)' },
    },
    {
      name: 'domain-is-pure',
      comment: 'packages/domain depends on nothing internal except config.',
      severity: 'error',
      from: { path: '^packages/domain' },
      to: { path: '^(apps/|packages/(?!domain|config))' },
    },
    {
      name: 'packages-never-import-apps',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'web-has-no-server-deps',
      comment:
        'The SPA must not import server-only packages at runtime. A type-only import of the ' +
        'tRPC AppRouter is erased at build time and is how end-to-end type safety works.',
      severity: 'error',
      from: { path: '^apps/web' },
      to: { path: '^(packages/db|apps/api)', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$',
          '\\.config\\.(js|cjs|mjs|ts)$',
          // generated artefact and the vitest setup file: both are entry points, not orphans
          'packages/ui/tailwind/preset\\.generated\\.js$',
          'apps/web/src/test/setup\\.ts$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(node_modules|dist|coverage|\\.turbo)' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'types'] },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
