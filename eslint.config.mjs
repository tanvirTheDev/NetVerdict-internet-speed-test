// @ts-check
import tseslint from 'typescript-eslint';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import globals from 'globals';
import { baseConfig, engineIsolationRules } from '@netverdict/config/eslint-preset';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.tsbuildinfo',
    ],
  },
  ...baseConfig(),
  {
    files: ['packages/engine/src/**/*.ts'],
    ...engineIsolationRules(),
  },
  // `eslint-config-next/core-web-vitals` is an array of config objects, not
  // a single one — each entry is force-scoped to apps/web here (some ship
  // their own repo-wide `files` glob, which would otherwise apply
  // Next/React-specific parsing and rules outside the one app that has
  // React at all).
  ...nextCoreWebVitals.map((config) => ({
    ...config,
    files: ['apps/web/**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
  })),
  // Config/build/tooling files aren't part of any tsconfig's `include` and
  // don't need type-aware linting. Two separate entries (not one
  // spread-merged object) so ESLint's own config cascade merges
  // `languageOptions` correctly — a plain object spread would let
  // whichever source object is listed last silently discard the other's
  // `languageOptions` keys wholesale instead of merging `parser`/
  // `parserOptions` individually.
  {
    files: [
      '*.config.{js,mjs,cjs,ts}',
      '**/*.config.{js,mjs,cjs,ts}',
      '.dependency-cruiser.cjs',
      'packages/config/*.mjs',
      'e2e/**/*.ts',
    ],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Must come after the block above: resets the parser the Next block
    // set for `.mjs`/`.ts` config files — Next's wrapper parser doesn't
    // forward parserServices the way typed rules expect, which crashes on
    // a file with no tsconfig.
    files: [
      '*.config.{js,mjs,cjs,ts}',
      '**/*.config.{js,mjs,cjs,ts}',
      '.dependency-cruiser.cjs',
      'packages/config/*.mjs',
      'e2e/**/*.ts',
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: false },
      globals: globals.node,
    },
  },
  {
    // The CLI harness's entire job is printing progress and the result to
    // stdout/stderr (§5.6 headless parity) — that is not a debugging leftover.
    files: ['packages/engine/bin/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];
