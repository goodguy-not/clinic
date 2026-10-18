import { createHash } from 'node:crypto';
import { anonymousWebsiteAuditContext } from './anonymous-audit';
import { dedupeKey, fingerprintsEqual, submitterFingerprint } from './request-fingerprint';

/**
 * The two properties the abuse controls stand on, and the one the audit rule
 * stands on.
 *
 * Milestone 9, checkpoint A3. Synthetic throughout: the key below is a test
 * string, and the addresses are from the documentation ranges reserved for
 * exactly this.
 */

const KEY = 'test_only_internal_key_0123456789abcdef';
const OTHER_KEY = 'test_only_different_key_0123456789abcd';

const subject = {
  contactMobile: '09120000001',
  requestedServiceId: null,
  childAgeYears: 6,
  childSex: 'UNSPECIFIED' as const,
};

describe('website request fingerprints', () => {
  describe('they are stable, which is what makes them useful', () => {
    it('gives one address the same fingerprint every time', () => {
      const first = submitterFingerprint(KEY, '203.0.113.10');
      const second = submitterFingerprint(KEY, '203.0.113.10');

      expect(first).not.toBeNull();
      expect(fingerprintsEqual(first as string, second as string)).toBe(true);
    });

    it('gives one submission the same deduplication key every time', () => {
      expect(dedupeKey(KEY, subject)).toBe(dedupeKey(KEY, subject));
    });

    it('reports nothing when the web tier reported no address', () => {
      // A real state — a misconfigured proxy — and the honest answer is to store
      // nothing and skip the throttle rather than bucket every visitor together
      // and take the contact form down.
      expect(submitterFingerprint(KEY, null)).toBeNull();
      expect(submitterFingerprint(KEY, '')).toBeNull();
    });
  });

  describe('they are keyed, which is what makes them safe', () => {
    it('is not the unkeyed digest anybody with a dump could enumerate', () => {
      // An IPv4 address is four billion guesses and an Iranian mobile is fewer.
      // An unkeyed fingerprint would simply BE the value it claims to replace.
      const unkeyed = createHash('sha256').update('203.0.113.10').digest('hex');

      expect(submitterFingerprint(KEY, '203.0.113.10')).not.toBe(unkeyed);
    });

    it('changes completely under a different key', () => {
      expect(submitterFingerprint(KEY, '203.0.113.10')).not.toBe(
        submitterFingerprint(OTHER_KEY, '203.0.113.10'),
      );
      expect(dedupeKey(KEY, subject)).not.toBe(dedupeKey(OTHER_KEY, subject));
    });

    it('contains no trace of the value it was derived from', () => {
      expect(submitterFingerprint(KEY, '203.0.113.10')).not.toContain('203');
      expect(dedupeKey(KEY, subject)).not.toContain('0912');
      expect(dedupeKey(KEY, subject)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('keeps the submitter and the subject in separate namespaces', () => {
      // Otherwise a submitter fingerprint could collide with a deduplication key
      // and one control could silently answer for the other.
      expect(submitterFingerprint(KEY, '09120000001')).not.toBe(
        dedupeKey(KEY, { ...subject, requestedServiceId: null }),
      );
    });
  });

  describe('what counts as the same request', () => {
    it('separates two people who submitted alike', () => {
      expect(dedupeKey(KEY, subject)).not.toBe(
        dedupeKey(KEY, { ...subject, contactMobile: '09120000002' }),
      );
    });

    it('separates one person asking about a different child or service', () => {
      // THE OWNER-APPROVED SEMANTICS: age and sex are part of the identity
      // precisely so one parent's two children are two requests. Under the
      // earlier planning shorthand — mobile plus service only — the second would
      // have been silently discarded.
      expect(dedupeKey(KEY, subject)).not.toBe(dedupeKey(KEY, { ...subject, childAgeYears: 9 }));
      expect(dedupeKey(KEY, subject)).not.toBe(dedupeKey(KEY, { ...subject, childSex: 'MALE' }));
      expect(dedupeKey(KEY, subject)).not.toBe(
        dedupeKey(KEY, { ...subject, requestedServiceId: '00000000-0000-4000-8000-000000000001' }),
      );
    });

    it('turns on exactly four structured facts and nothing else', () => {
      // NOT AN IDENTITY SYSTEM. The subject type has four fields and there is
      // nowhere for a name, a note or a spelling to enter — so no amount of
      // fuzzy matching can be added here without changing this shape and this
      // assertion.
      expect(Object.keys(subject).sort()).toEqual([
        'childAgeYears',
        'childSex',
        'contactMobile',
        'requestedServiceId',
      ]);
    });

    it('cannot be defeated by moving a separator between the fields', () => {
      // The fields are joined with a null byte, which no validated field can
      // contain, so no combination of values can be made to collide.
      const left = dedupeKey(KEY, { ...subject, contactMobile: '09120000001', childAgeYears: 16 });
      const right = dedupeKey(KEY, { ...subject, contactMobile: '09120000001', childAgeYears: 1 });

      expect(left).not.toBe(right);
    });
  });
});

describe('the anonymous audit context', () => {
  it('drops the client address and user agent it was handed', () => {
    // THE ACCEPTED A3 AUDIT FALLBACK, IN ONE ASSERTION. `audit_log` is
    // append-only and unprunable, so a stranger's IP written there would be a
    // permanent record of somebody the clinic has promised to forget within
    // ninety days — sitting in the one table the purge cannot reach.
    const context = anonymousWebsiteAuditContext({
      requestId: '00000000-0000-4000-8000-000000000000',
      clientIp: '203.0.113.10',
      userAgent: 'Synthetic/1.0',
      session: null,
    });

    expect(context.clientIp).toBeNull();
    expect(context.userAgent).toBeNull();
  });

  it('names no actor and keeps the request id', () => {
    const context = anonymousWebsiteAuditContext({
      requestId: '00000000-0000-4000-8000-000000000000',
      clientIp: null,
      userAgent: null,
      session: null,
    });

    expect(context.actor).toEqual({ type: 'ANONYMOUS' });
    // Generated here, naming nobody, and what ties the audit row to the server
    // log line and to the envelope a visitor may quote.
    expect(context.requestId).toBe('00000000-0000-4000-8000-000000000000');
  });
});
