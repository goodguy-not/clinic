import { AppError } from './app-error';
import { assertPublicSlugStable, isPublicSlugImmutabilityViolation } from './public-slug';

/**
 * The service-layer half of the A1 slug-stability rule.
 *
 * The DATABASE is the authority — `enforce_public_slug_stability()` refuses the
 * write whatever this file says — and the behaviour of that trigger is proved
 * against real PostgreSQL in `public-catalog-schema.int-spec.ts` and
 * `public-content-schema.int-spec.ts`. What is asserted here is the decision
 * table this guard exists to implement, including the two cases that must NOT
 * be refused.
 */
describe('public slug stability', () => {
  const published = { publicSlug: 'a-real-address', firstPublishedAt: new Date() };
  const neverPublished = { publicSlug: 'a-draft-address', firstPublishedAt: null };

  it('allows any correction to a slug that has never been reachable', () => {
    // A typo caught between preparing the content and publishing it is not yet
    // a promise to anybody.
    expect(() => assertPublicSlugStable(neverPublished, 'corrected-address')).not.toThrow();
    expect(() => assertPublicSlugStable(neverPublished, null)).not.toThrow();
  });

  it('allows an edit that does not mention the slug at all', () => {
    // `undefined` is the ordinary case: a manager fixing a description on a
    // live page. Refusing it would make a published page uneditable.
    expect(() => assertPublicSlugStable(published, undefined)).not.toThrow();
  });

  it('allows resubmitting the same slug on a published row', () => {
    // The manager form sends every field every time. Sending the address back
    // unchanged is not a rename.
    expect(() => assertPublicSlugStable(published, 'a-real-address')).not.toThrow();
  });

  it('refuses a rename and a clearing once the URL has been reachable', () => {
    for (const requested of ['a-different-address', null]) {
      expect(() => assertPublicSlugStable(published, requested)).toThrow(AppError);
      try {
        assertPublicSlugStable(published, requested);
      } catch (error) {
        expect((error as AppError).code).toBe('PUBLIC_SLUG_IMMUTABLE');
      }
    }
  });

  describe('recognising the database refusal', () => {
    it('matches the trigger this rule raises', () => {
      const error = new Error(
        'Raw query failed. Code: `23001`. Message: `ERROR: service.public_slug is immutable once the row has been publicly reachable`',
      );

      expect(isPublicSlugImmutabilityViolation(error)).toBe(true);
    });

    it('does not claim a different 23001 as a slug problem', () => {
      // Every no-delete and immutability trigger in this schema raises 23001, so
      // the SQLSTATE alone is not a precise enough answer to report to a
      // manager editing an address.
      const error = new Error(
        'Raw query failed. Code: `23001`. Message: `ERROR: audit_log is protected; DELETE is not permitted`',
      );

      expect(isPublicSlugImmutabilityViolation(error)).toBe(false);
    });

    it('does not claim an unrelated failure', () => {
      expect(isPublicSlugImmutabilityViolation(new Error('connection reset'))).toBe(false);
      expect(isPublicSlugImmutabilityViolation(undefined)).toBe(false);
    });
  });
});
