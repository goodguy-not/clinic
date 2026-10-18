import { NextResponse } from 'next/server';
import { fetchApiReadiness } from '@/server/api-client';

export const dynamic = 'force-dynamic';

/**
 * Web health, including reachability of the NestJS API.
 *
 * This is a specific, hand-written route — not a generic proxy. A catch-all
 * BFF route is forbidden (CLAUDE.md, Architecture boundary) and is checked
 * mechanically by scripts/check-web-boundary.mjs.
 */
export async function GET() {
  const ready = await fetchApiReadiness();

  return NextResponse.json(
    {
      status: ready ? 'ok' : 'unavailable',
    },
    { status: ready ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
