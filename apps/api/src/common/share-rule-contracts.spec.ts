import {
  createShareRuleRequestSchema,
  resolveShareRuleQuerySchema,
  shareRuleListQuerySchema,
  shareRuleSchema,
  voidShareRuleRequestSchema,
} from '@clinic/contracts';

/**
 * The Milestone 8 checkpoint C2 share-rule contracts.
 *
 * These pin the shapes the frozen rules depend on, at the boundary rather than
 * in the database: a share is an integer in basis points, a correction is
 * reasoned, a resolution names a service date, and no shape here can express a
 * default share or a silent zero.
 */
describe('share rule contracts', () => {
  const valid = {
    therapistId: '019538c0-0000-7000-8000-000000000001',
    shareBasisPoints: 4000,
    effectiveStart: '2026-01-01',
  };

  describe('the share percentage', () => {
    it.each([0, 1, 4250, 10000])('accepts %d basis points', (shareBasisPoints) => {
      expect(createShareRuleRequestSchema.safeParse({ ...valid, shareBasisPoints }).success).toBe(
        true,
      );
    });

    /**
     * `42.5` is the shape basis points exist to make unreachable. A percentage
     * carried as a float is a money bug that accumulates over a month of
     * sessions and is discovered by the therapist who is short.
     */
    it.each([-1, 10001, 42.5, Number.NaN])('refuses %p', (shareBasisPoints) => {
      expect(createShareRuleRequestSchema.safeParse({ ...valid, shareBasisPoints }).success).toBe(
        false,
      );
    });

    it('refuses a percentage sent as a string', () => {
      expect(
        createShareRuleRequestSchema.safeParse({ ...valid, shareBasisPoints: '4000' }).success,
      ).toBe(false);
    });
  });

  describe('the effective range', () => {
    it('accepts an open-ended rule', () => {
      expect(createShareRuleRequestSchema.safeParse({ ...valid, effectiveEnd: null }).success).toBe(
        true,
      );
    });

    it('accepts a single-day rule', () => {
      expect(
        createShareRuleRequestSchema.safeParse({ ...valid, effectiveEnd: '2026-01-01' }).success,
      ).toBe(true);
    });

    it('refuses an end before its start', () => {
      expect(
        createShareRuleRequestSchema.safeParse({ ...valid, effectiveEnd: '2025-12-31' }).success,
      ).toBe(false);
    });
  });

  describe('the correction', () => {
    const supersedesShareRuleId = '019538c0-0000-7000-8000-000000000002';

    it('requires a reason when it supersedes', () => {
      expect(
        createShareRuleRequestSchema.safeParse({ ...valid, supersedesShareRuleId }).success,
      ).toBe(false);
      expect(
        createShareRuleRequestSchema.safeParse({
          ...valid,
          supersedesShareRuleId,
          reason: 'the agreed percentage was entered wrongly',
        }).success,
      ).toBe(true);
    });

    /**
     * The other direction, and it is not pedantry: a reason on a rule that
     * withdraws nothing would be a second place to explain a change that no
     * void row ever carries, and the two would drift.
     */
    it('refuses a reason when it supersedes nothing', () => {
      expect(
        createShareRuleRequestSchema.safeParse({ ...valid, reason: 'no rule is being withdrawn' })
          .success,
      ).toBe(false);
    });

    it('refuses an empty reason on a withdrawal', () => {
      expect(voidShareRuleRequestSchema.safeParse({ reason: '   ' }).success).toBe(false);
      expect(voidShareRuleRequestSchema.safeParse({}).success).toBe(false);
      expect(voidShareRuleRequestSchema.safeParse({ reason: 'withdrawn' }).success).toBe(true);
    });
  });

  describe('resolution', () => {
    it('requires a service date and never defaults one', () => {
      expect(
        resolveShareRuleQuerySchema.safeParse({ therapistId: valid.therapistId }).success,
      ).toBe(false);
      expect(
        resolveShareRuleQuerySchema.safeParse({
          therapistId: valid.therapistId,
          serviceDate: '2026-03-15',
        }).success,
      ).toBe(true);
    });

    it('refuses a timestamp where a calendar day belongs', () => {
      expect(
        resolveShareRuleQuerySchema.safeParse({
          therapistId: valid.therapistId,
          serviceDate: '2026-03-15T09:00:00Z',
        }).success,
      ).toBe(false);
    });
  });

  describe('the response shape', () => {
    const row = {
      id: '019538c0-0000-7000-8000-000000000003',
      therapistId: valid.therapistId,
      shareBasisPoints: 4000,
      effectiveStart: '2026-01-01',
      effectiveEnd: null,
      voidedAt: null,
      voidReason: null,
      supersedesShareRuleId: null,
      createdAt: '2026-01-01T09:00:00.000Z',
    };

    it('accepts a live rule', () => {
      expect(shareRuleSchema.safeParse(row).success).toBe(true);
    });

    /**
     * Strict, like every response schema in the package: an accidental extra
     * field in a NestJS response fails a test instead of reaching a browser.
     * Here the field that must never appear is anything about a session, a
     * charge or a family — a rule knows about none of them.
     */
    it('refuses an unexpected field', () => {
      expect(shareRuleSchema.safeParse({ ...row, amountToman: '120000' }).success).toBe(false);
      expect(shareRuleSchema.safeParse({ ...row, familyId: valid.therapistId }).success).toBe(
        false,
      );
    });

    it('has no field that could carry a default or an inferred share', () => {
      // Absence of a rule is a missing SHAPE, not a value of one, so no
      // response field may express "no share" other than by not existing.
      const keys = Object.keys(shareRuleSchema.shape);
      expect(keys).not.toContain('defaultShareBasisPoints');
      expect(keys).not.toContain('isDefault');
      expect(keys).not.toContain('resolvedAt');
    });
  });

  describe('list filters', () => {
    it('coerces includeVoided from a query string', () => {
      const parsed = shareRuleListQuerySchema.parse({ includeVoided: 'true' });
      expect(parsed.includeVoided).toBe(true);
    });

    it('refuses an unknown filter', () => {
      expect(shareRuleListQuerySchema.safeParse({ serviceId: valid.therapistId }).success).toBe(
        false,
      );
    });
  });
});
