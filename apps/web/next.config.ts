import type { NextConfig } from 'next';
import { loadServerEnv } from './src/env';

// The repository-root `.env` is deliberately NOT loaded here. It belongs to the
// API and carries the database connection string; loading it would put that
// string into this process even though nothing here may use it
// (CLAUDE.md, Architecture boundary).
//
// Next.js auto-loads `apps/web/.env.local`, which carries only the variables the
// web application actually needs. See `.env.local.example`.

// Fail fast. This runs when the config is loaded — during `next build`,
// `next dev` and `next start` — so a missing or malformed variable stops the
// build or the server before it can ever serve a request.
loadServerEnv();

/**
 * Every response that can carry family or child data, and every Server Action
 * POST to one of those paths.
 *
 * `dynamic = 'force-dynamic'` is not a substitute. It governs whether Next
 * re-renders the page, which is a different question from whether a browser, a
 * corporate proxy or a reverse proxy is allowed to keep a copy of the bytes. A
 * cached family page on a shared reception machine is readable by whoever sits
 * down next.
 *
 * `no-referrer` for the same reason it is set on every handler response: the
 * current path must not travel outward. There is nothing personal in these
 * paths beyond a record id, and there is no reason to send even that.
 *
 * The NestJS side is already covered — `NoStoreInterceptor` is a global
 * interceptor exempting only `/health` — and Route Handlers are covered by
 * `applySecurityHeaders`. This closes the page and Server Action surface, which
 * neither of those touches.
 */
const noStoreHeaders = [
  { key: 'Cache-Control', value: 'no-store' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // `experimental.serverActions.allowedOrigins` is deliberately NOT set. It
  // exists to let extra origins *bypass* the built-in Server Action CSRF check,
  // which by default requires the request's `Origin` to match its `Host`. There
  // is no reverse proxy to accommodate, so adding entries could only widen the
  // check. The actions apply their own strict allow-list on top of it.

  async headers() {
    return [
      { source: '/families', headers: noStoreHeaders },
      { source: '/families/:path*', headers: noStoreHeaders },
      { source: '/children/:path*', headers: noStoreHeaders },
    ];
  },
};

export default nextConfig;
