import { assertAuditPayloadSafe, AuditPayloadError } from './audit-payload';

describe('assertAuditPayloadSafe', () => {
  it('accepts an explicit, hand-built payload', () => {
    expect(() =>
      assertAuditPayloadSafe({
        before: { role: 'RECEPTIONIST', status: 'ACTIVE' },
        after: { role: 'MANAGER', status: 'ACTIVE' },
        metadata: { reason: 'promotion', failedLoginCount: 0 },
      }),
    ).not.toThrow();
  });

  it('accepts null and undefined sections', () => {
    expect(() => assertAuditPayloadSafe({ before: null, after: undefined })).not.toThrow();
  });

  it.each([
    'password',
    'passwordHash',
    'password_hash',
    'newPassword',
    'currentPassword',
    'passwd',
    'secret',
    'token',
    'tokenHash',
    'sessionToken',
    'cookie',
    'authorization',
    'internalKey',
    'internal_key',
    'apiKey',
    'privateKey',
    'credential',
    'salt',
  ])('rejects the key %s', (key) => {
    expect(() => assertAuditPayloadSafe({ after: { [key]: 'value' } })).toThrow(AuditPayloadError);
  });

  it('applies no banking-key rule of its own', () => {
    // The bank-reference exclusion belongs to the payment domain and is enforced
    // by `assertPaymentAuditSafe`, not by a substring rule here that would also
    // refuse `referenceDate` and every other unrelated key a later domain might
    // legitimately name (DECISION_LOG, 2026-08-15 — the broad rule was declined).
    expect(() => assertAuditPayloadSafe({ after: { referenceDate: '2026-08-15' } })).not.toThrow();
  });

  it('accepts a payment payload built to the frozen shape', () => {
    // Money as canonical decimal strings, the note in full, the reference only
    // as a boolean, and no name, phone number or file number anywhere.
    expect(() =>
      assertAuditPayloadSafe({
        after: {
          familyId: '01923c9e-4c1a-7000-8000-000000000001',
          amountToman: '500000',
          method: 'TRANSFER',
          receivedOn: '2026-08-15',
          hasReference: true,
          note: 'بابت دو جلسهٔ مرداد',
        },
      }),
    ).not.toThrow();
  });

  it('allows mustChangePassword when it is a boolean, and only then', () => {
    // A flag about a password, not a password. The boolean requirement is what
    // keeps the exemption from becoming a hole.
    expect(() => assertAuditPayloadSafe({ after: { mustChangePassword: true } })).not.toThrow();
    expect(() => assertAuditPayloadSafe({ after: { must_change_password: false } })).not.toThrow();

    expect(() => assertAuditPayloadSafe({ after: { mustChangePassword: 'hunter2' } })).toThrow(
      AuditPayloadError,
    );
    expect(() => assertAuditPayloadSafe({ after: { mustChangePassword: { a: 1 } } })).toThrow(
      AuditPayloadError,
    );
  });

  it('matches keys regardless of separators or case', () => {
    expect(() => assertAuditPayloadSafe({ after: { 'PASSWORD-HASH': 'x' } })).toThrow(
      AuditPayloadError,
    );
    expect(() => assertAuditPayloadSafe({ after: { Session_Token: 'x' } })).toThrow(
      AuditPayloadError,
    );
  });

  it('finds a forbidden key nested inside objects and arrays', () => {
    expect(() =>
      assertAuditPayloadSafe({ after: { outer: { inner: { passwordHash: 'x' } } } }),
    ).toThrow(AuditPayloadError);

    expect(() => assertAuditPayloadSafe({ after: { list: [{ ok: 1 }, { secret: 'x' }] } })).toThrow(
      AuditPayloadError,
    );
  });

  it('reports where the problem is', () => {
    try {
      assertAuditPayloadSafe({ after: { outer: { passwordHash: 'x' } } });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AuditPayloadError);
      expect((error as AuditPayloadError).path).toBe('after.outer.passwordHash');
    }
  });

  it('rejects an Argon2 hash appearing as a value under an innocent key', () => {
    const hash = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaA';

    expect(() => assertAuditPayloadSafe({ metadata: { note: hash } })).toThrow(AuditPayloadError);
    expect(() => assertAuditPayloadSafe({ metadata: { note: ['a', hash] } })).toThrow(
      AuditPayloadError,
    );
  });

  it('rejects a deeply nested payload, which means an object graph was passed', () => {
    let deep: Record<string, unknown> = { value: 1 };
    for (let level = 0; level < 12; level += 1) deep = { nested: deep };

    expect(() => assertAuditPayloadSafe({ after: deep as never })).toThrow(/nests deeper/);
  });

  it('throws rather than redacting, so a mistake fails a test instead of shipping', () => {
    // A redacting guard would let the row through with "***" in it and nobody
    // would learn that a call site is handing secrets to the audit trail.
    expect(() => assertAuditPayloadSafe({ after: { passwordHash: 'x' } })).toThrow();
  });
});

describe('identifier masking guard', () => {
  it('accepts null, so absence stays distinguishable from a masked value', () => {
    expect(() =>
      assertAuditPayloadSafe({ after: { nationalId: null, mobile: null, landline: null } }),
    ).not.toThrow();
  });

  it('accepts exactly the masked shapes and nothing else', () => {
    expect(() =>
      assertAuditPayloadSafe({
        after: { nationalId: '******7891', mobile: '*******4567', landline: '******4567' },
      }),
    ).not.toThrow();
  });

  it('rejects a full identifier under a guarded key', () => {
    const payloads: Record<string, string>[] = [
      { nationalId: '1234567891' },
      { mobile: '09121234567' },
      { landline: '02112345678' },
      { phone: '02112345678' },
    ];

    for (const payload of payloads) {
      expect(() => assertAuditPayloadSafe({ after: payload })).toThrow(AuditPayloadError);
    }
  });

  it('rejects a value that merely begins with an asterisk', () => {
    // The exact shape is the point. A "starts with a mask character" rule would
    // have accepted this, and it carries the whole identifier.
    expect(() => assertAuditPayloadSafe({ after: { nationalId: '*1234567891' } })).toThrow(
      AuditPayloadError,
    );
    expect(() => assertAuditPayloadSafe({ after: { mobile: '*09121234567' } })).toThrow(
      AuditPayloadError,
    );
  });

  it('rejects the wrong mask width for the key', () => {
    // A national identifier is ten digits, so six asterisks; a mobile is
    // eleven, so seven. Swapping them would mean the mapper and the guard
    // disagree about what was masked.
    expect(() => assertAuditPayloadSafe({ after: { nationalId: '*******7891' } })).toThrow(
      AuditPayloadError,
    );
    expect(() => assertAuditPayloadSafe({ after: { mobile: '******4567' } })).toThrow(
      AuditPayloadError,
    );
  });

  it('rejects a non-string value, which is a lost leading zero or a bug', () => {
    expect(() => assertAuditPayloadSafe({ after: { mobile: 9121234567 } })).toThrow(
      AuditPayloadError,
    );
  });

  it('applies at any depth and inside arrays', () => {
    expect(() =>
      assertAuditPayloadSafe({ after: { guardians: [{ mobile: '09121234567' }] } }),
    ).toThrow(AuditPayloadError);

    expect(() =>
      assertAuditPayloadSafe({ before: { family: { guardians: [{ landline: '0341234567' }] } } }),
    ).toThrow(AuditPayloadError);
  });

  it('catches renamed variants, because the match is a substring', () => {
    for (const key of ['primaryMobile', 'guardian_mobile', 'mobileNumber', 'homePhone']) {
      expect(() => assertAuditPayloadSafe({ after: { [key]: '09121234567' } })).toThrow(
        AuditPayloadError,
      );
    }
  });

  it('names the offending path', () => {
    try {
      assertAuditPayloadSafe({ after: { guardians: [{ mobile: '09121234567' }] } });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AuditPayloadError);
      expect((error as AuditPayloadError).path).toBe('after.guardians[0].mobile');
    }
  });
});

describe('a draft token never reaches the audit trail', () => {
  it('is refused outright, masked or not', () => {
    // A registration-draft token is a bearer credential: anyone holding one can
    // read what somebody typed and complete their registration. It is covered
    // by the existing `token` substring rule, and this pins that it stays so.
    for (const key of ['draftToken', 'draft_token', 'DraftToken']) {
      expect(() => assertAuditPayloadSafe({ metadata: { [key]: 'abc' } })).toThrow(
        AuditPayloadError,
      );
    }
  });
});
