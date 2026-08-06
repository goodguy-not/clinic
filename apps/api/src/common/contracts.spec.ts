import {
  ERROR_CODES,
  NOTICE_CODES,
  PERMISSIONS,
  USER_ROLES,
  USER_STATUSES,
  createChildRequestSchema,
  createFamilyRequestSchema,
  errorEnvelopeSchema,
  iranLandlineSchema,
  iranMobileSchema,
  loginResponseSchema,
  loginRequestSchema,
  nationalIdSchema,
  usernameSchema,
} from '@clinic/contracts';

/**
 * Proves `@clinic/contracts` is consumable from the CommonJS side.
 *
 * NestJS compiles to CommonJS and Next.js is ESM/bundler, so the package is
 * built once to CommonJS and consumed by both. A parallel test in `apps/web`
 * covers the other side; together they are the regression guard for the
 * packaging decision, which is otherwise only exercised at runtime.
 */
describe('@clinic/contracts (CommonJS consumption)', () => {
  it('exports the Milestone 1 constants', () => {
    expect(USER_ROLES).toEqual(['MANAGER', 'RECEPTIONIST']);
    expect(USER_STATUSES).toEqual(['ACTIVE', 'DISABLED']);
    expect(PERMISSIONS).toContain('user.create');
    expect(ERROR_CODES).toContain('AUTH_INVALID_CREDENTIALS');
  });

  it('declares no therapist role, which is a later approved decision', () => {
    expect(USER_ROLES).not.toContain('THERAPIST');
  });

  it('has no duplicate error code or permission', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  describe('username', () => {
    it.each(['reza', 'a.b_c-d', 'x'.repeat(32)])('accepts %s', (value: string) => {
      expect(usernameSchema.safeParse(value).success).toBe(true);
    });

    it.each(['ab', 'x'.repeat(33), 'Reza', 'has space', 'unicodeیی'])(
      'rejects %s',
      (value: string) => {
        expect(usernameSchema.safeParse(value).success).toBe(false);
      },
    );
  });

  describe('strict response schemas', () => {
    const validLogin = {
      sessionToken: 'opaque-token',
      session: { cookieMaxAgeSeconds: 43200 },
      user: {
        id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        username: 'reza',
        displayName: 'Synthetic Manager',
        role: 'MANAGER',
        mustChangePassword: false,
        permissions: ['user.read'],
      },
    };

    it('parses a well-formed login response', () => {
      expect(loginResponseSchema.safeParse(validLogin).success).toBe(true);
    });

    it('REJECTS an unexpected field, which is how a leaked passwordHash fails a test', () => {
      const leaked = {
        ...validLogin,
        user: { ...validLogin.user, passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$x$y' },
      };

      expect(loginResponseSchema.safeParse(leaked).success).toBe(false);
    });

    it('rejects a non-positive cookie lifetime', () => {
      expect(
        loginResponseSchema.safeParse({ ...validLogin, session: { cookieMaxAgeSeconds: 0 } })
          .success,
      ).toBe(false);
    });

    it('rejects an unknown permission', () => {
      expect(
        loginResponseSchema.safeParse({
          ...validLogin,
          user: { ...validLogin.user, permissions: ['ledger.void'] },
        }).success,
      ).toBe(false);
    });
  });

  describe('request schemas', () => {
    it('accepts a well-formed login request', () => {
      expect(loginRequestSchema.safeParse({ username: 'reza', password: 'x' }).success).toBe(true);
    });

    it('rejects an unexpected field', () => {
      expect(
        loginRequestSchema.safeParse({ username: 'reza', password: 'x', role: 'MANAGER' }).success,
      ).toBe(false);
    });

    it('states no password policy, because the server is authoritative', () => {
      // A 1-character password parses here and is rejected by the API. Any
      // length rule in this package would be a second copy of a security rule
      // that the browser tier consumes, and the copies would drift.
      expect(loginRequestSchema.safeParse({ username: 'reza', password: 'a' }).success).toBe(true);
    });
  });

  describe('error envelope', () => {
    it('requires a request id, so every failure is traceable', () => {
      const withoutRequestId = { error: { code: 'INTERNAL_ERROR', message: 'boom' } };
      expect(errorEnvelopeSchema.safeParse(withoutRequestId).success).toBe(false);
    });

    it('parses a complete envelope', () => {
      const envelope = {
        error: {
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Invalid credentials',
          requestId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        },
      };

      expect(errorEnvelopeSchema.safeParse(envelope).success).toBe(true);
    });

    it('rejects an unknown error code', () => {
      const envelope = {
        error: {
          code: 'SOMETHING_NEW',
          message: 'x',
          requestId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        },
      };

      expect(errorEnvelopeSchema.safeParse(envelope).success).toBe(false);
    });
  });
});

describe('Milestone 3 contracts', () => {
  it('adds exactly eight family and child permissions', () => {
    const m3 = PERMISSIONS.filter((permission) => /^(?:family|child)\./.test(permission));

    expect([...m3].sort()).toEqual([
      'child.create',
      'child.read',
      'child.update',
      'child.update_status',
      'family.create',
      'family.read',
      'family.update',
      'family.update_status',
    ]);
  });

  it('declares the family and child error codes', () => {
    for (const code of [
      'FAMILY_NOT_FOUND',
      'CHILD_NOT_FOUND',
      'FAMILY_POSSIBLE_DUPLICATE',
      'CHILD_POSSIBLE_DUPLICATE',
      'CHILD_NATIONAL_ID_TAKEN',
      'CHILD_LEGACY_FILE_NUMBER_TAKEN',
      'FAMILY_PRIMARY_GUARDIAN_INVALID',
      'FAMILY_INACTIVE',
      'CHILD_BIRTH_DATE_IN_FUTURE',
      'DRAFT_NOT_FOUND',
    ]) {
      expect(ERROR_CODES).toContain(code);
    }
  });

  it('has no duplicate notice code, and none that names a person', () => {
    expect(new Set(NOTICE_CODES).size).toBe(NOTICE_CODES.length);

    // A notice travels in a query string. A closed vocabulary of categories is
    // what keeps a candidate's name out of a URL.
    for (const code of NOTICE_CODES) expect(code).toMatch(/^[A-Z_]+$/);
  });

  describe('national identifier', () => {
    it.each(['1234567891', '0499370899', '0084575948'])('accepts %s', (value: string) => {
      expect(nationalIdSchema.safeParse(value).success).toBe(true);
    });

    it.each([
      ['123456789', 'nine digits'],
      ['12345678912', 'eleven digits'],
      ['1234567890', 'wrong check digit'],
      ['۱۲۳۴۵۶۷۸۹۱', 'Persian digits, which the web tier folds before validating'],
    ])('rejects %s (%s)', (value: string) => {
      expect(nationalIdSchema.safeParse(value).success).toBe(false);
    });

    it.each(['0000000000', '1111111111', '9999999999'])(
      'rejects the repdigit %s even though the arithmetic works',
      (value: string) => {
        // Exactly the value somebody types to get past a required field.
        expect(nationalIdSchema.safeParse(value).success).toBe(false);
      },
    );
  });

  describe('phone numbers are canonical national form', () => {
    it.each(['09121234567', '09001234567'])('accepts the mobile %s', (value: string) => {
      expect(iranMobileSchema.safeParse(value).success).toBe(true);
    });

    it.each(['+989121234567', '9121234567', '0912 123 4567', '۰۹۱۲۱۲۳۴۵۶۷', '091212345678'])(
      'rejects %s, which the web tier normalises first',
      (value: string) => {
        expect(iranMobileSchema.safeParse(value).success).toBe(false);
      },
    );

    it.each(['02112345678', '0341234567'])('accepts the landline %s', (value: string) => {
      expect(iranLandlineSchema.safeParse(value).success).toBe(true);
    });

    it.each(['0021234567', '02112345', '2112345678'])(
      'rejects the landline %s',
      (value: string) => {
        expect(iranLandlineSchema.safeParse(value).success).toBe(false);
      },
    );
  });

  describe('a family needs exactly one reachable primary contact', () => {
    const guardian = (overrides: Record<string, unknown> = {}) => ({
      fullName: 'سرپرست آزمایشی',
      relationship: 'MOTHER',
      relationshipNote: null,
      mobile: '09121234567',
      landline: null,
      isPrimaryContact: true,
      ...overrides,
    });

    const family = (guardians: unknown[]) => ({
      familyName: 'خانوادهٔ آزمایشی',
      address: null,
      note: null,
      guardians,
    });

    it('accepts one primary with a mobile', () => {
      expect(createFamilyRequestSchema.safeParse(family([guardian()])).success).toBe(true);
    });

    it('accepts a primary reachable only on a landline', () => {
      // A family reachable only on a landline is a real family, and refusing it
      // would refuse a patient.
      expect(
        createFamilyRequestSchema.safeParse(
          family([guardian({ mobile: null, landline: '02112345678' })]),
        ).success,
      ).toBe(true);
    });

    it('rejects a primary with no contact method at all', () => {
      expect(
        createFamilyRequestSchema.safeParse(family([guardian({ mobile: null, landline: null })]))
          .success,
      ).toBe(false);
    });

    it('rejects zero primaries and two primaries alike', () => {
      expect(
        createFamilyRequestSchema.safeParse(family([guardian({ isPrimaryContact: false })]))
          .success,
      ).toBe(false);

      expect(
        createFamilyRequestSchema.safeParse(
          family([guardian(), guardian({ fullName: 'سرپرست دوم' })]),
        ).success,
      ).toBe(false);
    });

    it('rejects a family with no guardian', () => {
      expect(createFamilyRequestSchema.safeParse(family([])).success).toBe(false);
    });

    it('requires a note for OTHER and forbids one otherwise', () => {
      expect(
        createFamilyRequestSchema.safeParse(
          family([guardian({ relationship: 'OTHER', relationshipNote: null })]),
        ).success,
      ).toBe(false);

      expect(
        createFamilyRequestSchema.safeParse(
          family([guardian({ relationship: 'OTHER', relationshipNote: 'همسایه' })]),
        ).success,
      ).toBe(true);

      expect(
        createFamilyRequestSchema.safeParse(
          family([guardian({ relationship: 'MOTHER', relationshipNote: 'اضافی' })]),
        ).success,
      ).toBe(false);
    });
  });

  it('never accepts a file number in a child request', () => {
    // It is generated by the server from a sequence. A field for it would be a
    // duplicate-key error waiting to happen on the busiest form in the clinic.
    const child = {
      firstName: 'کودک',
      lastName: 'آزمایشی',
      birthDate: '2020-03-21',
      sex: 'UNSPECIFIED',
      nationalId: null,
      legacyPaperFileNumber: null,
      referralSource: null,
      note: null,
    };

    expect(createChildRequestSchema.safeParse(child).success).toBe(true);
    expect(createChildRequestSchema.safeParse({ ...child, fileNumber: '10001' }).success).toBe(
      false,
    );
  });
});
