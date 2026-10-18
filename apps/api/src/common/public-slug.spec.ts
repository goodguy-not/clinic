import { isPublicSlugImmutabilityViolation } from './public-slug';

/**
 * The service-layer half of the slug-stability rule.
 *
 * The DATABASE is the authority — `enforce_public_slug_stability()` refuses the
 * write — and since M10-A10 no request can even name an address, so what is
 * left here is recognising the database's own refusal precisely.
 */
describe('public slug stability', () => {
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
