#!/usr/bin/env node
/**
 * Mechanical architecture-boundary checks.
 *
 * ESLint's no-restricted-imports covers static `import` statements in linted
 * source. This script covers what a lint rule cannot: package manifests,
 * `require()` and dynamic import, environment variable names, environment
 * files, build configuration, and the shape of the App Router tree.
 *
 * Scope is the whole of apps/web — not just src/ — because configuration files
 * such as next.config.ts are exactly where a database variable would otherwise
 * slip in unnoticed. packages/contracts is scanned too: it is shared with the
 * browser tier, so it must stay as database-free as apps/web.
 *
 * Checks:
 *   1. apps/web declares no database dependency.
 *   2. No hand-written file under apps/web references a database package.
 *   3. No hand-written file under apps/web references DATABASE_URL.
 *   4. apps/web exposes no generic catch-all API route (no `[...slug]`).
 *   5. packages/contracts references no database package.
 *   6. packages/contracts declares only the dependencies it is allowed.
 *   7. No NEXT_PUBLIC_ variable under apps/web names a secret.
 *   8. apps/web does not block paste, copy or autofill.
 *   9. Password-policy internals stay behind the reviewed helper.
 *  10. No route handler mutates cookies on GET.
 *
 * Exits non-zero with a readable report on any violation.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const webRoot = join(repoRoot, 'apps', 'web');
const webApiRoutes = join(webRoot, 'src', 'app', 'api');
const webAppRoot = join(webRoot, 'src', 'app');
const apiRoot = join(repoRoot, 'apps', 'api');
const contractsRoot = join(repoRoot, 'packages', 'contracts');

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

function importPatternFor(packageName) {
  const escaped = packageName.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');
  // import ... from 'pkg' | require('pkg') | import('pkg'), including deep paths.
  return new RegExp(
    String.raw`(?:from\s*|require\s*\(\s*|import\s*\(\s*)['"]${escaped}(?:/[^'"]*)?['"]`,
  );
}

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

// --- 2, 3, 7, 8. per-file checks across apps/web -----------------------------
let scannedCount = 0;

/**
 * A NEXT_PUBLIC_ variable is inlined into the browser bundle by Next. One whose
 * name suggests a credential is a secret published to every visitor.
 */
const PUBLIC_SECRET_VARIABLE = /NEXT_PUBLIC_[A-Z0-9_]*(SECRET|KEY|TOKEN|PASSWORD)[A-Z0-9_]*/g;

/**
 * The approved password policy explicitly permits paste, autofill and password
 * managers — a 15-character minimum makes passphrases the intended shape, and
 * blocking paste pushes people towards shorter, memorable, weaker passwords.
 */
/**
 * Comments and tests are stripped before matching.
 *
 * A file that documents "we never use autocomplete=\"off\"" contains the
 * literal, and so does a test asserting its absence. Flagging either would make
 * the check punish the very things that explain and enforce the rule, and the
 * usual response to that is to weaken the rule.
 */
function withoutCommentsOrStrings(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const isTestFile = (name) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name);

const PASTE_BLOCKERS = [
  { pattern: /\bonPaste\s*=/, label: 'an onPaste handler' },
  { pattern: /\bonCopy\s*=/, label: 'an onCopy handler' },
  { pattern: /autocomplete\s*=\s*["']off["']/i, label: 'autocomplete="off"' },
  { pattern: /autoComplete\s*=\s*["']off["']/, label: 'autoComplete="off"' },
];

walk(webRoot, (file) => {
  if (!shouldScan(file)) return;
  scannedCount += 1;

  const text = readFileSync(file, 'utf8');
  const rel = toRepoPath(file);

  for (const name of FORBIDDEN_DB_PACKAGES) {
    if (importPatternFor(name).test(text)) {
      violations.push(`${rel} imports forbidden database package "${name}"`);
    }
  }

  if (text.includes('DATABASE_URL')) {
    violations.push(
      `${rel} references DATABASE_URL — the web application has no database access by design`,
    );
  }

  for (const match of text.matchAll(PUBLIC_SECRET_VARIABLE)) {
    violations.push(
      `${rel} references ${match[0]} — a NEXT_PUBLIC_ variable is inlined into the browser bundle and must never name a secret`,
    );
  }

  const executable = isTestFile(basename(file)) ? '' : withoutCommentsOrStrings(text);

  for (const { pattern, label } of PASTE_BLOCKERS) {
    if (pattern.test(executable)) {
      violations.push(
        `${rel} uses ${label} — the approved password policy permits paste, autofill and password managers`,
      );
    }
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

// --- 5, 6. packages/contracts stays logic-free and database-free -------------
//
// The package is consumed by the browser tier, so a database import here would
// route straight around the apps/web boundary.
walk(contractsRoot, (file) => {
  if (!shouldScan(file)) return;
  scannedCount += 1;

  const text = readFileSync(file, 'utf8');
  const rel = toRepoPath(file);

  for (const name of FORBIDDEN_DB_PACKAGES) {
    if (importPatternFor(name).test(text)) {
      violations.push(`${rel} imports forbidden database package "${name}"`);
    }
  }

  if (text.includes('DATABASE_URL')) {
    violations.push(`${rel} references DATABASE_URL — packages/contracts has no database access`);
  }
});

/**
 * "Logic-free" is only enforceable if the dependency list is. `zod` expresses
 * schemas; anything else would be behaviour, and behaviour shared between the
 * two applications belongs in whichever one owns the rule.
 */
const CONTRACTS_ALLOWED_RUNTIME_DEPS = new Set(['zod']);
const CONTRACTS_ALLOWED_DEV_DEPS = new Set(['typescript']);

const contractsPkgPath = join(contractsRoot, 'package.json');
if (existsSync(contractsPkgPath)) {
  const contractsPkg = JSON.parse(readFileSync(contractsPkgPath, 'utf8'));

  const runtimeDeps = {
    ...(contractsPkg.dependencies ?? {}),
    ...(contractsPkg.peerDependencies ?? {}),
  };
  for (const name of Object.keys(runtimeDeps)) {
    if (!CONTRACTS_ALLOWED_RUNTIME_DEPS.has(name)) {
      violations.push(
        `packages/contracts/package.json declares runtime dependency "${name}" — only ${[...CONTRACTS_ALLOWED_RUNTIME_DEPS].join(', ')} is permitted, so the package cannot acquire behaviour`,
      );
    }
  }

  for (const name of Object.keys(contractsPkg.devDependencies ?? {})) {
    if (!CONTRACTS_ALLOWED_DEV_DEPS.has(name)) {
      violations.push(
        `packages/contracts/package.json declares devDependency "${name}" — only ${[...CONTRACTS_ALLOWED_DEV_DEPS].join(', ')} is permitted`,
      );
    }
  }
}

// --- 9. password policy stays behind the reviewed helper ---------------------
//
// Deliberately NOT a ban on `.length`. A blanket rule would fire on hundreds of
// innocent call sites and reviewers would learn to ignore it. This targets the
// three identifiers that decide whether a password is acceptable, and confines
// them to their definition site and the module that implements the policy.
const PASSWORD_POLICY_IDENTIFIERS = [
  'PASSWORD_MIN_CODE_POINTS',
  'PASSWORD_MAX_CODE_POINTS',
  'countCodePoints',
];

const PASSWORD_POLICY_ALLOWED_PATHS = [
  // The single policy module named by the approved plan: the definition site.
  'apps/api/src/auth/auth-policy.ts',
  // The implementation and its tests.
  'apps/api/src/auth/password/',
];

for (const root of [webRoot, apiRoot, contractsRoot]) {
  walk(root, (file) => {
    if (!shouldScan(file)) return;

    const rel = toRepoPath(file);
    if (PASSWORD_POLICY_ALLOWED_PATHS.some((allowed) => rel.startsWith(allowed))) return;

    const text = readFileSync(file, 'utf8');
    for (const identifier of PASSWORD_POLICY_IDENTIFIERS) {
      if (new RegExp(String.raw`\b${identifier}\b`).test(text)) {
        violations.push(
          `${rel} references ${identifier} — password policy must go through validatePassword() in apps/api/src/auth/password/`,
        );
      }
    }
  });
}

// --- 10. no cookie mutation on GET ------------------------------------------
//
// SameSite=Lax deliberately sends cookies on a cross-site top-level GET
// navigation, so a GET that writes or clears an auth cookie is a forced-logout
// vector. Every cookie-mutating endpoint must be a POST gated by strict Origin.
//
// SCOPE NOTE, deliberate: this scans Route Handlers only. The pre-login CSRF
// cookie issued by apps/web/src/proxy.ts on a GET navigation is the sole
// reviewed exception to the GET-cookie rule — it is the only way to attach a
// cookie to the navigation that renders /login, it creates a token rather than
// clearing a session, and it is covered by its own tests. Do not "fix" this
// check by extending it to proxy.ts.
/**
 * Matching is deliberately loose rather than clever. In Next 16 `cookies()` is
 * async, so the idiomatic mutation is `(await cookies()).set(...)` — a pattern
 * anchored on `cookies().set` misses exactly the form real code uses. Instead:
 * a GET body that touches the cookie API at all AND performs any `.set(` or
 * `.delete(` call is treated as a mutation.
 *
 * Reading a cookie in a GET handler stays legal, which is what the two-part
 * condition preserves.
 */
const COOKIE_API = /\bcookies\b|\bSet-Cookie\b/i;
const MUTATION_CALL = /\.\s*(?:set|delete)\s*\(/;
const COOKIE_HELPER_MUTATION = /\b(?:setCookie|deleteCookie)\s*\(/;

function mutatesCookies(source) {
  if (COOKIE_HELPER_MUTATION.test(source)) return true;
  return COOKIE_API.test(source) && MUTATION_CALL.test(source);
}

const GET_EXPORT = /export\s+(?:async\s+)?(?:function\s+GET\b|const\s+GET\b)/;
const NEXT_TOP_LEVEL_EXPORT = /\nexport\s+(?:async\s+)?(?:function|const|class)\s/;

walk(webAppRoot, (file) => {
  const name = basename(file);
  if (name !== 'route.ts' && name !== 'route.tsx') return;

  const text = readFileSync(file, 'utf8');
  const rel = toRepoPath(file);

  const getMatch = GET_EXPORT.exec(text);
  if (getMatch === null) return;

  // A GET export is legitimate — session reset answers GET with 405 and an
  // `Allow: POST` header, which is more useful than a framework default. What
  // matters is that it mutates nothing, and the check below is what enforces
  // that. The 405 itself is pinned by a route-handler test.

  const body = text.slice(getMatch.index);
  const nextExport = NEXT_TOP_LEVEL_EXPORT.exec(body.slice(1));
  const getBody = nextExport === null ? body : body.slice(0, nextExport.index + 1);

  if (mutatesCookies(getBody)) {
    violations.push(
      `${rel} mutates a cookie inside its GET handler — cookie-mutating endpoints must be POST gated by strict Origin`,
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
console.log('  - packages/contracts is database-free and declares only permitted dependencies');
console.log('  - no NEXT_PUBLIC_ variable under apps/web names a secret');
console.log('  - apps/web blocks neither paste, copy nor autofill');
console.log('  - password policy stays behind validatePassword()');
console.log('  - no route handler mutates cookies on GET');
