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
