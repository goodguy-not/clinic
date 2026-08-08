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
 * Its inline styles mirror the app shell's look (canvas, card, brand teal) so
 * the page reads as the same product without depending on the Tailwind build.
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
      body { font-family: 'Vazirmatn', system-ui, 'Segoe UI', Tahoma, sans-serif; line-height: 1.8;
             margin: 0; padding: 2.5rem 1rem; background: #f8fafc; color: #1e293b; }
      @font-face { font-family: 'Vazirmatn'; src: url('/fonts/Vazirmatn-var.woff2') format('woff2');
                   font-weight: 100 900; font-display: swap; }
      main { max-width: 30rem; margin-inline: auto; background: #fff; border: 1px solid #e2e8f0;
             border-radius: 0.75rem; padding: 1.5rem 2rem; box-shadow: 0 1px 2px rgb(15 23 42 / 0.05); }
      h1 { font-size: 1.25rem; margin-block: 0 0.75rem; color: #0f172a; }
      code { font-family: ui-monospace, monospace; font-size: 1.25rem; letter-spacing: 0.08em;
             display: block; padding: 0.75rem 1rem; border: 1px solid #99f6e4; background: #f0fdfa;
             border-radius: 0.5rem; margin-block: 1rem; direction: ltr; text-align: center; }
      .notice { font-weight: 600; color: #0f766e; }
      .back { display: inline-block; margin-block-start: 0.5rem; padding: 0.5rem 1rem;
              border: 1px solid #cbd5e1; border-radius: 0.5rem; color: #1e293b;
              text-decoration: none; font-weight: 600; font-size: 0.875rem; }
      .back:hover { background: #f1f5f9; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(COPY.temporaryPasswordTitle)}</h1>
      <p>${escapeHtml(COPY.username)}: <strong>${escapeHtml(username)}</strong></p>
      <code>${escapeHtml(password)}</code>
      <p class="notice">${escapeHtml(COPY.temporaryPasswordNotice)}</p>
      <p><a class="back" href="/staff">${escapeHtml(COPY.staffTitle)}</a></p>
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
