import { Prisma } from '@prisma/client';
import type { FamilyAccountQuery } from '@clinic/contracts';
import type { PrismaService } from '../prisma/prisma.service';
import { FamilyAccountService } from './family-account.service';

/**
 * The family account is read under ONE snapshot, on purpose.
 *
 * WHY THIS IS A UNIT TEST AND NOT A RACE. The integration suite asserts that a
 * response is internally coherent while a manager writes against the same family,
 * and it should — but a race that passes proves only that this run did not
 * interleave. What has to be true regardless of timing is that the read declares
 * `REPEATABLE READ` and that every statement goes through that transaction, and
 * both of those are statements about the code that can be checked exactly.
 *
 * THE SECOND ASSERTION IS THE ONE THAT ROTS QUIETLY. A helper added later that
 * reaches for `this.prisma` instead of the `tx` handle opens a second connection
 * with a second snapshot, and the response silently goes back to describing two
 * different databases — with no test failing, because the totals still add up
 * most of the time. So the fake refuses to answer on the client at all.
 */
describe('family account snapshot', () => {
  const query: FamilyAccountQuery = {
    page: 1,
    pageSize: 25,
    includeVoided: true,
    childId: undefined,
    from: undefined,
    to: undefined,
  };

  /**
   * A Prisma stand-in that records how it was used.
   *
   * `$queryRaw` answers from a queue in the order the service asks: the family,
   * the filtered totals, the page, and then the four the position is derived
   * from — the whole family's charges, its payments, its latest payment and its
   * promise counts. The page comes back empty, which is why no statement for the
   * page's adjustments is expected.
   *
   * THE POSITION'S CHARGE AGGREGATE IS A SECOND STATEMENT, NOT THE FIRST ONE
   * REUSED. The totals are filter-scoped and the position is the whole family
   * (frozen F1); the queue below is what says the service really does ask twice,
   * with two narrowings, even when this query happens to carry no filter.
   */
  function fakePrisma() {
    const totals = {
      charged_total: 0n,
      adjustment_total: 0n,
      charge_count: 0,
      voided_charge_count: 0,
    };

    const answers: unknown[][] = [
      [{ id: '00000000-0000-7000-8000-000000000001' }],
      [totals],
      [],
      [totals],
      [{ paid_total: 0n, payment_count: 0, voided_payment_count: 0 }],
      [],
      [{ open_count: 0, missed_count: 0 }],
    ];

    const state = {
      isolationLevel: undefined as string | undefined,
      transactions: 0,
      onTransaction: 0,
      onClient: 0,
    };

    const tx = {
      $queryRaw: () => {
        state.onTransaction += 1;
        return Promise.resolve(answers.shift() ?? []);
      },
    };

    const prisma = {
      $queryRaw: () => {
        state.onClient += 1;
        return Promise.resolve([]);
      },
      $transaction: (
        run: (client: typeof tx) => Promise<unknown>,
        options?: { isolationLevel?: string },
      ) => {
        state.transactions += 1;
        state.isolationLevel = options?.isolationLevel;
        return run(tx);
      },
    };

    return { prisma: prisma as unknown as PrismaService, state };
  }

  it('reads the whole account inside one REPEATABLE READ transaction', async () => {
    const { prisma, state } = fakePrisma();

    await new FamilyAccountService(prisma).account('00000000-0000-7000-8000-000000000001', query);

    expect(state.transactions).toBe(1);
    // Not the default READ COMMITTED, under which the totals and the rows would
    // each take their own snapshot, and not SERIALIZABLE, which would let a read
    // that decides nothing fail with 40001.
    expect(state.isolationLevel).toBe(Prisma.TransactionIsolationLevel.RepeatableRead);
  });

  it('issues every statement on the transaction and none on the client', async () => {
    const { prisma, state } = fakePrisma();

    await new FamilyAccountService(prisma).account('00000000-0000-7000-8000-000000000001', query);

    // The family, the filtered totals, the page, and the position's four. A
    // statement outside the transaction would be a second snapshot, which is the
    // whole defect this guards — and the position is the read that most needs
    // it, because its charges and its payments are counted separately and must
    // still subtract to the amount the family is quoted.
    expect(state.onTransaction).toBe(7);
    expect(state.onClient).toBe(0);
  });
});
