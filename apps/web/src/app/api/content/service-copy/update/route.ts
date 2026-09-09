import { type NextRequest, type NextResponse } from 'next/server';
import { updateServicePublicCopyRequestSchema } from '@clinic/contracts';
import { z } from 'zod';
import { api } from '@/server/api-client';
import { servicePublicCopyForm } from '@/server/editorial-forms';
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
  const token = sessionTokenFrom(request);
  if (token === null) return secureRedirect(request, '/session-expired');
  try {
    guardStateChanging(request, body, { sessionToken: token });
  } catch (error) {
    const refusal = guardFailureResponse(error);
    if (refusal !== null) return refusal;
    throw error;
  }
  const id = z.uuid().safeParse(body['id']);
  const parsed = updateServicePublicCopyRequestSchema.safeParse(servicePublicCopyForm(body));
  const path: `/${string}` = `/content/services/${encodeURIComponent(body['id'] ?? '')}`;
  if (!id.success || !parsed.success) return failureRedirect(request, path, 'VALIDATION_FAILED');
  const result = await api.updateServicePublicCopy(id.data, parsed.data, { sessionToken: token });
  if (!result.ok) return failureRedirect(request, path, result.code);
  return secureRedirect(request, `${path}?success=draft-saved`);
}
