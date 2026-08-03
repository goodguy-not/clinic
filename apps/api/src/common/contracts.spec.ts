import {
  ERROR_CODES,
  PERMISSIONS,
  USER_ROLES,
  USER_STATUSES,
  errorEnvelopeSchema,
  loginResponseSchema,
  loginRequestSchema,
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
