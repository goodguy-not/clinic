import {
  maskedLandlineSchema,
  maskedMobileSchema,
  maskedNationalIdSchema,
} from '@clinic/contracts';
import { assertAuditPayloadSafe } from '../audit/audit-payload';
import {
  auditSafeChild,
  auditSafeDuplicateOverride,
  auditSafeFamily,
  auditSafeGuardians,
  maskIdentifier,
} from './audit-safe';

/**
 * Every identifier here is synthetic. `0912...` and `1234...` are shapes, not
 * anybody's number: no real clinic data appears in any fixture in this project.
 */
const MOBILE = '09121234567';
const LANDLINE_11 = '02112345678';
const LANDLINE_10 = '0341234567';
const NATIONAL_ID = '1234567891';

describe('identifier masking', () => {
  it('keeps the last four digits and nothing else', () => {
    expect(maskIdentifier(MOBILE)).toBe('*******4567');
    expect(maskIdentifier(LANDLINE_11)).toBe('*******5678');
    expect(maskIdentifier(LANDLINE_10)).toBe('******4567');
    expect(maskIdentifier(NATIONAL_ID)).toBe('******7891');
  });

  it('produces exactly the shapes the contract describes', () => {
    // The asterisk count is the identifier's own length minus four, which is
    // what makes a full value structurally unable to satisfy the shape.
    expect(maskedMobileSchema.safeParse(maskIdentifier(MOBILE)).success).toBe(true);
    expect(maskedLandlineSchema.safeParse(maskIdentifier(LANDLINE_11)).success).toBe(true);
    expect(maskedLandlineSchema.safeParse(maskIdentifier(LANDLINE_10)).success).toBe(true);
    expect(maskedNationalIdSchema.safeParse(maskIdentifier(NATIONAL_ID)).success).toBe(true);
  });

  it('refuses to let a full identifier pass as a masked one', () => {
    // The property that matters: no real value satisfies a masked shape.
    for (const value of [MOBILE, LANDLINE_11, LANDLINE_10, NATIONAL_ID]) {
      expect(maskedMobileSchema.safeParse(value).success).toBe(false);
      expect(maskedLandlineSchema.safeParse(value).success).toBe(false);
      expect(maskedNationalIdSchema.safeParse(value).success).toBe(false);
    }

    // Nor does a value that merely begins with an asterisk, which is what a
    // prefix rule would have accepted.
    expect(maskedNationalIdSchema.safeParse(`*${NATIONAL_ID}`).success).toBe(false);
    expect(maskedMobileSchema.safeParse('*09121234567').success).toBe(false);
  });

  it('preserves absence, so "added" and "changed" stay different facts', () => {
    expect(maskIdentifier(null)).toBeNull();
    expect(maskIdentifier(undefined)).toBeNull();
  });

  it('replaces a too-short value outright rather than revealing part of it', () => {
    // Nothing valid reaches this branch. A masking function whose failure mode
    // is "print the value" is the wrong failure mode to have.
    expect(maskIdentifier('1234')).toBe('****');
    expect(maskIdentifier('7')).toBe('*');
    expect(maskIdentifier('')).toBe('');
  });
});

describe('guardian payloads', () => {
  const guardians = [
    {
      fullName: 'ب',
      relationship: 'FATHER' as const,
      relationshipNote: null,
      mobile: MOBILE,
      landline: null,
      isPrimaryContact: false,
    },
    {
      fullName: 'الف',
      relationship: 'MOTHER' as const,
      relationshipNote: null,
      mobile: '09129876543',
      landline: LANDLINE_11,
      isPrimaryContact: true,
    },
  ];

  it('masks every number on every guardian, primary or not', () => {
    const mapped = auditSafeGuardians(guardians);

    expect(mapped.map((guardian) => guardian.mobile)).toEqual(['*******6543', '*******4567']);
    expect(mapped.map((guardian) => guardian.landline)).toEqual(['*******5678', null]);
  });

  it('orders the primary contact first, then by name', () => {
    // Guardians are replaced wholesale on every edit, so their ids churn even
    // when nothing meaningful changed. A deterministic order is what makes a
    // before/after pair read as the change that actually happened.
    expect(auditSafeGuardians(guardians).map((guardian) => guardian.fullName)).toEqual([
      'الف',
      'ب',
    ]);
  });

  it('records names in full', () => {
    // A change to a name is the fact being recorded. Masking it would make the
    // trail useless for the corrections it exists to explain.
    expect(auditSafeGuardians(guardians)[0]?.fullName).toBe('الف');
  });
});

describe('family and child payloads', () => {
  const family = {
    familyName: 'خانوادهٔ آزمایشی',
    address: 'نشانی آزمایشی',
    note: 'یادداشت غیرپزشکی',
    status: 'ACTIVE' as const,
    guardians: [
      {
        fullName: 'سرپرست آزمایشی',
        relationship: 'MOTHER' as const,
        relationshipNote: null,
        mobile: MOBILE,
        landline: null,
        isPrimaryContact: true,
      },
    ],
  };

  const child = {
    familyId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    firstName: 'کودک',
    lastName: 'آزمایشی',
    birthDate: '2020-03-21',
    fileNumber: '10001',
    legacyPaperFileNumber: 'A-77',
    nationalId: NATIONAL_ID,
    sex: 'UNSPECIFIED' as const,
    referralSource: 'معرف آزمایشی',
    note: null,
    status: 'ACTIVE' as const,
  };

  it('never carries a full identifier', () => {
    const payload = JSON.stringify({
      family: auditSafeFamily(family),
      child: auditSafeChild(child),
    });

    expect(payload).not.toContain(MOBILE);
    expect(payload).not.toContain(NATIONAL_ID);
  });

  it('carries the file number in full', () => {
    // A clinic-assigned reference with no meaning outside this system, which
    // never changes, and which is how a person identifies the record a row is
    // about. The national identifier is the opposite on every count.
    expect(auditSafeChild(child).fileNumber).toBe('10001');
    expect(auditSafeChild(child).nationalId).toBe('******7891');
  });

  it('passes its own output through the payload guard', () => {
    // The mapper and the guard must agree. If they ever disagree, every audited
    // family write fails, which is the correct direction for that mistake.
    expect(() => assertAuditPayloadSafe({ after: auditSafeFamily(family) })).not.toThrow();
    expect(() => assertAuditPayloadSafe({ after: auditSafeChild(child) })).not.toThrow();
  });

  it('omits status when it is not part of the change', () => {
    const { status: _status, ...withoutStatus } = family;

    expect(auditSafeFamily(withoutStatus)).not.toHaveProperty('status');
  });
});

describe('duplicate override metadata', () => {
  it('records ids and rule names only', () => {
    const metadata = auditSafeDuplicateOverride({
      acknowledgedIds: [
        '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
        '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      ],
      rules: ['FAMILY_DUPLICATE_MOBILE', 'FAMILY_DUPLICATE_MOBILE'],
    });

    expect(metadata).toEqual({
      acknowledgedIds: [
        '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
      ],
      rules: ['FAMILY_DUPLICATE_MOBILE'],
    });

    // No name, no number: an id resolves to the family for anyone who needs it
    // and to nothing for anyone who does not.
    expect(JSON.stringify(metadata)).not.toContain(MOBILE);
    expect(() => assertAuditPayloadSafe({ metadata })).not.toThrow();
  });
});
