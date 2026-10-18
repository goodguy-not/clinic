import { type NextRequest, type NextResponse } from 'next/server';
import { createMediaAttachmentRequestSchema } from '@clinic/contracts';
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

  const mediaId = z.uuid().safeParse(body['mediaId']);
  const submittedOwnerId = body['ownerId'];
  const target = createMediaAttachmentRequestSchema.safeParse({
    ownerType: body['ownerType'] ?? 'CLINIC_SPACE',
    ownerId:
      submittedOwnerId === undefined || submittedOwnerId === '' || submittedOwnerId === 'null'
        ? null
        : submittedOwnerId,
    position: body['position'] === undefined ? 0 : Number(body['position']),
  });
  if (!mediaId.success || !target.success) {
    return secureJson(
      { error: { code: 'VALIDATION_FAILED', message: persianMessage('VALIDATION_FAILED') } },
      400,
    );
  }

  let result = await api.createMediaAttachment(mediaId.data, target.data, { sessionToken });
  if (!result.ok && result.code === 'MEDIA_ALREADY_ATTACHED') {
    result = await api.getMedia(mediaId.data, { sessionToken });
  }
  if (!result.ok) {
    return secureJson(
      { error: { code: result.code, message: persianMessage(result.code) } },
      result.status,
    );
  }

  const attachment = result.data.media.attachments.find(
    (item) =>
      item.ownerType === target.data.ownerType &&
      item.ownerId === target.data.ownerId &&
      item.position === target.data.position,
  );
  if (attachment === undefined) {
    return secureJson(
      {
        error: {
          code: 'MEDIA_ATTACHMENT_NOT_FOUND',
          message: persianMessage('MEDIA_ATTACHMENT_NOT_FOUND'),
        },
      },
      404,
    );
  }
  return secureJson({ ...result.data, attachmentId: attachment.id }, 201);
}
