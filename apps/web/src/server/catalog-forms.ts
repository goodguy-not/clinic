import 'server-only';
import type { SubmittedBody } from '@/server/handler-support';
import { parseNumberList, toWesternDigits } from '@/server/numerals-fa';

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
  const slug = (body['publicSlug'] ?? '').trim();

  return {
    name: body['name'] ?? '',
    // An empty textarea is an absent description, not an empty one: the column
    // is nullable and the CHECK rejects a blank string.
    publicDescription: description === '' ? null : description,
    ...(body['publicSlug'] === undefined ? {} : { publicSlug: slug === '' ? null : slug }),
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

/**
 * Builds the therapist request from the form's service checkboxes.
 *
 * Unlike a room, a therapist has no unrestricted/restricted distinction to
 * disambiguate: an empty set simply means no services are assigned yet, which
 * is a valid and common state for a newly entered record. Checked boxes are
 * therefore taken at face value, and none checked sends an empty array.
 */
export function therapistFormToRequest(
  body: SubmittedBody,
  selectedServiceIds: string[],
): Record<string, unknown> {
  return {
    fullName: body['fullName'] ?? '',
    specialty: body['specialty'] ?? '',
    supportedServiceIds: selectedServiceIds,
  };
}

/** A field belonging to the branch that was not chosen, and left blank. */
const isBlank = (value: string | undefined): boolean => value === undefined || value.trim() === '';

export type TariffFormResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: 'CONTRADICTORY' | 'INVALID_DATE' };

/**
 * Builds the tariff request from the paid/free form.
 *
 * The form has no client JavaScript, so both branches' fields exist in the HTML
 * and both are submitted. This constructs a payload for the chosen branch only,
 * which is what the discriminated-union contract expects — passing everything
 * through would fail `strictObject` even when the submission was sensible.
 *
 * Omitting a *blank* field from the other branch is the tolerant part. Ignoring
 * a *filled* one would not be: a paid tariff carrying a free-programme reason,
 * or a free one carrying an amount, means the two halves of the form disagree
 * about what is being created, and guessing which the user meant is exactly the
 * kind of silent resolution this milestone exists to avoid. Those are rejected.
 *
 * Dates arrive as Jalali components and become Gregorian ISO strings here, at
 * the web tier's edge, before anything shared sees them.
 */
export function tariffFormToRequest(
  body: SubmittedBody,
  toIsoDate: (parts: { year: number; month: number; day: number }) => string | null,
): TariffFormResult {
  const priceMode = body['priceMode'];
  const priceToman = body['priceToman'];
  const freeReason = body['freeReason'];
  const confirmFreePrice = body['confirmFreePrice'];

  const start = readJalaliParts(body, 'start');
  if (start === null) return { ok: false, reason: 'INVALID_DATE' };

  const effectiveStart = toIsoDate(start);
  if (effectiveStart === null) return { ok: false, reason: 'INVALID_DATE' };

  // An end date is optional; a partly filled one is a mistake, not an absence.
  const endParts = readJalaliParts(body, 'end');
  const endSupplied = ['end-year', 'end-month', 'end-day'].some((key) => !isBlank(body[key]));

  let effectiveEnd: string | null = null;
  if (endSupplied) {
    if (endParts === null) return { ok: false, reason: 'INVALID_DATE' };
    effectiveEnd = toIsoDate(endParts);
    if (effectiveEnd === null) return { ok: false, reason: 'INVALID_DATE' };
  }

  const scope = readScope(body);

  const common = {
    serviceId: scope.serviceId,
    durationMinutes: scope.durationMinutes,
    therapistId: scope.therapistId,
    effectiveStart,
    effectiveEnd,
    ...(isBlank(body['supersedesTariffId'])
      ? {}
      : { supersedesTariffId: body['supersedesTariffId'] }),
  };

  if (priceMode === 'PAID') {
    if (!isBlank(freeReason) || confirmFreePrice === 'true') {
      return { ok: false, reason: 'CONTRADICTORY' };
    }

    // Passed through as typed. Zero is rejected by the contract, so the paid
    // field can never quietly become a free tariff.
    return { ok: true, payload: { ...common, priceMode: 'PAID', priceToman: priceToman ?? '' } };
  }

  if (priceMode === 'FREE') {
    if (!isBlank(priceToman)) return { ok: false, reason: 'CONTRADICTORY' };

    return {
      ok: true,
      payload: {
        ...common,
        priceMode: 'FREE',
        freeReason: freeReason ?? '',
        // Only the literal true satisfies the contract, so an unticked box
        // fails validation rather than creating a free programme by omission.
        confirmFreePrice: confirmFreePrice === 'true',
      },
    };
  }

  // No branch chosen. Left as-is so the contract reports it as a validation
  // failure rather than this function inventing a default.
  return { ok: true, payload: { ...common, priceMode } };
}

function readJalaliParts(
  body: SubmittedBody,
  prefix: 'start' | 'end',
): { year: number; month: number; day: number } | null {
  const year = Number(toWesternDigits(body[`${prefix}-year`] ?? ''));
  const month = Number(toWesternDigits(body[`${prefix}-month`] ?? ''));
  const day = Number(toWesternDigits(body[`${prefix}-day`] ?? ''));

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year === 0 || month === 0 || day === 0) return null;

  return { year, month, day };
}

/**
 * Reads the scope from the combined service-duration option and the explicit
 * general/therapist choice.
 *
 * The two are one `<option value="serviceId:durationMinutes">`, because a
 * separate duration select could offer a duration the chosen service does not
 * have and no client JavaScript exists to correct it.
 */
function readScope(body: SubmittedBody): {
  serviceId: string;
  durationMinutes: number;
  therapistId: string | null;
} {
  const [serviceId = '', duration = ''] = (body['serviceDuration'] ?? '').split(':');

  const therapistId =
    body['scope'] === 'therapist' && !isBlank(body['therapistId'])
      ? (body['therapistId'] as string)
      : null;

  return { serviceId, durationMinutes: Number(toWesternDigits(duration)), therapistId };
}
