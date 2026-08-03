import { NextResponse } from 'next/server';
import { fetchApiLiveness } from '@/server/api-client';

export const dynamic = 'force-dynamic';

/**
 * Web health, including reachability of the NestJS API.
 *
 * This is a specific, hand-written route — not a generic proxy. A catch-all
 * BFF route is forbidden (CLAUDE.md, Architecture boundary) and is checked
 * mechanically by scripts/check-web-boundary.mjs.
 */
export async function GET() {
  const api = await fetchApiLiveness();

  return NextResponse.json(
    {
      status: api.ok ? 'ok' : 'degraded',
      service: 'web',
      api: api.ok ? 'reachable' : api.reason,
      timestamp: new Date().toISOString(),
    },
    { status: api.ok ? 200 : 503 },
  );
}
