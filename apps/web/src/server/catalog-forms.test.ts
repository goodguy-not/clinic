import { describe, expect, it } from 'vitest';
import {
  createRoomRequestSchema,
  createServiceRequestSchema,
  createTherapistRequestSchema,
} from '@clinic/contracts';
import {
  roomFormToRequest,
  serviceFormToRequest,
  servicePublicAddressValid,
  therapistFormToRequest,
} from './catalog-forms';
import { parseNumberList, toWesternDigits } from './numerals-fa';

/**
 * The translation from submitted strings to contract shapes.
 *
 * These forms carry no client JavaScript, so everything arrives as text and
 * this is the only place it becomes structured. A mistake here is a mistake
 * nothing downstream can catch — the contract would happily validate a
 * well-formed value that means the wrong thing.
 */

describe('Persian numerals', () => {
  it('folds Persian and Arabic-Indic digits to ASCII', () => {
    expect(toWesternDigits('۴۵')).toBe('45');
    expect(toWesternDigits('٤٥')).toBe('45');
    expect(toWesternDigits('45')).toBe('45');
  });

  it('leaves everything that is not a digit alone', () => {
    // Folding is for numeric entry only; it must not rewrite Persian text.
    expect(toWesternDigits('اتاق ۱')).toBe('اتاق 1');
  });

  it.each([
    ['30,45', [30, 45]],
    ['۳۰، ۴۵', [30, 45]],
    ['30 45  60', [30, 45, 60]],
    ['45', [45]],
    ['', []],
  ])('parses %j', (input, expected) => {
    expect(parseNumberList(input)).toEqual(expected);
  });

  it.each(['30, abc', '45.5', '-30', 'سی'])('refuses %j rather than dropping it', (input) => {
    // Returning null makes the schema reject the submission. Skipping the bad
    // token would silently save a duration list the manager did not type.
    expect(parseNumberList(input)).toBeNull();
  });
});

describe('service form', () => {
  const base = { name: 'Physio', publicDescription: '', isPublic: 'false', durations: '30، 45' };

  it('produces a valid create request', () => {
    const parsed = createServiceRequestSchema.safeParse(serviceFormToRequest(base));

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.allowedDurationsMinutes).toEqual([30, 45]);
  });

  it('treats an empty description as absent', () => {
    const result = serviceFormToRequest({ ...base, publicDescription: '   ' });

    // The column is nullable and its CHECK rejects a blank string, so an empty
    // textarea has to become null rather than ''.
    expect(result['publicDescription']).toBeNull();
  });

  it('reads the visibility radio as a boolean', () => {
    expect(serviceFormToRequest({ ...base, isPublic: 'true' })['isPublic']).toBe(true);
    expect(serviceFormToRequest({ ...base, isPublic: 'false' })['isPublic']).toBe(false);
    // Anything other than the literal "true" is private, so a missing field
    // cannot accidentally publish a service.
    expect(serviceFormToRequest({ ...base, isPublic: '' })['isPublic']).toBe(false);
  });

  it('requires a valid address whenever a manager makes the service public', () => {
    expect(servicePublicAddressValid({ ...base, isPublic: 'true' })).toBe(false);
    expect(servicePublicAddressValid({ ...base, isPublic: 'true', publicSlug: 'Bad slug' })).toBe(
      false,
    );
    expect(
      servicePublicAddressValid({ ...base, isPublic: 'true', publicSlug: 'goftar-darmani' }),
    ).toBe(true);
    expect(servicePublicAddressValid(base)).toBe(true);
  });

  it('fails validation when the duration list has a typo', () => {
    const parsed = createServiceRequestSchema.safeParse(
      serviceFormToRequest({ ...base, durations: '30, thirty' }),
    );

    expect(parsed.success).toBe(false);
  });

  it('fails validation when no duration is given', () => {
    const parsed = createServiceRequestSchema.safeParse(
      serviceFormToRequest({ ...base, durations: '' }),
    );

    expect(parsed.success).toBe(false);
  });

  it('leaves trimming of the name to the contract', () => {
    const parsed = createServiceRequestSchema.safeParse(
      serviceFormToRequest({ ...base, name: '  Physio  ' }),
    );

    expect(parsed.success && parsed.data.name).toBe('Physio');
  });
});

describe('room form', () => {
  const idA = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
  const idB = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';

  it('sends an empty list when the room is unrestricted', () => {
    const result = roomFormToRequest({ name: 'Room 1', restriction: 'all' }, []);

    expect(result['allowedServiceIds']).toEqual([]);
  });

  it('sends every selected service when restricted', () => {
    const result = roomFormToRequest({ name: 'Room 1', restriction: 'selected' }, [idA, idB]);

    expect(result['allowedServiceIds']).toEqual([idA, idB]);
  });

  it('ignores a stale selection when "all services" is chosen', () => {
    // A manager who selected services and then changed their mind means what
    // they last chose. Reading the selection anyway would restrict a room they
    // asked to leave open.
    const result = roomFormToRequest({ name: 'Room 1', restriction: 'all' }, [idA, idB]);

    expect(result['allowedServiceIds']).toEqual([]);
  });

  it('treats a missing restriction answer as unrestricted', () => {
    expect(roomFormToRequest({ name: 'Room 1' }, [idA])['allowedServiceIds']).toEqual([]);
  });

  it('produces a valid create request in both modes', () => {
    for (const candidate of [
      roomFormToRequest({ name: 'Room 1', restriction: 'all' }, []),
      roomFormToRequest({ name: 'Room 1', restriction: 'selected' }, [idA]),
    ]) {
      expect(createRoomRequestSchema.safeParse(candidate).success).toBe(true);
    }
  });

  it('rejects a selection that is not a uuid', () => {
    const parsed = createRoomRequestSchema.safeParse(
      roomFormToRequest({ name: 'Room 1', restriction: 'selected' }, ['not-a-uuid']),
    );

    expect(parsed.success).toBe(false);
  });
});

describe('therapist form', () => {
  const idA = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
  const idB = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
  const base = { fullName: 'Synthetic Therapist', specialty: 'Synthetic Specialty' };

  it('sends an empty list when no service is ticked', () => {
    // Unlike a room, there is no unrestricted/restricted distinction to
    // disambiguate: none ticked simply means none assigned, which is valid.
    const result = therapistFormToRequest(base, []);

    expect(result['supportedServiceIds']).toEqual([]);
    expect(createTherapistRequestSchema.safeParse(result).success).toBe(true);
  });

  it('sends every ticked service', () => {
    const result = therapistFormToRequest(base, [idA, idB]);

    expect(result['supportedServiceIds']).toEqual([idA, idB]);
    expect(createTherapistRequestSchema.safeParse(result).success).toBe(true);
  });

  it('leaves trimming of the name and specialty to the contract', () => {
    const parsed = createTherapistRequestSchema.safeParse(
      therapistFormToRequest({ fullName: '  Padded  ', specialty: '  Specialty  ' }, []),
    );

    expect(parsed.success && parsed.data.fullName).toBe('Padded');
    expect(parsed.success && parsed.data.specialty).toBe('Specialty');
  });

  it.each([
    ['fullName', { ...base, fullName: '   ' }],
    ['specialty', { ...base, specialty: '' }],
  ])('fails validation when %s is blank', (_field, body) => {
    expect(createTherapistRequestSchema.safeParse(therapistFormToRequest(body, [])).success).toBe(
      false,
    );
  });

  it('rejects a ticked value that is not a uuid', () => {
    const parsed = createTherapistRequestSchema.safeParse(
      therapistFormToRequest(base, ['not-a-uuid']),
    );

    expect(parsed.success).toBe(false);
  });

  it('carries no credential or settlement field into the request', () => {
    const result = therapistFormToRequest(
      { ...base, password: 'x'.repeat(20), sharePercentage: '60' },
      [],
    );

    // The mapper names the approved fields explicitly, so an extra submitted
    // field cannot reach the API even before the strict contract rejects it.
    expect(Object.keys(result).sort()).toEqual(['fullName', 'specialty', 'supportedServiceIds']);
  });
});
