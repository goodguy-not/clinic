import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(__dirname);
const SRC = join(APP, '..');
const read = (...parts: string[]) => readFileSync(join(APP, ...parts), 'utf8');

describe('M9 B1 route ownership', () => {
  it('gives / to the public group and moves the protected landing to /dashboard', () => {
    expect(existsSync(join(APP, '(public)', 'page.tsx'))).toBe(true);
    expect(existsSync(join(APP, '(internal)', 'dashboard', 'page.tsx'))).toBe(true);
    expect(existsSync(join(APP, 'page.tsx'))).toBe(false);

    const dashboard = read('(internal)', 'dashboard', 'page.tsx');
    expect(dashboard).toContain('requirePermission: DASHBOARD_READ_PERMISSIONS');
    expect(readFileSync(join(SRC, 'components', 'app-header.tsx'), 'utf8')).toContain(
      "href: '/dashboard'",
    );
  });

  it('makes noindex structural for every internal page', () => {
    const layout = read('(internal)', 'layout.tsx');
    expect(layout).toContain('robots: { index: false, follow: false, nocache: true }');
  });
});

describe('M9 B1 public boundary and interaction policy', () => {
  it('keeps the home server-rendered and consumes the dedicated public reader', () => {
    const page = read('(public)', 'page.tsx');
    expect(page).not.toMatch(/^['"]use client['"]/m);
    expect(page).toContain('getPublicHomeData');
    expect(page).not.toContain('@/server/api-client');
  });

  it('uses one narrowly allow-listed island for mobile-menu close behavior', () => {
    const menu = readFileSync(join(SRC, 'components', 'public-mobile-menu.tsx'), 'utf8');
    expect(menu).toMatch(/^['"]use client['"]/);
    expect(menu).toContain("removeAttribute('open')");
    expect(menu).toContain('<details');
  });

  it('states a complete reduced-motion policy in the public style scope', () => {
    const css = read('globals.css');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation-duration: 0.01ms !important');
    expect(css).toContain('transition-duration: 0.01ms !important');
  });
});
