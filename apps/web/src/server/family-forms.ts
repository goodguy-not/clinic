import 'server-only';
import type { SubmittedBody } from '@/server/handler-support';
import { toWesternDigits } from '@/server/numerals-fa';
import type { JalaliParts } from '@/server/jalali';

/**
 * Turns submitted family and child forms into the shape the shared contracts
 * expect, the same division of labour `catalog-forms.ts` uses: this shapes the
 * value, the strict contract still approves it.
 */

/** How many guardian slots the form offers. Matches `createGuardianRequestSchema`'s cap. */
export const GUARDIAN_SLOTS = 6;

/**
 * Builds the guardian list from a fixed set of form slots.
 *
 * There is no client JavaScript to add a row on demand, so the form always
 * renders six slots and a slot counts as used only when its name is filled in
 * — the same "explicit choice over inferred emptiness" rule `roomFormToRequest`
 * follows for a room's service restriction. `primaryGuardian` names the slot
 * number that is the primary contact; nothing is inferred from it being first.
 */
export function guardiansFromForm(body: SubmittedBody): Record<string, unknown>[] {
  const primarySlot = body['primaryGuardian'] ?? '';
  const guardians: Record<string, unknown>[] = [];

  for (let slot = 1; slot <= GUARDIAN_SLOTS; slot += 1) {
    const fullName = (body[`guardian-${slot}-fullName`] ?? '').trim();
    if (fullName === '') continue;

    const relationshipNote = (body[`guardian-${slot}-relationshipNote`] ?? '').trim();
    const mobile = (body[`guardian-${slot}-mobile`] ?? '').trim();
    const landline = (body[`guardian-${slot}-landline`] ?? '').trim();

    guardians.push({
      fullName,
      relationship: body[`guardian-${slot}-relationship`] ?? '',
      relationshipNote: relationshipNote === '' ? null : relationshipNote,
      mobile: mobile === '' ? null : normalizeMobile(mobile),
      landline: landline === '' ? null : normalizeLandline(landline),
      isPrimaryContact: String(slot) === primarySlot,
    });
  }

  return guardians;
}

/** Folds the tolerant shapes a receptionist actually types into the canonical `09XXXXXXXXX` form. */
function normalizeMobile(value: string): string {
  const digits = toWesternDigits(value).replace(/[\s-]/g, '');

  if (digits.startsWith('+98')) return `0${digits.slice(3)}`;
  if (digits.startsWith('0098')) return `0${digits.slice(4)}`;
  if (digits.startsWith('98') && digits.length === 12) return `0${digits.slice(2)}`;

  return digits;
}

/** The landline equivalent: strips spaces and hyphens, folds `+98`/`0098` to the leading zero. */
function normalizeLandline(value: string): string {
  return normalizeMobile(value);
}

export function familyFormToRequest(body: SubmittedBody): Record<string, unknown> {
  const address = (body['address'] ?? '').trim();
  const note = (body['note'] ?? '').trim();

  return {
    familyName: body['familyName'] ?? '',
    address: address === '' ? null : address,
    note: note === '' ? null : note,
    guardians: guardiansFromForm(body),
  };
}

export type ChildFormResult =
  { ok: true; payload: Record<string, unknown> } | { ok: false; reason: 'INVALID_DATE' };

export function childFormToRequest(
  body: SubmittedBody,
  toIsoDate: (parts: JalaliParts) => string | null,
): ChildFormResult {
  const year = Number(toWesternDigits(body['birth-year'] ?? ''));
  const month = Number(toWesternDigits(body['birth-month'] ?? ''));
  const day = Number(toWesternDigits(body['birth-day'] ?? ''));

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return { ok: false, reason: 'INVALID_DATE' };
  }

  const birthDate = toIsoDate({ year, month, day });
  if (birthDate === null) return { ok: false, reason: 'INVALID_DATE' };

  const nationalId = (body['nationalId'] ?? '').trim();
  const legacyPaperFileNumber = (body['legacyPaperFileNumber'] ?? '').trim();
  const referralSource = (body['referralSource'] ?? '').trim();
  const note = (body['note'] ?? '').trim();

  return {
    ok: true,
    payload: {
      firstName: body['firstName'] ?? '',
      lastName: body['lastName'] ?? '',
      birthDate,
      sex: body['sex'] ?? 'UNSPECIFIED',
      nationalId: nationalId === '' ? null : toWesternDigits(nationalId),
      legacyPaperFileNumber: legacyPaperFileNumber === '' ? null : legacyPaperFileNumber,
      referralSource: referralSource === '' ? null : referralSource,
      note: note === '' ? null : note,
    },
  };
}
