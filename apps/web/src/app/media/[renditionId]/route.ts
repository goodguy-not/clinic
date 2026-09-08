import { NextRequest, NextResponse } from 'next/server';
import {
  PUBLIC_MEDIA_CACHE_TAG_PREFIX,
  PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS,
} from '@clinic/contracts';
import { z } from 'zod';
import { loadServerEnv } from '@/env';

const PASSTHROUGH_HEADERS = [
  'content-type',
  'content-length',
  'etag',
  'cache-control',
  'x-content-type-options',
  'content-disposition',
] as const;

function notFound(): NextResponse {
  return NextResponse.json(
    { error: { code: 'MEDIA_NOT_FOUND', message: 'این عکس پیدا نشد.' } },
    { status: 404, headers: { 'cache-control': 'no-store' } },
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ renditionId: string }> },
): Promise<NextResponse> {
  const parsed = z.uuid().safeParse((await params).renditionId);
  if (!parsed.success) return notFound();

  const { API_BASE_URL, INTERNAL_API_KEY } = loadServerEnv();
  const headers = new Headers({ 'x-internal-key': INTERNAL_API_KEY });
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch !== null) headers.set('if-none-match', ifNoneMatch);

  try {
    const upstream = await fetch(
      `${API_BASE_URL}/public/media/${encodeURIComponent(parsed.data)}`,
      {
        method: 'GET',
        headers,
        cache: 'force-cache',
        next: {
          revalidate: PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS,
          tags: [`${PUBLIC_MEDIA_CACHE_TAG_PREFIX}${parsed.data}`],
        },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (upstream.status !== 200 && upstream.status !== 304) return notFound();

    const responseHeaders = new Headers();
    for (const name of PASSTHROUGH_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) responseHeaders.set(name, value);
    }
    // A5 pins this maximum. Never allow an intermediary default to lengthen it.
    responseHeaders.set(
      'cache-control',
      `public, max-age=${PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS}, s-maxage=${PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS}, must-revalidate`,
    );

    if (upstream.status === 304) {
      return new NextResponse(null, { status: 304, headers: responseHeaders });
    }
    return new NextResponse(await upstream.arrayBuffer(), {
      status: 200,
      headers: responseHeaders,
    });
  } catch {
    return notFound();
  }
}
