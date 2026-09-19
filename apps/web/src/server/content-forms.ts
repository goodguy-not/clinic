import 'server-only';
import type { SubmittedBody } from './handler-support';

const nullableTrimmed = (value: string | undefined): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
};

/** Draft-only article payload. Publication is intentionally impossible here. */
export function articleFormToRequest(body: SubmittedBody): Record<string, unknown> {
  return {
    publicSlug: (body['publicSlug'] ?? '').trim(),
    title: (body['title'] ?? '').trim(),
    summary: nullableTrimmed(body['summary']),
    body: (body['body'] ?? '').trim(),
  };
}

/** Draft-only testimonial payload. Approval and placement are separate manager acts. */
export function testimonialFormToRequest(body: SubmittedBody): Record<string, unknown> {
  return {
    authorLabel: nullableTrimmed(body['authorLabel']),
    body: (body['body'] ?? '').trim(),
  };
}

/** Draft-only public-space payload. Publication remains a separate manager act. */
export function spaceFormToRequest(body: SubmittedBody): Record<string, unknown> {
  const description = nullableTrimmed(body['description']);
  return {
    name: (body['name'] ?? '').trim(),
    description,
    displayOrder: Number(body['displayOrder']),
  };
}

/** Keeps malformed booleans malformed so the shared schema refuses them. */
export function explicitBoolean(value: string | undefined): boolean | string | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}
