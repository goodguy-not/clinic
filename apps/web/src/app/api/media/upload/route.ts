import { type NextRequest, type NextResponse } from 'next/server';
import { mediaUploadFieldsSchema } from '@clinic/contracts';
import { z } from 'zod';
import { api } from '@/server/api-client';
import { persianMessage } from '@/server/errors-fa';
import {
  guardFailureResponse,
  guardStateChanging,
  sessionTokenFrom,
  type SubmittedBody,
} from '@/server/handler-support';
import { secureJson, secureRedirect } from '@/server/security-headers';
import { uploadOnce } from '@/media/upload-once';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const form = await request.formData().catch(() => null);
  const body: SubmittedBody = {};
  if (form !== null) {
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') body[key] = value;
    }
  }

  const sessionToken = sessionTokenFrom(request);
  if (sessionToken === null) return secureRedirect(request, '/session-expired');
  try {
    guardStateChanging(request, body, { sessionToken });
  } catch (error) {
    const refusal = guardFailureResponse(error);
    if (refusal !== null) return refusal;
    throw error;
  }

  const fields = mediaUploadFieldsSchema.safeParse({ altText: body['altText'] });
  const attempt = z.uuid().safeParse(body['attemptId']);
  const file = form?.get('file');
  if (!fields.success || !attempt.success || !(file instanceof Blob) || file.size === 0) {
    return secureJson(
      { error: { code: 'VALIDATION_FAILED', message: persianMessage('VALIDATION_FAILED') } },
      400,
    );
  }

  const result = await uploadOnce(sessionToken, attempt.data, () =>
    api.uploadMedia(file, fields.data.altText, { sessionToken }),
  );
  if (!result.ok) {
    return secureJson(
      { error: { code: result.code, message: persianMessage(result.code) } },
      result.status,
    );
  }
  return secureJson(result.data, 201);
}
