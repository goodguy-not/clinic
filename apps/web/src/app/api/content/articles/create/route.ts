import { type NextRequest, type NextResponse } from 'next/server';
import { createArticleRequestSchema } from '@clinic/contracts';
import { api } from '@/server/api-client';
import { articleFormToRequest } from '@/server/content-forms';
import {
  failureRedirect,
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { secureRedirect } from '@/server/security-headers';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await readBody(request);
  const sessionToken = sessionTokenFrom(request);
  if (sessionToken === null) return secureRedirect(request, '/session-expired');

  try {
    guardStateChanging(request, body, { sessionToken });
  } catch (error) {
    const refusal = guardFailureResponse(error);
    if (refusal !== null) return refusal;
    throw error;
  }

  const parsed = createArticleRequestSchema.safeParse(articleFormToRequest(body));
  if (!parsed.success)
    return failureRedirect(request, '/content/articles/new', 'VALIDATION_FAILED');

  const result = await api.createArticle(parsed.data, { sessionToken });
  if (!result.ok) return failureRedirect(request, '/content/articles/new', result.code);

  return secureRedirect(request, `/content/articles/${result.data.article.id}/edit`);
}
