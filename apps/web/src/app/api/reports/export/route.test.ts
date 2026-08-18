import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cookieConfigFor } from '@/server/cookie-config';
import { issueCsrfToken } from '@/server/csrf';
import { signSessionCookie } from '@/server/session-cookie';

const mocks = vi.hoisted(() => ({ session: vi.fn(), exportReportCsv: vi.fn() }));
vi.mock('@/server/api-client', () => ({ api: mocks }));

import { POST } from './route';

const ORIGIN = 'http://localhost:3000';
const SECRET = process.env['SESSION_COOKIE_SECRET'] as string;
const SESSION_TOKEN = 'synthetic-export-session-token';
const COOKIES = cookieConfigFor('non-production');

function request(kind: string, filters: object): NextRequest {
  const csrfToken = issueCsrfToken(SECRET, { sessionToken: SESSION_TOKEN }, 1800);
  const cookie = [
    `${COOKIES.session.name}=${signSessionCookie(SECRET, SESSION_TOKEN)}`,
    `${COOKIES.csrf.name}=${csrfToken}`,
  ].join('; ');
  return new NextRequest(`${ORIGIN}/api/reports/export`, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      cookie,
      'content-type': 'application/json',
      'user-agent': 'export-test',
      'x-forwarded-for': '192.0.2.4, 192.0.2.5',
    },
    body: JSON.stringify({ csrfToken, kind, filters: JSON.stringify(filters) }),
  });
}

describe('report CSV BFF', () => {
  beforeEach(() => {
    mocks.session.mockReset().mockResolvedValue({
      ok: true,
      data: { user: { permissions: ['report.export'] } },
    });
    mocks.exportReportCsv.mockReset().mockResolvedValue({
      ok: true,
      response: new Response('\uFEFFستون\r\nمقدار\r\n', {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': "attachment; filename*=UTF-8''sessions.csv",
        },
      }),
    });
  });

  it('re-authorises export and forwards the exact validated scope without paging', async () => {
    const response = await POST(
      request('sessions', {
        from: '2026-08-01',
        to: '2026-08-18',
        status: 'COMPLETED',
        page: 7,
        pageSize: 25,
      }),
    );

    expect(response.status).toBe(200);
    const context = {
      sessionToken: SESSION_TOKEN,
      clientIp: '192.0.2.4',
      userAgent: 'export-test',
    };
    expect(mocks.session).toHaveBeenCalledWith(context);
    expect(mocks.exportReportCsv).toHaveBeenCalledWith(
      'sessions',
      { from: '2026-08-01', to: '2026-08-18', status: 'COMPLETED' },
      context,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new TextEncoder().encode('\uFEFFستون\r\nمقدار\r\n'),
    );
    expect(response.headers.get('content-disposition')).toContain('sessions.csv');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses a receptionist even if the hidden control is called directly', async () => {
    mocks.session.mockResolvedValue({
      ok: true,
      data: { user: { permissions: ['appointment.read', 'promise.read'] } },
    });
    const response = await POST(request('promises', { from: '2026-08-01', to: '2026-08-18' }));

    expect(response.status).toBe(403);
    expect(mocks.exportReportCsv).not.toHaveBeenCalled();
  });

  it('rejects unknown filters instead of silently altering the export', async () => {
    const response = await POST(
      request('family-accounts', { standing: 'OWING', personalName: 'نباید پذیرفته شود' }),
    );

    expect(response.status).toBe(400);
    expect(mocks.exportReportCsv).not.toHaveBeenCalled();
  });

  it('accepts the current screen boolean vocabulary without changing it', async () => {
    const response = await POST(
      request('family-accounts', { standing: 'OWING', includeInactive: 'true' }),
    );

    expect(response.status).toBe(200);
    expect(mocks.exportReportCsv).toHaveBeenCalledWith(
      'family-accounts',
      { standing: 'OWING', includeInactive: true },
      expect.any(Object),
    );
  });
});
