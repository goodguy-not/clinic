import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

/**
 * Closes the Web privacy-header verification `next.config.ts` left deferred.
 *
 * `next.config.ts` already declared `no-store`/`no-referrer` headers for
 * `/families`, `/families/:path*` and `/children/:path*` back in Checkpoint F,
 * ahead of the pages that would need them — its own comment says so. This is
 * the verification that could not run until those pages existed: that the
 * declared header rules are actually present, and that every family and child
 * page mechanically carries `noindex` and `force-dynamic`, the same two
 * properties every other internal page in this application carries
 * (CLAUDE.md; 2026-08-04 decision log entry on internal-surface conventions).
 */

describe('next.config.ts headers for personal clinic pages', () => {
  it('declares no-store and same-origin referrers for every personal-data path', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const bySource = new Map(rules.map((rule) => [rule.source, rule.headers]));

    for (const source of [
      '/families',
      '/families/:path*',
      '/children/:path*',
      '/appointments',
      '/appointments/:path*',
    ]) {
      const headers = bySource.get(source);
      expect(headers).toBeDefined();
      expect(headers).toContainEqual({ key: 'Cache-Control', value: 'no-store' });
      // Not `no-referrer`: see next.config.ts for why that value silently
      // strips the `Origin` header from every same-origin form on these pages
      // too, per the Fetch standard, and breaks the strict-Origin CSRF guard.
      expect(headers).toContainEqual({ key: 'Referrer-Policy', value: 'same-origin' });
    }
  });
});

const APP_ROOT = join(__dirname, 'app');

function collectPageFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);

    if (statSync(full).isDirectory()) collectPageFiles(full, found);
    else if (entry === 'page.tsx') found.push(full);
  }

  return found;
}

const familyAndChildPages = collectPageFiles(APP_ROOT)
  .map((path) => path.replace(/\\/g, '/'))
  .filter((path) => /\/app\/(families|children)\//.test(path));

const appointmentPages = collectPageFiles(APP_ROOT)
  .map((path) => path.replace(/\\/g, '/'))
  .filter((path) => /\/app\/appointments\//.test(path));

describe('every family and child page', () => {
  it('finds the pages it is meant to be checking', () => {
    // Guards this file against silently passing because it enumerated nothing.
    expect(familyAndChildPages.length).toBe(7);
  });

  it.each(familyAndChildPages.map((path) => [path, readFileSync(path, 'utf8')] as const))(
    '%s is noindex and force-dynamic',
    (_path, source) => {
      expect(source).toContain("dynamic = 'force-dynamic'");
      expect(source).toMatch(/robots:\s*{\s*index:\s*false,\s*follow:\s*false\s*}/);
    },
  );
});

describe('every appointment page', () => {
  it('finds the B2 pages it is meant to be checking', () => {
    expect(appointmentPages.length).toBe(3);
  });

  it.each(appointmentPages.map((path) => [path, readFileSync(path, 'utf8')] as const))(
    '%s is noindex and force-dynamic',
    (_path, source) => {
      expect(source).toContain("dynamic = 'force-dynamic'");
      expect(source).toMatch(/robots:\s*{\s*index:\s*false,\s*follow:\s*false\s*}/);
    },
  );
});
