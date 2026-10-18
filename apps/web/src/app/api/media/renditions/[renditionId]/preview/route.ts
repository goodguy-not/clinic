import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { MEDIA_PREVIEW_CACHE_CONTROL } from '@clinic/contracts';
import { z } from 'zod';
import { loadServerEnv } from '@/env';
import { sessionTokenFrom } from '@/server/handler-support';

export const runtime = 'nodejs';

const PASSTHROUGH_HEADERS = [
  'content-type',
  'content-length',
  'x-content-type-options',
  'content-disposition',
] as const;

function refusal(status: 401 | 404): NextResponse {
  return NextResponse.json(
    { error: { code: status === 401 ? 'AUTH_UNAUTHENTICATED' : 'MEDIA_NOT_FOUND' } },
    {
      status,
      headers: {
        'cache-control': MEDIA_PREVIEW_CACHE_CONTROL,
        'referrer-policy': 'no-referrer',
      },
    },
  );
}

/**
 * Same-origin staff transport for A5's persisted-rendition preview.
 *
 * The signed cookie contributes only the opaque session token. NestJS resolves
 * that session and enforces both `media.read` and the attachment owner's read
 * permission on every request. This handler never tries the public media path:
 * a refused draft preview stays refused.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ renditionId: string }> },
): Promise<NextResponse> {
  const sessionToken = sessionTokenFrom(request);
  if (sessionToken === null) return refusal(401);

  const parsed = z.uuid().safeParse((await params).renditionId);
  if (!parsed.success) return refusal(404);

  const { API_BASE_URL, INTERNAL_API_KEY } = loadServerEnv();
  const headers = new Headers({
    accept: 'image/*',
    'x-internal-key': INTERNAL_API_KEY,
    'x-request-id': randomUUID(),
    'x-session-id': sessionToken,
  });

  try {
    const upstream = await fetch(
      `${API_BASE_URL}/media/renditions/${encodeURIComponent(parsed.data)}/preview`,
      {
        method: 'GET',
        headers,
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
      },
    );

    if (!upstream.ok) return refusal(upstream.status === 401 ? 401 : 404);

    const responseHeaders = new Headers({
      'cache-control': MEDIA_PREVIEW_CACHE_CONTROL,
      'referrer-policy': 'no-referrer',
    });
    for (const name of PASSTHROUGH_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) responseHeaders.set(name, value);
    }

    // Deliberately no ETag: neither shared nor browser caches may retain a
    // draft photograph after the staff session or its permissions disappear.
    return new NextResponse(await upstream.arrayBuffer(), {
      status: 200,
      headers: responseHeaders,
    });
  } catch {
    return refusal(404);
  }
}
