import { describe, expect, it } from 'vitest';
import { COPY } from './copy-fa';
import { temporaryPasswordResponse } from './temporary-password-page';

const PASSWORD = 'Xk4mTb9QrZ2wHn6PvY3s';

describe('temporary password result', () => {
  // A fresh response per test: reading `.text()` consumes the body, so a shared
  // one would leave later assertions inspecting an empty string.
  const build = () => temporaryPasswordResponse('synthetic.user', PASSWORD);

  it('is never cached or referred onward', () => {
    const response = build();

    // A cached copy of this body is a stored credential.
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('returns the value in the body, never in a URL', async () => {
    const response = build();
    const html = await response.text();

    expect(html).toContain(PASSWORD);
    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBe(200);
  });

  it('sets no cookie, so nothing is persisted', () => {
    expect(build().cookies.getAll()).toEqual([]);
  });

  it('asks search engines not to index it', async () => {
    expect(await build().text()).toContain('noindex');
  });

  it('renders right-to-left Persian with the approved notice', async () => {
    const html = await build().text();

    expect(html).toContain('lang="fa"');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain(COPY.temporaryPasswordTitle);
    expect(html).toContain(COPY.temporaryPasswordNotice);
  });

  it('escapes the username rather than trusting the submitted value', async () => {
    const html = await temporaryPasswordResponse('<script>alert(1)</script>', PASSWORD).text();

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes the password too, in case the alphabet ever changes', async () => {
    const html = await temporaryPasswordResponse('user', '<b>&"').text();

    expect(html).toContain('&lt;b&gt;&amp;&quot;');
  });
});
