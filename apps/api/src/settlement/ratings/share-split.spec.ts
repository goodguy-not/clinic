import { SHARE_ROUNDING } from '@clinic/contracts';
import { splitSessionValue } from './share-split';

/**
 * The frozen split rule, exercised against the implementation that writes it
 * onto a session.
 *
 * `common/settlement-contracts.spec.ts` pins the SAME worked examples against a
 * local restatement of the arithmetic, because checkpoint C1 had no
 * implementation to point at. This suite pins the implementation, so the two
 * agree by test rather than by intention — and `session_settlement_split_chk`
 * re-derives it a third time in PostgreSQL, which is what makes a disagreement
 * an unwritable row rather than a wrong settlement.
 *
 * Every amount here is synthetic.
 */
describe('the therapist share split', () => {
  const split = (base: string, bp: number) => {
    const result = splitSessionValue(BigInt(base), bp);
    return {
      therapistGrossToman: result.therapistGrossToman.toString(),
      clinicGrossToman: result.clinicGrossToman.toString(),
    };
  };

  it('is half-up, not half-even and not truncated', () => {
    expect(SHARE_ROUNDING).toBe('HALF_UP');

    // 12345 * 50% = 6172.5 -> 6173, and the clinic takes 6172. Half-even would
    // give 6172, truncation 6172; both are the answer a therapist checking by
    // hand does not get.
    expect(split('12345', 5000)).toEqual({
      therapistGrossToman: '6173',
      clinicGrossToman: '6172',
    });

    // 12347 * 50% = 6173.5 -> 6174. Half-even would round to the even 6174 here
    // and to 6172 above; the two rules only agree by accident.
    expect(split('12347', 5000)).toEqual({
      therapistGrossToman: '6174',
      clinicGrossToman: '6173',
    });
  });

  it('gives the clinic the exact residual, so the two halves always sum to the base', () => {
    for (const base of ['0', '1', '7', '12345', '250000', '999999999']) {
      for (const bp of [0, 1, 3333, 4250, 5000, 6667, 9999, 10000]) {
        const { therapistGrossToman, clinicGrossToman } = split(base, bp);

        expect((BigInt(therapistGrossToman) + BigInt(clinicGrossToman)).toString()).toBe(base);
        expect(BigInt(therapistGrossToman) >= 0n).toBe(true);
        expect(BigInt(clinicGrossToman) >= 0n).toBe(true);
      }
    }
  });

  it('gives the whole session to one side at the two bounds', () => {
    // Neither bound is a sentinel: zero is a therapist who takes no share of
    // this work, and 10000 is an arrangement where the whole session is theirs.
    expect(split('250000', 0)).toEqual({ therapistGrossToman: '0', clinicGrossToman: '250000' });
    expect(split('250000', 10000)).toEqual({
      therapistGrossToman: '250000',
      clinicGrossToman: '0',
    });
  });

  it('earns nothing from a session that was worth nothing', () => {
    // A FREE session. It is a RATED fact — the row exists — and the amounts are
    // zero; an unrated session has no row at all.
    expect(split('0', 4000)).toEqual({ therapistGrossToman: '0', clinicGrossToman: '0' });
  });

  it('stays exact where a JS number would not', () => {
    // `Math.round((base * bp) / 10000)` is a different answer here, and the
    // difference is silent.
    expect(split('90071992547409910', 5000).therapistGrossToman).toBe('45035996273704955');
  });
});
