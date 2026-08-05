import { describe, expect, it } from 'vitest';
import { createTariffRequestSchema } from '@clinic/contracts';
import { tariffFormToRequest } from './catalog-forms';
import { jalaliToIsoDate } from './jalali';

/**
 * Branch-specific payload construction for the tariff form.
 *
 * The form renders both price branches because there is no client JavaScript to
 * hide one, so this is where a submission becomes one shape or the other. Every
 * contradictory combination has a case here: silently dropping the field that
 * does not fit would let a manager believe they created something they did not.
 */

const SERVICE = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const THERAPIST = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';

/** 1 Farvardin 1405 = 2026-03-21. */
const START = { 'start-year': '1405', 'start-month': '1', 'start-day': '1' };

function form(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    serviceDuration: `${SERVICE}:45`,
    scope: 'general',
    ...START,
    ...overrides,
  };
}

const build = (body: Record<string, string>) => tariffFormToRequest(body, jalaliToIsoDate);

describe('paid branch', () => {
  it('sends only the paid fields', () => {
    const result = build(form({ priceMode: 'PAID', priceToman: '120000' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.payload).toEqual({
      serviceId: SERVICE,
      durationMinutes: 45,
      therapistId: null,
      effectiveStart: '2026-03-21',
      effectiveEnd: null,
      priceMode: 'PAID',
      priceToman: '120000',
    });
    // The free-branch fields are absent, not blank: the strict contract would
    // reject them either way, and absent is what the branch actually means.
    expect(result.payload).not.toHaveProperty('freeReason');
    expect(result.payload).not.toHaveProperty('confirmFreePrice');
    expect(createTariffRequestSchema.safeParse(result.payload).success).toBe(true);
  });

  it('passes a zero price straight through so the contract rejects it', () => {
    // Typing 0 must never become a free tariff. It stays a paid submission with
    // an invalid amount.
    const result = build(form({ priceMode: 'PAID', priceToman: '0' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload['priceMode']).toBe('PAID');
    expect(createTariffRequestSchema.safeParse(result.payload).success).toBe(false);
  });

  it.each([
    ['a filled free reason', { freeReason: 'campaign' }],
    ['a ticked confirmation', { confirmFreePrice: 'true' }],
  ])('refuses paid with %s', (_label, extra) => {
    const result = build(form({ priceMode: 'PAID', priceToman: '120000', ...extra }));

    expect(result).toEqual({ ok: false, reason: 'CONTRADICTORY' });
  });

  it('tolerates the free fields being present but empty', () => {
    // The browser submits every field in the form; blank ones from the branch
    // that was not chosen are ordinary, not contradictory.
    const result = build(
      form({ priceMode: 'PAID', priceToman: '120000', freeReason: '   ', confirmFreePrice: '' }),
    );

    expect(result.ok).toBe(true);
  });
});

describe('free branch', () => {
  it('sends only the free fields, with no amount at all', () => {
    const result = build(
      form({ priceMode: 'FREE', freeReason: 'screening programme', confirmFreePrice: 'true' }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.payload).not.toHaveProperty('priceToman');
    expect(result.payload['freeReason']).toBe('screening programme');
    expect(result.payload['confirmFreePrice']).toBe(true);
    expect(createTariffRequestSchema.safeParse(result.payload).success).toBe(true);
  });

  it('refuses free with a filled price', () => {
    const result = build(
      form({
        priceMode: 'FREE',
        priceToman: '5000',
        freeReason: 'campaign',
        confirmFreePrice: 'true',
      }),
    );

    expect(result).toEqual({ ok: false, reason: 'CONTRADICTORY' });
  });

  it('fails validation when the confirmation is not ticked', () => {
    const result = build(form({ priceMode: 'FREE', freeReason: 'campaign' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // An unticked box is `false`, which the literal-true contract refuses. A
    // free programme is never reached by omission.
    expect(result.payload['confirmFreePrice']).toBe(false);
    expect(createTariffRequestSchema.safeParse(result.payload).success).toBe(false);
  });

  it('fails validation when the reason is blank', () => {
    const result = build(form({ priceMode: 'FREE', freeReason: '  ', confirmFreePrice: 'true' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(createTariffRequestSchema.safeParse(result.payload).success).toBe(false);
  });
});

describe('no branch chosen', () => {
  it('produces a payload the contract rejects rather than guessing', () => {
    const result = build(form({ priceToman: '120000' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(createTariffRequestSchema.safeParse(result.payload).success).toBe(false);
  });
});

describe('scope', () => {
  it('reads the combined service and duration option', () => {
    const result = build(form({ priceMode: 'PAID', priceToman: '1000' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload['serviceId']).toBe(SERVICE);
    expect(result.payload['durationMinutes']).toBe(45);
  });

  it('sends a therapist only when the therapist scope is chosen', () => {
    const general = build(form({ priceMode: 'PAID', priceToman: '1000', therapistId: THERAPIST }));
    expect(general.ok && general.payload['therapistId']).toBeNull();

    const specific = build(
      form({ priceMode: 'PAID', priceToman: '1000', scope: 'therapist', therapistId: THERAPIST }),
    );
    expect(specific.ok && specific.payload['therapistId']).toBe(THERAPIST);
  });

  it('treats the therapist scope with no therapist as general, which the API then prices generally', () => {
    const result = build(form({ priceMode: 'PAID', priceToman: '1000', scope: 'therapist' }));

    expect(result.ok && result.payload['therapistId']).toBeNull();
  });

  it('carries a supersedes id when correcting', () => {
    const result = build(
      form({ priceMode: 'PAID', priceToman: '1000', supersedesTariffId: THERAPIST }),
    );

    expect(result.ok && result.payload['supersedesTariffId']).toBe(THERAPIST);
  });

  it('omits an empty supersedes id', () => {
    const result = build(form({ priceMode: 'PAID', priceToman: '1000', supersedesTariffId: '' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).not.toHaveProperty('supersedesTariffId');
  });
});

describe('dates', () => {
  it('converts Jalali components to a Gregorian ISO string', () => {
    const result = build(form({ priceMode: 'PAID', priceToman: '1000' }));

    expect(result.ok && result.payload['effectiveStart']).toBe('2026-03-21');
  });

  it('accepts Persian digits from a Persian keyboard', () => {
    const result = build(
      form({
        priceMode: 'PAID',
        priceToman: '1000',
        'start-year': '۱۴۰۵',
        'start-month': '۱',
        'start-day': '۱',
      }),
    );

    expect(result.ok && result.payload['effectiveStart']).toBe('2026-03-21');
  });

  it('converts an optional end date when supplied', () => {
    const result = build(
      form({
        priceMode: 'PAID',
        priceToman: '1000',
        'end-year': '1405',
        'end-month': '12',
        'end-day': '29',
      }),
    );

    expect(result.ok && result.payload['effectiveEnd']).toBe('2027-03-20');
  });

  it('leaves the end date null when untouched', () => {
    const result = build(form({ priceMode: 'PAID', priceToman: '1000' }));

    expect(result.ok && result.payload['effectiveEnd']).toBeNull();
  });

  it.each([
    ['a missing start', { 'start-year': '' }],
    ['an impossible start', { 'start-month': '13' }],
    [
      '30 Esfand in a common year',
      { 'start-year': '1404', 'start-month': '12', 'start-day': '30' },
    ],
  ])('refuses %s', (_label, override) => {
    const result = build(form({ priceMode: 'PAID', priceToman: '1000', ...override }));

    expect(result).toEqual({ ok: false, reason: 'INVALID_DATE' });
  });

  it('refuses a partly filled end date rather than ignoring it', () => {
    const result = build(
      form({ priceMode: 'PAID', priceToman: '1000', 'end-year': '1405', 'end-month': '' }),
    );

    expect(result).toEqual({ ok: false, reason: 'INVALID_DATE' });
  });

  it('never emits a timestamp for a date field', () => {
    const result = build(form({ priceMode: 'PAID', priceToman: '1000' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(String(result.payload['effectiveStart'])).not.toContain('T');
    expect(String(result.payload['effectiveStart'])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
