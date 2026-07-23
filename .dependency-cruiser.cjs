/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'engine-no-react-or-next',
      comment:
        'packages/engine must run unmodified inside a browser Worker and headless Node — no framework deps.',
      severity: 'error',
      from: { path: '^packages/engine' },
      to: { path: '^(react|react-dom|next)$', dependencyTypes: ['npm'] },
    },
    {
      name: 'engine-no-app-or-db',
      comment:
        'packages/engine may not depend on the app layer or the database layer (§2.1/§2.2 of the build brief).',
      severity: 'error',
      from: { path: '^packages/engine' },
      to: { path: '^(apps/web|packages/db)' },
    },
    {
      name: 'contracts-no-deps-on-anything-else',
      comment:
        '@netverdict/contracts is the wire format every layer imports; it must not import back from any of them.',
      severity: 'error',
      from: { path: '^packages/contracts' },
      to: { path: '^(apps/web|packages/engine|packages/db)' },
    },
    {
      name: 'no-circular',
      comment: 'Circular imports make module boundaries meaningless.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'types'] },
    doNotFollow: { path: 'node_modules' },
  },
};
