// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Shared strict, type-aware ESLint base for every package/app in the
 * monorepo. `projectService: true` lets typescript-eslint discover the
 * nearest tsconfig for each linted file instead of listing every project
 * path by hand.
 */
export function baseConfig() {
  return tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir: process.cwd(),
        },
        globals: {
          ...globals.es2022,
        },
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-non-null-assertion': 'error',
        '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/restrict-template-expressions': [
          'error',
          { allowNumber: true, allowBoolean: true },
        ],
        'no-console': ['warn', { allow: ['warn', 'error'] }],
      },
    },
    eslintConfigPrettier,
  );
}

/**
 * `packages/engine` is the module every layer trusts (§2.2 of the build
 * brief): it must stay framework- and Node-free so it can run unmodified
 * in a browser Worker. This blocks the imports that would silently
 * violate that boundary.
 */
export function engineIsolationRules() {
  return {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'packages/engine must stay framework-agnostic.' },
            { name: 'next', message: 'packages/engine must stay framework-agnostic.' },
            { name: 'fs', message: 'packages/engine must run in a browser Worker; no Node fs.' },
            {
              name: 'path',
              message: 'packages/engine must run in a browser Worker; no Node path.',
            },
          ],
          patterns: [
            {
              group: ['@netverdict/db', 'apps/web/*'],
              message: 'packages/engine may not depend on the app or the database layer.',
            },
          ],
        },
      ],
    },
  };
}

export { globals };
