import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import prettierConfig from 'eslint-config-prettier';

/**
 * Database packages that `apps/web` must never import.
 *
 * This is the mechanical half of the architecture boundary in CLAUDE.md:
 * "Next.js never accesses PostgreSQL". The structural half is that
 * apps/web has no DATABASE_URL in its environment schema.
 */
const FORBIDDEN_DB_PACKAGES = [
  '@prisma/client',
  'prisma',
  'pg',
  'pg-native',
  'pg-promise',
  'postgres',
  'typeorm',
  'drizzle-orm',
  'kysely',
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      'apps/api/generated/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Architecture boundary: the web application may not reach the database.
  // ---------------------------------------------------------------------------
  {
    files: ['apps/web/**/*.{ts,tsx,js,jsx,mjs,mts}'],
    plugins: { '@next/next': nextPlugin },
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,

      // Pages Router only. The rule validates <a href> against the route table it
      // derives from a `pages/` directory; this project is App Router exclusively,
      // so the rule has nothing to check and warns that `pages/` is missing.
      // It cannot detect App Router links, so disabling loses no coverage.
      '@next/next/no-html-link-for-pages': 'off',

      'no-restricted-imports': [
        'error',
        {
          paths: FORBIDDEN_DB_PACKAGES.map((name) => ({
            name,
            message:
              'apps/web must not access the database. NestJS owns PostgreSQL; call the API instead (CLAUDE.md, Architecture boundary).',
          })),
          patterns: [
            {
              group: FORBIDDEN_DB_PACKAGES.map((name) => `${name}/*`),
              message:
                'apps/web must not access the database. NestJS owns PostgreSQL; call the API instead (CLAUDE.md, Architecture boundary).',
            },
          ],
        },
      ],
    },
  },

  // NestJS relies on decorator metadata; empty decorated classes are idiomatic.
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },

  {
    files: ['apps/api/**/*.spec.ts'],
    languageOptions: {
      globals: { ...globals.jest },
    },
  },

  // Config files run in Node and may use CommonJS-ish patterns.
  {
    files: ['**/*.config.{js,mjs,ts}', 'scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  prettierConfig,
);
