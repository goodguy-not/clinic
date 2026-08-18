import { assertAuditPayloadSafe } from '../audit/audit-payload';
import { reportExportAudit } from './report-export-audit';

/**
 * What one successful export writes into the permanent trail (Milestone 7,
 * checkpoint C5).
 *
 * EVERYTHING HERE IS SYNTHETIC.
 *
 * WHAT THIS SUITE IS FOR. `audit_log` is append-only and permanent, so the
 * failure this guards against is not a wrong row — it is a row that is correct
 * and carries a copy of the exported data forever. The payload is built from the
 * REQUEST and one count, and the claims below are that it says enough to
 * establish what happened and nothing more.
 */
describe('the report export audit payload', () => {
  const scope = {
    report: 'PAYMENTS',
    range: { from: '2026-08-01', to: '2026-08-31', dateBasis: 'PAYMENT_RECEIVED_ON' },
    filters: {
      familyId: '0199a0f5-0000-7000-8000-000000000001',
      method: 'CARD',
      recordedByUserId: undefined,
      includeVoided: true,
    },
  } as const;

  it('records the act: which report, in what shape, over what period, how big', () => {
    expect(reportExportAudit(scope, 42)).toEqual({
      report: 'PAYMENTS',
      format: 'CSV',
      range: { from: '2026-08-01', to: '2026-08-31', dateBasis: 'PAYMENT_RECEIVED_ON' },
      filters: {
        familyId: '0199a0f5-0000-7000-8000-000000000001',
        method: 'CARD',
        includeVoided: true,
      },
      rowCount: 42,
    });
  });

  it('omits a filter the caller did not supply rather than writing it as null', () => {
    // The row reads as the request that was made: `recordedByUserId` is absent
    // because nobody asked for one.
    expect(Object.keys(reportExportAudit(scope, 0).filters as object)).not.toContain(
      'recordedByUserId',
    );
  });

  it('states an absent range explicitly, so "no period" is not "period lost"', () => {
    // A position is not a period (frozen C1), and the family-accounts export has
    // no range at all.
    const payload = reportExportAudit(
      { report: 'FAMILY_ACCOUNTS', range: null, filters: { standing: 'OWING' } },
      7,
    );

    expect(payload.range).toBeNull();
  });

  it('carries a count of rows and no value from any of them', () => {
    const payload = reportExportAudit(scope, 9);
    const serialised = JSON.stringify(payload);

    // Nothing that was IN the file: no amount, no total, no family, child,
    // therapist or user name, no file number, no identifier, no bank reference,
    // no note. The function cannot be handed a row, which is what makes this
    // true by construction rather than by review.
    expect(payload.rowCount).toBe(9);
    expect(serialised).not.toMatch(/toman|name|reference|note/i);
  });

  it('passes the audit payload safety check the service enforces', () => {
    expect(() => assertAuditPayloadSafe({ metadata: reportExportAudit(scope, 3) })).not.toThrow();
  });
});
