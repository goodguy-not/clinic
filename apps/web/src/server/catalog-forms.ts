import 'server-only';
import type { SubmittedBody } from '@/server/handler-support';
import { parseNumberList } from '@/server/numerals-fa';

/**
 * Turns submitted form fields into the shape the shared contracts expect.
 *
 * The forms carry no client JavaScript, so what arrives is strings: a
 * comma-separated duration list, `"true"`/`"false"` for a radio, and a
 * restriction answer that has to become an array of ids. Converting here keeps
 * that translation in one place, and everything it produces is still validated
 * by the strict contract afterwards — this shapes the value, it does not
 * approve it.
 *
 * Anything unparseable becomes a value the schema will reject rather than a
 * silent default. A duration list with a typo in it must fail validation, not
 * quietly drop the entry the user meant to add.
 */

export function serviceFormToRequest(body: SubmittedBody): Record<string, unknown> {
  const description = (body['publicDescription'] ?? '').trim();

  return {
    name: body['name'] ?? '',
    // An empty textarea is an absent description, not an empty one: the column
    // is nullable and the CHECK rejects a blank string.
    publicDescription: description === '' ? null : description,
    isPublic: body['isPublic'] === 'true',
    // `null` when unparseable, which fails the array schema and produces
    // VALIDATION_FAILED rather than an empty duration set.
    allowedDurationsMinutes: parseNumberList(body['durations'] ?? '') ?? null,
  };
}

/**
 * Builds the room request from the explicit restriction choice.
 *
 * "Unrestricted" wins over whatever the multi-select happens to contain: a
 * manager who selected services, then changed their mind and chose "all
 * services", means all services. Reading the selection in that case would
 * silently restrict a room they asked to leave open.
 */
export function roomFormToRequest(
  body: SubmittedBody,
  selectedServiceIds: string[],
): Record<string, unknown> {
  const restricted = body['restriction'] === 'selected';

  return {
    name: body['name'] ?? '',
    allowedServiceIds: restricted ? selectedServiceIds : [],
  };
}
