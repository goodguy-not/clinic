import { type NextRequest, type NextResponse } from 'next/server';
import { updateMediaFramingRequestSchema } from '@clinic/contracts';
import { z } from 'zod';
import { api } from '@/server/api-client';
import { persianMessage } from '@/server/errors-fa';
import {
  guardFailureResponse,
  guardStateChanging,
  readBody,
  sessionTokenFrom,
} from '@/server/handler-support';
import { secureJson, secureRedirect } from '@/server/security-headers';

export const runtime = 'nodejs';

const numberFrom = (value: string | undefined): number | undefined =>
  value === undefined || value === '' ? undefined : Number(value);

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

  const attachmentId = z.uuid().safeParse(body['attachmentId']);
  const hasCrop = body['cropX'] !== undefined && body['cropX'] !== '';
  const framing = updateMediaFramingRequestSchema.safeParse({
    focalX: numberFrom(body['focalX']),
    focalY: numberFrom(body['focalY']),
    crop: hasCrop
      ? {
          x: numberFrom(body['cropX']),
          y: numberFrom(body['cropY']),
          width: numberFrom(body['cropWidth']),
          height: numberFrom(body['cropHeight']),
        }
      : null,
  });
  if (!attachmentId.success || !framing.success) {
    return secureJson(
      { error: { code: 'VALIDATION_FAILED', message: persianMessage('VALIDATION_FAILED') } },
      400,
    );
  }

  const result = await api.updateMediaFraming(attachmentId.data, framing.data, { sessionToken });
  if (!result.ok) {
    return secureJson(
      { error: { code: result.code, message: persianMessage(result.code) } },
      result.status,
    );
  }
  return secureJson({ ...result.data, attachmentId: attachmentId.data });
}
