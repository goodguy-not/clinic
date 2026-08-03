#!/usr/bin/env node
/**
 * Mechanical architecture-boundary checks for apps/web.
 *
 * ESLint's no-restricted-imports covers static `import` statements in linted
 * source. This script covers what a lint rule cannot: package manifests,
 * `require()` and dynamic import, environment variable names, environment
 * files, build configuration, and the shape of the App Router tree.
 *
 * Scope is the whole of apps/web — not just src/ — because configuration files
 * such as next.config.ts are exactly where a database variable would otherwise
 * slip in unnoticed.
 *
 * Checks:
 *   1. apps/web declares no database dependency.
 *   2. No hand-written file under apps/web references a database package.
 *   3. No hand-written file under apps/web references DATABASE_URL.
 *   4. apps/web exposes no generic catch-all API route (no `[...slug]`).
 *
 * Exits non-zero with a readable report on any violation.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const webRoot = join(repoRoot, 'apps', 'web');
const webApiRoutes = join(webRoot, 'src', 'app', 'api');

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

/** Generated output and dependencies: never hand-written, never scanned. */
const EXCLUDED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', 'coverage', 'generated']);
const EXCLUDED_FILES = new Set(['next-env.d.ts']);

/** Every module flavour that can carry an import, plus env and JSON manifests. */
const SCANNED_EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

function isEnvFile(name) {
  return name === '.env' || name.startsWith('.env.');
}

function shouldScan(filePath) {
  const name = basename(filePath);
  if (EXCLUDED_FILES.has(name)) return false;
  return SCANNED_EXTENSIONS.test(name) || isEnvFile(name);
}

const violations = [];

function walk(dir, onFile) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry)) continue;
      walk(full, onFile);
    } else {
      onFile(full);
    }
  }
}

const toRepoPath = (file) => relative(repoRoot, file).split(sep).join('/');

// --- 1. no database dependency declared -------------------------------------
const webPkgPath = join(webRoot, 'package.json');
if (existsSync(webPkgPath)) {
  const webPkg = JSON.parse(readFileSync(webPkgPath, 'utf8'));
  const declared = {
    ...(webPkg.dependencies ?? {}),
    ...(webPkg.devDependencies ?? {}),
    ...(webPkg.peerDependencies ?? {}),
  };
  for (const name of FORBIDDEN_DB_PACKAGES) {
    if (name in declared) {
      violations.push(`apps/web/package.json declares forbidden database dependency "${name}"`);
    }
  }
}

// --- 2 & 3. no database package or DATABASE_URL in any hand-written file -----
let scannedCount = 0;
walk(webRoot, (file) => {
  if (!shouldScan(file)) return;
  scannedCount += 1;

  const text = readFileSync(file, 'utf8');
  const rel = toRepoPath(file);

  for (const name of FORBIDDEN_DB_PACKAGES) {
    const escaped = name.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');
    // import ... from 'pkg' | require('pkg') | import('pkg'), including deep paths.
    const importPattern = new RegExp(
      String.raw`(?:from\s*|require\s*\(\s*|import\s*\(\s*)['"]${escaped}(?:/[^'"]*)?['"]`,
    );
    if (importPattern.test(text)) {
      violations.push(`${rel} imports forbidden database package "${name}"`);
    }
  }

  if (text.includes('DATABASE_URL')) {
    violations.push(
      `${rel} references DATABASE_URL — the web application has no database access by design`,
    );
  }
});

// --- 4. no generic catch-all BFF route --------------------------------------
walk(webApiRoutes, (file) => {
  const rel = toRepoPath(file);
  if (/\[\.\.\..+\]/.test(rel)) {
    violations.push(
      `${rel} is a catch-all API route — a generic proxy is forbidden (CLAUDE.md, Architecture boundary)`,
    );
  }
});

// --- report ------------------------------------------------------------------
if (violations.length > 0) {
  console.error('Architecture boundary check FAILED:\n');
  for (const violation of violations) console.error(`  - ${violation}`);
  console.error('');
  process.exit(1);
}

console.log(`Architecture boundary check passed (${scannedCount} hand-written files scanned):`);
console.log('  - apps/web declares no database dependency');
console.log('  - no database package imported anywhere under apps/web');
console.log(
  '  - no DATABASE_URL reference anywhere under apps/web, including config and env files',
);
console.log('  - apps/web exposes no catch-all API route');
