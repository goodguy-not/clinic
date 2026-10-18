import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(__dirname);
const SRC = join(APP, '..');
const request = (...parts: string[]) =>
  readFileSync(join(APP, '(public)', 'request', ...parts), 'utf8');

describe('M9 B3 public evaluation request flow', () => {
  it('owns both public routes and keeps the page server-rendered', () => {
    expect(existsSync(join(APP, '(public)', 'request', 'page.tsx'))).toBe(true);
    expect(existsSync(join(APP, '(public)', 'request', 'received', 'page.tsx'))).toBe(true);
    expect(request('page.tsx')).not.toMatch(/^['"]use client['"]/m);
    expect(request('received', 'page.tsx')).not.toMatch(/^['"]use client['"]/m);
  });

  it('uses the A3 action boundary, strict Origin check, and neutral success redirect', () => {
    const action = request('action.ts');
    expect(action).toContain('assertOriginAllowed');
    expect(action).toContain('parsePublicRequestForm');
    expect(action).toContain('submitPublicRequest');
    expect(action).toContain("redirect('/request/received')");
    expect(action).not.toContain('requireSession');
    expect(action).not.toContain('prisma');
  });

  it('starts gender empty and implements labelled, keyboard-native selection trays', () => {
    const form = request('request-form.tsx');
    expect(form).toContain("const [sex, setSex] = useState<Sex>('')");
    expect(form).toContain('<dialog');
    expect(form).toContain('<fieldset');
    expect(form).toContain('type="radio"');
    expect(form).toContain("'UNSPECIFIED'");
    expect(form).toContain('onClose={trayClosed}');
    expect(form).toContain('onCancel={(event) =>');
    expect(form).toContain("event.key === 'Escape'");
    expect(form).toContain('dialog.showModal()');
    expect(form).not.toContain('cycle');
  });

  it('keeps every optional input visible and contact time on its closed vocabulary', () => {
    const form = request('request-form.tsx');
    expect(form).toContain('<textarea');
    expect(form).toContain('نام فرزند (اختیاری)');
    for (const option of ['MORNING', 'AFTERNOON', 'EVENING', 'NO_PREFERENCE']) {
      expect(form).toContain(option);
    }
    expect(form).not.toContain('<details');
    expect(form).not.toContain('دنبال چه خدمتی هستید');
  });

  it('uses the approved consent wording without a prechecked checkbox', () => {
    const form = request('request-form.tsx');
    expect(form).toContain("clinicName ?? 'کلینیک'");
    expect(form).toContain('برای هماهنگی ارزیابی با من تماس بگیرد');
    expect(form).toContain('defaultChecked={state.values.consent');
    expect(form).not.toContain('defaultChecked={true}');
  });

  it('states the truthful three-step success and no response-time promise', () => {
    const received = request('received', 'page.tsx');
    expect(received).toContain('درخواست شما ثبت شد');
    expect(received).toContain('اطلاعات ثبت شده است');
    expect(received).toContain("تیم {clinic.displayName ?? 'کلینیک'} آن را مرور می‌کند");
    expect(received).toContain('کلینیک برای هماهنگی قدم بعدی تماس می‌گیرد');
    expect(received).not.toMatch(/ساعت|امروز|روز کاری|به‌زودی|تضمین/);
    expect(received).not.toContain('duplicate');
  });

  it('activates generic and service-context CTAs without a public staff link', () => {
    const chrome = readFileSync(join(SRC, 'components', 'public-chrome.tsx'), 'utf8');
    const content = readFileSync(join(SRC, 'components', 'public-content.tsx'), 'utf8');
    const services = readFileSync(join(SRC, 'components', 'public-service-explorer.tsx'), 'utf8');
    expect(chrome).toContain("const contactHref = '/request'");
    expect(content).toContain('/request?service=');
    expect(services).toContain('/request?service=');
    expect(chrome).not.toContain('/login');
  });
});
