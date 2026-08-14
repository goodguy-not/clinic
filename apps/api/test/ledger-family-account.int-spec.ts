import { familyAccountResponseSchema, type FamilyAccountResponse } from '@clinic/contracts';
import { signIn } from './appointments-support';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  adjustOverHttp,
  familyAccount,
  seedFamilyLedger,
  NEXT_SATURDAY,
  type FamilyLedgerFixture,
} from './ledger-support';
import { SATURDAY } from './appointments-support';

/**
 * The family account: what one family was charged, derived on every request.
 *
 * THE CLAIM UNDER TEST IS THAT NOTHING IS STORED. There is no balance column and
 * no cache anywhere in this system, so every number below has to fall out of the
 * immutable rows of `session_charge` and `charge_adjustment` — and the way to
 * prove that is to put every financial state a ledger can reach into ONE family
 * and read it back: a charge reduced, a charge waived to nothing, a charge that
 * was never priced, a concession withdrawn, and a charge withdrawn with a
 * concession still hanging off it.
 *
 * THE TWO QUESTIONS THAT MUST NEVER BE CONFUSED. What a reader SEES is set by
 * `includeVoided`; what the family OWES is not. Half of this suite is the same
 * account read two ways, asserting that the list changes and the totals do not.
 *
 * PAGING IS A WINDOW ON THE LIST AND NOTHING ELSE. A total that moved when the
 * reader turned the page would be read as a different family's money, so the
 * totals are asserted identical across every page of the same filter.
 *
 * Every fixture is synthetic: no real family, child, therapist, price or amount
 * appears anywhere in this file.
 */
describe('family account', () => {
  let harness: Harness;
  let ledger: FamilyLedgerFixture;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    ledger = await seedFamilyLedger(harness);
  });

  /** Reads the account and parses it against the frozen contract, which is half the assertion. */
  async function read(
    query: Record<string, string | number> = {},
    token = ledger.managerToken,
  ): Promise<FamilyAccountResponse> {
    const response = await familyAccount(harness, token, ledger.familyId, query).expect(200);
    return familyAccountResponseSchema.parse(response.body);
  }

  function rowFor(account: FamilyAccountResponse, chargeId: string) {
    const row = account.charges.find((one) => one.charge.id === chargeId);
    if (row === undefined) throw new Error(`Expected charge ${chargeId} in the account`);
    return row;
  }

  describe('child traceability', () => {
    it('carries both children of one family and attributes each charge to its own', async () => {
      const account = await read();

      expect(account.familyId).toBe(ledger.familyId);
      expect(account.charges).toHaveLength(5);

      // Balance is family-level and every charge identifies the child
      // (CLAUDE.md). The account is one family's and names two children in it.
      const byChild = new Map(account.charges.map((row) => [row.charge.id, row.child.id]));

      expect(byChild.get(ledger.reducedChargeId)).toBe(ledger.childAId);
      expect(byChild.get(ledger.voidedChargeId)).toBe(ledger.childAId);
      expect(byChild.get(ledger.restoredChargeId)).toBe(ledger.childBId);
      expect(byChild.get(ledger.waivedChargeId)).toBe(ledger.childBId);
      expect(byChild.get(ledger.freeChargeId)).toBe(ledger.childBId);

      // The charge's own snapshot and the joined child agree on every row: the
      // read model cannot print one child's name beside another child's money.
      for (const row of account.charges) {
        expect(row.child.id).toBe(row.charge.childId);
        expect(row.charge.familyId).toBe(ledger.familyId);
        expect(row.child.firstName).not.toBe('');
        expect(row.child.fileNumber).not.toBe('');
      }
    });

    it('prints the service and therapist a screen renders instead of uuids', async () => {
      const account = await read();
      const row = rowFor(account, ledger.reducedChargeId);

      expect(row.service.id).toBe(row.charge.serviceId);
      expect(row.service.name).not.toBe('');
      expect(row.therapist.id).toBe(row.charge.therapistId);
      expect(row.therapist.fullName).not.toBe('');
    });

    it('narrows to one child without collapsing the family it belongs to', async () => {
      const account = await read({ childId: ledger.childBId });

      expect(account.charges).toHaveLength(3);
      expect(account.charges.every((row) => row.child.id === ledger.childBId)).toBe(true);

      // Child B holds three of the family's five sessions, one of them free.
      expect(account.totals.chargedTotalToman).toBe('500000');
      expect(account.totals.adjustmentTotalToman).toBe('250000');
      expect(account.totals.netChargedTotalToman).toBe('250000');
      expect(account.totals.chargeCount).toBe(3);
      expect(account.totals.voidedChargeCount).toBe(0);

      // And child A's withdrawn charge is child A's: filtering to B removes it.
      const childA = await read({ childId: ledger.childAId });
      expect(childA.totals.chargedTotalToman).toBe('250000');
      expect(childA.totals.voidedChargeCount).toBe(1);
    });

    it('answers with an empty account for a child of another family', async () => {
      // A narrowing filter, not an authorisation: the family predicate stands
      // beside it, so a foreign child matches nothing and confirms nothing.
      const account = await read({ childId: uuidv7() });

      expect(account.charges).toHaveLength(0);
      expect(account.totals.chargedTotalToman).toBe('0');
      expect(account.totals.netChargedTotalToman).toBe('0');
      expect(account.page.total).toBe(0);
      expect(account.page.hasMore).toBe(false);
    });
  });

  describe('derived totals', () => {
    it('totals the whole family from the valid charges and the active concessions', async () => {
      const account = await read();

      // 250000 + 250000 + 250000 + 0, the withdrawn charge counted in neither sum.
      expect(account.totals.chargedTotalToman).toBe('750000');
      // 50000 on child A plus the 250000 waiver. The withdrawn concession and the
      // one attached to the withdrawn charge reduce nothing.
      expect(account.totals.adjustmentTotalToman).toBe('300000');
      expect(account.totals.netChargedTotalToman).toBe('450000');
      expect(account.totals.chargeCount).toBe(4);
      expect(account.totals.voidedChargeCount).toBe(1);
    });

    it('reduces the effective amount without touching what was charged', async () => {
      const { charge } = rowFor(await read(), ledger.reducedChargeId);

      // The original stands exactly as raised: a concession is a second row, and
      // a correction is never an edit (CLAUDE.md).
      expect(charge.amountToman).toBe('250000');
      expect(charge.activeAdjustmentTotalToman).toBe('50000');
      expect(charge.effectiveAmountToman).toBe('200000');
      expect(charge.voidedAt).toBeNull();
    });

    it('waives a PAID charge to zero and keeps it distinct from a free session', async () => {
      const account = await read();
      const waived = rowFor(account, ledger.waivedChargeId).charge;
      const free = rowFor(account, ledger.freeChargeId).charge;

      // Both display as zero and they are different facts. A waived session was
      // priced and somebody explained why the family is not paying it; a free one
      // was never priced at all (DECISION_LOG, 2026-08-06).
      expect(waived.effectiveAmountToman).toBe('0');
      expect(free.effectiveAmountToman).toBe('0');

      expect(waived.priceMode).toBe('PAID');
      expect(waived.amountToman).toBe('250000');
      expect(waived.adjustments).toHaveLength(1);
      expect(waived.adjustments[0]?.reason).not.toBe('');

      expect(free.priceMode).toBe('FREE');
      expect(free.amountToman).toBe('0');
      expect(free.adjustments).toHaveLength(0);
    });

    it('shows a withdrawn charge and counts it in nothing', async () => {
      const account = await read();
      const { charge } = rowFor(account, ledger.voidedChargeId);

      // Visible, and marked: a family asking what happened to a charge they were
      // shown gets the void, its instant, its actor and its reason.
      expect(charge.voidedAt).not.toBeNull();
      expect(charge.voidedByUserId).toBe(ledger.managerId);
      expect(charge.voidReason).not.toBeNull();

      // Its own arithmetic is still reported and still counts for nothing: the
      // four valid charges are the whole of `chargedTotalToman`.
      expect(charge.effectiveAmountToman).toBe('220000');
      expect(account.totals.chargedTotalToman).toBe('750000');
      expect(account.totals.chargeCount).toBe(4);
    });

    it('shows a withdrawn concession and restores what it had removed', async () => {
      const { charge } = rowFor(await read(), ledger.restoredChargeId);

      expect(charge.adjustments).toHaveLength(1);
      const withdrawn = charge.adjustments[0];

      expect(withdrawn?.id).toBe(ledger.voidedAdjustmentId);
      expect(withdrawn?.amountToman).toBe('100000');
      expect(withdrawn?.voidedAt).not.toBeNull();
      expect(withdrawn?.voidReason).not.toBeNull();

      // Withdrawn is exactly what it means: history stays, the reduction goes.
      expect(charge.activeAdjustmentTotalToman).toBe('0');
      expect(charge.effectiveAmountToman).toBe('250000');
    });

    it('counts a concession on a withdrawn charge in nothing, and still shows it', async () => {
      const account = await read();
      const { charge } = rowFor(account, ledger.voidedChargeId);

      const orphaned = charge.adjustments.find(
        (one) => one.id === ledger.adjustmentOnVoidedChargeId,
      );
      expect(orphaned?.amountToman).toBe('30000');
      // The concession itself was never withdrawn — only its parent was.
      expect(orphaned?.voidedAt).toBeNull();

      // And it reduces nothing, because the charge it reduces has no current
      // financial effect. 50000 + 250000, with the 30000 nowhere in it.
      expect(account.totals.adjustmentTotalToman).toBe('300000');
    });

    it('carries every amount as a canonical unsigned toman string', async () => {
      const account = await read();

      const amounts = [
        account.totals.chargedTotalToman,
        account.totals.adjustmentTotalToman,
        account.totals.netChargedTotalToman,
        ...account.charges.flatMap((row) => [
          row.charge.amountToman,
          row.charge.activeAdjustmentTotalToman,
          row.charge.effectiveAmountToman,
        ]),
      ];

      // Digits, no sign, no decimal point, no exponent — the wire format money
      // travels in, because a value above 2^53 is not a JSON number.
      for (const amount of amounts) expect(amount).toMatch(/^(?:0|[1-9]\d*)$/);
    });
  });

  describe('void visibility is not financial truth', () => {
    it('includes withdrawn history by default', async () => {
      const account = await read();

      // The approved default: financial history is visible unless somebody asks
      // to hide it (frozen F1).
      expect(account.charges.map((row) => row.charge.id)).toContain(ledger.voidedChargeId);
      expect(account.page.total).toBe(5);
    });

    it('hides withdrawn charges on request and changes no total', async () => {
      const shown = await read({ includeVoided: 'true' });
      const hidden = await read({ includeVoided: 'false' });

      expect(hidden.charges).toHaveLength(4);
      expect(hidden.charges.map((row) => row.charge.id)).not.toContain(ledger.voidedChargeId);
      expect(hidden.page.total).toBe(4);

      // The list is a different list. The money is the same money.
      expect(hidden.totals).toStrictEqual(shown.totals);
      expect(hidden.totals.voidedChargeCount).toBe(1);
    });

    it('refuses a spelling that is neither true nor false', async () => {
      // Not `z.coerce.boolean()`: `Boolean('no')` is `true`, and an account that
      // silently defaulted a mistyped filter would show the wrong history.
      await familyAccount(harness, ledger.managerToken, ledger.familyId, {
        includeVoided: 'no',
      }).expect(400);
    });
  });

  describe('filters', () => {
    it('bounds the account by the day the session happened', async () => {
      const first = await read({ from: SATURDAY, to: SATURDAY });

      expect(first.charges).toHaveLength(3);
      expect(first.charges.every((row) => row.charge.serviceDate === SATURDAY)).toBe(true);
      expect(first.totals.chargedTotalToman).toBe('500000');
      expect(first.totals.adjustmentTotalToman).toBe('50000');
      expect(first.totals.netChargedTotalToman).toBe('450000');
      expect(first.totals.chargeCount).toBe(3);
      expect(first.totals.voidedChargeCount).toBe(0);

      const second = await read({ from: NEXT_SATURDAY, to: NEXT_SATURDAY });

      expect(second.charges).toHaveLength(2);
      expect(second.totals.chargedTotalToman).toBe('250000');
      expect(second.totals.adjustmentTotalToman).toBe('250000');
      expect(second.totals.netChargedTotalToman).toBe('0');
      expect(second.totals.chargeCount).toBe(1);
      expect(second.totals.voidedChargeCount).toBe(1);
    });

    it('applies the date bounds inclusively at both ends', async () => {
      const whole = await read({ from: SATURDAY, to: NEXT_SATURDAY });

      expect(whole.charges).toHaveLength(5);
      expect(whole.totals.chargedTotalToman).toBe('750000');
    });

    it('applies a child and a date filter together, to the rows and to the totals', async () => {
      const account = await read({ childId: ledger.childBId, from: SATURDAY, to: SATURDAY });

      expect(account.charges).toHaveLength(2);
      expect(account.totals.chargedTotalToman).toBe('250000');
      expect(account.totals.adjustmentTotalToman).toBe('0');
      expect(account.totals.chargeCount).toBe(2);
    });

    it('refuses a filter the frozen query does not define', async () => {
      // `strictObject`: an unknown parameter is a refusal, not something quietly
      // ignored that would return an account nobody asked for.
      await familyAccount(harness, ledger.managerToken, ledger.familyId, {
        therapistId: uuidv7(),
      }).expect(400);
    });
  });

  describe('pagination', () => {
    it('states the page, the total and hasMore correctly', async () => {
      const first = await read({ page: 1, pageSize: 2 });

      expect(first.page).toStrictEqual({ page: 1, pageSize: 2, total: 5, hasMore: true });
      expect(first.charges).toHaveLength(2);

      const last = await read({ page: 3, pageSize: 2 });

      expect(last.page).toStrictEqual({ page: 3, pageSize: 2, total: 5, hasMore: false });
      expect(last.charges).toHaveLength(1);

      const beyond = await read({ page: 4, pageSize: 2 });

      expect(beyond.charges).toHaveLength(0);
      expect(beyond.page.hasMore).toBe(false);
      expect(beyond.page.total).toBe(5);
    });

    it('keeps the totals identical on every page', async () => {
      const whole = await read();
      const pages = await Promise.all(
        [1, 2, 3, 4].map(async (page) => read({ page, pageSize: 2 })),
      );

      for (const page of pages) expect(page.totals).toStrictEqual(whole.totals);
    });

    it('pages deterministically, with every charge on exactly one page', async () => {
      const paged = await Promise.all([1, 2, 3].map(async (page) => read({ page, pageSize: 2 })));
      const ids = paged.flatMap((page) => page.charges.map((row) => row.charge.id));

      expect(ids).toHaveLength(5);
      expect(new Set(ids).size).toBe(5);

      // The same request twice is the same page in the same order: the order is
      // service date, then when the charge was raised, then the id.
      const again = await read({ page: 1, pageSize: 2 });
      expect(again.charges.map((row) => row.charge.id)).toStrictEqual(
        paged[0]?.charges.map((row) => row.charge.id),
      );
    });

    it('returns the newest session first', async () => {
      const dates = (await read()).charges.map((row) => row.charge.serviceDate);

      expect(dates).toStrictEqual([...dates].sort().reverse());
      expect(dates[0]).toBe(NEXT_SATURDAY);
    });

    it('refuses a page size beyond the frozen ceiling', async () => {
      await familyAccount(harness, ledger.managerToken, ledger.familyId, {
        pageSize: 101,
      }).expect(400);
    });
  });

  describe('authorisation and privacy', () => {
    it('lets a receptionist read the account', async () => {
      // `charge.read` is held by both roles. Reading what a family owes is the
      // desk work a receptionist does all day; withdrawing and reducing a charge
      // stay with the manager and are not this route.
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const account = await read({}, receptionist.token);

      expect(account.totals.netChargedTotalToman).toBe('450000');
    });

    it('refuses a caller without a session', async () => {
      await familyAccount(harness, 'not-a-session-token', ledger.familyId).expect(401);
    });

    it('answers 404 for a family that does not exist', async () => {
      const response = await familyAccount(harness, ledger.managerToken, uuidv7()).expect(404);

      expect(response.body.error.code).toBe('FAMILY_NOT_FOUND');
    });

    it('writes no audit row for a read', async () => {
      const before = await harness.prisma.auditLog.count();

      await read();
      await read({ includeVoided: 'false' });

      // `audit_log` is append-only and permanent. Copying a financial read into
      // it would build a second, undeletable store of who was treated and for how
      // much, growing with every screen refresh.
      expect(await harness.prisma.auditLog.count()).toBe(before);
    });

    it('forbids the response from being cached', async () => {
      const response = await familyAccount(harness, ledger.managerToken, ledger.familyId).expect(
        200,
      );

      expect(response.headers['cache-control']).toMatch(/no-store/);
    });
  });

  /**
   * ONE RESPONSE, ONE DATABASE MOMENT.
   *
   * The read is four statements. Under the default `READ COMMITTED` each takes
   * its own snapshot, so a concession committed between the totals and the page
   * lands in one and not the other, and the family is shown a net amount that
   * does not follow from the rows printed beneath it. The account is read under
   * `REPEATABLE READ` for exactly this reason (`FamilyAccountService.account`).
   *
   * WHAT IS ASSERTED IS THE INVARIANT, NOT THE INTERLEAVING. A race that happens
   * not to interleave still passes, which is why the deterministic half of this
   * proof — that the transaction is opened, declares `REPEATABLE READ` and that
   * no statement escapes it — lives in `family-account-snapshot.spec.ts`. This
   * suite asserts the property that matters to a reader: whatever the writers
   * did, the response adds up.
   */
  describe('snapshot consistency', () => {
    /** Every total the response states, recomputed from the rows it returned. */
    function expectSelfConsistent(account: FamilyAccountResponse): void {
      // The page is wide enough to hold the whole account, so the rows ARE the
      // filtered set and the totals must follow from them exactly.
      expect(account.charges).toHaveLength(account.page.total);

      const valid = account.charges.filter((row) => row.charge.voidedAt === null);
      const voided = account.charges.filter((row) => row.charge.voidedAt !== null);

      const sum = (amounts: readonly string[]): string =>
        amounts.reduce((total, one) => total + BigInt(one), 0n).toString();

      expect(account.totals.chargedTotalToman).toBe(
        sum(valid.map((row) => row.charge.amountToman)),
      );
      expect(account.totals.adjustmentTotalToman).toBe(
        sum(valid.map((row) => row.charge.activeAdjustmentTotalToman)),
      );
      expect(account.totals.netChargedTotalToman).toBe(
        (
          BigInt(account.totals.chargedTotalToman) - BigInt(account.totals.adjustmentTotalToman)
        ).toString(),
      );
      expect(account.totals.chargeCount).toBe(valid.length);
      expect(account.totals.voidedChargeCount).toBe(voided.length);
    }

    it('adds up when nothing else is happening', async () => {
      expectSelfConsistent(await read({ pageSize: 100 }));
    });

    it('adds up while a manager writes against the same family', async () => {
      // A concession is the write that would tear a `READ COMMITTED` response in
      // half: it changes `adjustmentTotalToman` in the aggregate AND the
      // adjustment rows the page carries, so a snapshot taken twice can show a
      // total that no row on the page accounts for.
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const [account] = await Promise.all([
          read({ pageSize: 100 }),
          adjustOverHttp(harness, ledger.managerToken, ledger.reducedChargeId, '1000').expect(200),
        ]);

        expectSelfConsistent(account);
      }
    });

    it('adds up while a charge is being withdrawn', async () => {
      const [account] = await Promise.all([
        read({ pageSize: 100 }),
        // The other transition that moves a row between the two counts and out
        // of both sums at once.
        harness.prisma.$executeRaw`
          UPDATE session_charge
             SET voided_at = transaction_timestamp(),
                 voided_by_user_id = ${ledger.managerId}::uuid,
                 void_reason = 'ابطال همزمان آزمایشی'
           WHERE id = ${ledger.waivedChargeId}::uuid AND voided_at IS NULL
        `,
      ]);

      expectSelfConsistent(account);

      // And the void is genuinely visible afterwards, so the assertion above was
      // made against a database that really did change under the read.
      const after = await read({ pageSize: 100 });
      expect(after.totals.voidedChargeCount).toBe(2);
      expectSelfConsistent(after);
    });
  });
});
