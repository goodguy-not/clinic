import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(__dirname);
const PUBLIC = join(APP, '(public)');

const routeFiles = [
  ['services', 'page.tsx'],
  ['services', '[slug]', 'page.tsx'],
  ['team', 'page.tsx'],
  ['team', '[slug]', 'page.tsx'],
  ['about', 'page.tsx'],
  ['testimonials', 'page.tsx'],
  ['articles', 'page.tsx'],
  ['articles', '[slug]', 'page.tsx'],
  ['contact', 'page.tsx'],
  ['privacy', 'page.tsx'],
] as const;

describe('M9 B2 public content routes', () => {
  it('owns the complete B2 route set as server-rendered public pages', () => {
    for (const parts of routeFiles) {
      const path = join(PUBLIC, ...parts);
      expect(existsSync(path), path).toBe(true);
      expect(readFileSync(path, 'utf8')).not.toMatch(/^['"]use client['"]/m);
    }
  });

  it('uses only the dedicated public reader and never the authenticated client', () => {
    for (const parts of routeFiles) {
      const source = readFileSync(join(PUBLIC, ...parts), 'utf8');
      expect(source).not.toContain('@/server/api-client');
      expect(source).not.toContain('prisma');
      expect(source).not.toContain('dangerouslySetInnerHTML');
    }
  });

  it('keeps unsupported prototype relationships and final legal copy out of Web', () => {
    const profile = readFileSync(join(PUBLIC, 'team', '[slug]', 'page.tsx'), 'utf8');
    const articles = readFileSync(join(PUBLIC, 'articles', 'page.tsx'), 'utf8');
    const privacy = readFileSync(join(PUBLIC, 'privacy', 'page.tsx'), 'utf8');

    expect(profile).not.toContain('روش کار');
    expect(profile).not.toContain('سابقه و آموزش');
    expect(profile).not.toContain('حوزه‌های کاری');
    expect(articles).not.toContain('author');
    expect(articles).not.toContain('topic');
    expect(privacy).toContain('متن نهایی هنوز منتشر نشده است');
  });
});
