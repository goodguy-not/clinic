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
  it('uses the approved Vala identity and exact production artwork', () => {
    const page = read('(public)', 'page.tsx');
    const chrome = readFileSync(join(SRC, 'components', 'public-chrome.tsx'), 'utf8');

    expect(page).toContain("title: 'کلینیک توانبخشی والا'");
    expect(page).toContain('کلینیک توانبخشی والا');
    expect(page).not.toContain('clinic.displayName');
    expect(chrome).toContain('/brand/vala-logo-horizontal.svg');
    expect(chrome).toContain('/brand/vala-logo-horizontal-white.svg');
    expect(chrome).toContain('/brand/vala-icon.svg');
    expect(chrome).not.toContain('public-brand__mark');
    expect(existsSync(join(SRC, '..', 'public', 'brand', 'vala-logo-horizontal.svg'))).toBe(true);
    expect(existsSync(join(APP, 'favicon.ico'))).toBe(true);
    expect(existsSync(join(APP, 'apple-icon.png'))).toBe(true);
    expect(existsSync(join(APP, 'icon.png'))).toBe(true);
  });

  it('keeps the home server-rendered and consumes the dedicated public reader', () => {
    const page = read('(public)', 'page.tsx');
    expect(page).not.toMatch(/^['"]use client['"]/m);
    expect(page).toContain('getPublicHomeData');
    expect(page).not.toContain('@/server/api-client');
  });

  it('keeps public interaction in narrow, server-independent islands', () => {
    const menu = readFileSync(join(SRC, 'components', 'public-mobile-menu.tsx'), 'utf8');
    const concerns = readFileSync(join(SRC, 'components', 'public-concern-guide.tsx'), 'utf8');
    const services = readFileSync(join(SRC, 'components', 'public-service-explorer.tsx'), 'utf8');
    const team = readFileSync(join(SRC, 'components', 'public-team-track.tsx'), 'utf8');
    expect(menu).toMatch(/^['"]use client['"]/);
    expect(menu).toContain("removeAttribute('open')");
    expect(menu).toContain('<details');
    expect(concerns).toMatch(/^['"]use client['"]/);
    expect(concerns).toContain('از کجا شروع کنیم؟');
    expect(concerns).toContain('loading="eager"');
    expect(concerns).not.toContain('priority');
    expect(services).toMatch(/^['"]use client['"]/);
    expect(services).toContain('useState(0)');
    expect(services).not.toContain('@/server/');
    expect(team).toMatch(/^['"]use client['"]/);
    expect(team).toContain('scrollBy');
    expect(team).toContain('inlineDelta');
    expect(team).toContain('مشاهدهٔ درمانگران بعدی');
    expect(team).toContain('مشاهدهٔ درمانگران قبلی');
    expect(team).toMatch(
      /aria-label="مشاهدهٔ درمانگران بعدی"[\s\S]*?>←<[\s\S]*?aria-label="مشاهدهٔ درمانگران قبلی"[\s\S]*?>→</,
    );
    expect(team).not.toContain('@/server/');
  });

  it('keeps staff login out of public chrome and centers the future request flow', () => {
    const chrome = readFileSync(join(SRC, 'components', 'public-chrome.tsx'), 'utf8');
    const page = read('(public)', 'page.tsx');

    expect(chrome).not.toContain('href="/login"');
    expect(chrome).not.toContain('ورود کارکنان');
    expect(chrome).toContain("const contactHref = '/contact#request'");
    expect(chrome).toContain("const contactLabel = 'درخواست ارزیابی'");
    expect(chrome).not.toContain('درخواست پیگیری');
    expect(page).toContain('id="request"');
    expect(page).toContain('فرم درخواست در مرحلهٔ بعد فعال می‌شود');
  });

  it('implements the corrected horizontal team track without autoplay', () => {
    const page = read('(public)', 'page.tsx');
    const team = readFileSync(join(SRC, 'components', 'public-team-track.tsx'), 'utf8');
    const spaces = readFileSync(join(SRC, 'components', 'public-space-teaser.tsx'), 'utf8');

    expect(page).toContain('<PublicTeamTrack therapists={read.data} />');
    expect(page).not.toContain('.slice(0, 4)');
    expect(team).toContain('همهٔ تیم درمان');
    expect(team).toContain('دیدن پروفایل');
    expect(team).toContain('href={`/team/${person.slug}`}');
    expect(team).toContain('href="/team"');
    expect(team).not.toContain('setInterval');
    expect(team).not.toContain('setTimeout');
    expect(spaces).toContain('مشاهدهٔ فضای بعدی');
    expect(spaces).toContain('مشاهدهٔ فضای قبلی');
    expect(spaces).toMatch(
      /aria-label="مشاهدهٔ فضای بعدی"[\s\S]*?>←<[\s\S]*?aria-label="مشاهدهٔ فضای قبلی"[\s\S]*?>→</,
    );
    expect(spaces).toContain("'(hover: hover) and (pointer: fine)'");
    expect(spaces).toContain('onPointerEnter');
    expect(spaces).toContain('onPointerLeave');
    expect(spaces).toContain('HOVER_INTENT_MS');
    expect(spaces).toContain('public-space-browser__controls-bar');
    expect(spaces).toContain('/dev/vala-synthetic/05-corridor.jpg');
    expect(spaces).toContain('href="/about#spaces"');
    expect(spaces).not.toContain('priority={index === 0}');
    expect(page).toMatch(
      /src="\/dev\/vala-synthetic\/12-therapist-child-interaction\.jpg"[\s\S]*?loading="eager"/,
    );
    expect(read('(public)', 'public.css')).toMatch(
      /\.public-team-track__controls\s*{[^}]*direction:\s*ltr/,
    );
  });

  it('states a complete reduced-motion policy in the public style scope', () => {
    const css = read('(public)', 'public.css');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation-duration: 0.01ms !important');
    expect(css).toContain('transition-duration: 0.01ms !important');
  });
});
