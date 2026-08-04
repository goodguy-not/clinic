import 'server-only';
import { NextResponse } from 'next/server';
import { COPY } from './copy-fa';
import { applySecurityHeaders } from './security-headers';

/**
 * The one-time temporary-password result.
 *
 * Returned as the body of the POST rather than by redirecting, deliberately.
 * A redirect would have to carry the password somewhere — a query parameter
 * puts it in browser history, server logs and any analytics on the page, and a
 * flash cookie puts it in the cookie jar. A POST response body is in none of
 * those: it is not bookmarkable, not in history as a URL, and gone on
 * navigation.
 *
 * `no-store` is set for the same reason, so no intermediary retains it.
 *
 * The markup is a small self-contained document rather than the application
 * shell, because a Route Handler response does not pass through `layout.tsx`.
 * It is deliberately plain: this surface has no design system in Milestone 1.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function temporaryPasswordResponse(username: string, password: string): NextResponse {
  const document = `<!doctype html>
<html lang="fa" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${escapeHtml(COPY.temporaryPasswordTitle)}</title>
    <style>
      body { font-family: system-ui, 'Segoe UI', Tahoma, sans-serif; line-height: 1.7; padding: 2rem; }
      main { max-width: 34rem; margin-inline: auto; }
      code { font-family: ui-monospace, monospace; font-size: 1.25rem; letter-spacing: 0.08em;
             display: block; padding: 0.75rem 1rem; border: 1px solid currentColor;
             border-radius: 0.5rem; margin-block: 1rem; direction: ltr; text-align: center; }
      .notice { font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(COPY.temporaryPasswordTitle)}</h1>
      <p>${escapeHtml(COPY.username)}: <strong>${escapeHtml(username)}</strong></p>
      <code>${escapeHtml(password)}</code>
      <p class="notice">${escapeHtml(COPY.temporaryPasswordNotice)}</p>
      <p><a href="/staff">${escapeHtml(COPY.staffTitle)}</a></p>
    </main>
  </body>
</html>`;

  return applySecurityHeaders(
    new NextResponse(document, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  );
}
