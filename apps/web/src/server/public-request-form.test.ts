import { describe, expect, it } from 'vitest';
import { parsePublicRequestForm } from './public-request-form';

function form(overrides: Record<string, string> = {}): FormData {
  const values = {
    contactName: 'والد نمونه',
    contactMobile: '09121234567',
    childAgeYears: '13',
    childSex: 'FEMALE',
    childName: '',
    preferredContactTime: '',
    note: '',
    consent: 'true',
    ...overrides,
  };
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe('public request form translation', () => {
  it('submits every required fact while omitting all optional fields', () => {
    const result = parsePublicRequestForm(form(), null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      contactName: 'والد نمونه',
      contactMobile: '09121234567',
      serviceSlug: null,
      childAgeYears: 13,
      childSex: 'FEMALE',
      consent: true,
      consentVersion: '2026-08-27',
    });
    expect(result.data).not.toHaveProperty('childName');
    expect(result.data).not.toHaveProperty('preferredContactTime');
    expect(result.data).not.toHaveProperty('note');
  });

  it.each(['0', '13', '120'])('accepts age %s under the wide sanity bound', (age) => {
    expect(parsePublicRequestForm(form({ childAgeYears: age }), null).ok).toBe(true);
  });

  it('folds Persian and Arabic digits and normalizes tolerant mobile entry', () => {
    const result = parsePublicRequestForm(
      form({ contactMobile: '+۹۸ ۹۱۲-۱۲۳-۴۵۶۷', childAgeYears: '١٣' }),
      null,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.contactMobile).toBe('09121234567');
    expect(result.data.childAgeYears).toBe(13);
  });

  it('accepts UNSPECIFIED as an explicit gender answer', () => {
    const result = parsePublicRequestForm(form({ childSex: 'UNSPECIFIED' }), null);
    expect(result.ok && result.data.childSex).toBe('UNSPECIFIED');
  });

  it.each([
    ['contactName', ''],
    ['contactMobile', 'not-a-mobile'],
    ['childAgeYears', ''],
    ['childAgeYears', '121'],
    ['childAgeYears', '12.5'],
    ['childSex', ''],
    ['consent', ''],
  ])('returns an associated error for invalid %s', (field, value) => {
    const result = parsePublicRequestForm(form({ [field]: value }), null);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors).toHaveProperty(field);
  });

  it('keeps optional values closed and plain-text-only', () => {
    const invalidTime = parsePublicRequestForm(form({ preferredContactTime: 'هر وقت شد' }), null);
    const markupNote = parsePublicRequestForm(form({ note: '<script>' }), null);

    expect(!invalidTime.ok && invalidTime.fieldErrors.preferredContactTime).toBeTruthy();
    expect(!markupNote.ok && markupNote.fieldErrors.note).toBeTruthy();
  });

  it('preserves a bound public service slug without asking the visitor', () => {
    const result = parsePublicRequestForm(form(), 'speech-therapy');
    expect(result.ok && result.data.serviceSlug).toBe('speech-therapy');
  });
});
