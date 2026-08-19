import { z } from 'zod';

/**
 * The vocabulary every Milestone 8 settlement contract is spoken in.
 *
 * WHAT MILESTONE 8 IS. The clinic's first answer to "what did this therapist
 * earn?" — a per-session, historically snapshotted share of the work that
 * happened, closed off over an explicit period. CLAUDE.md fixes the domain
 * rules; this checkpoint fixes the WORDS, so the backend and the web tier can
 * be built against the same ones without either re-deriving a financial rule.
 *
 * NOTHING IN THIS DIRECTORY CALCULATES ANYTHING. There is no arithmetic in this
 * package at all (`index.ts` — schemas, types and constants), and CLAUDE.md
 * forbids the web tier from computing a therapist share or a settlement figure
 * under any circumstances. Every amount below is a value the NestJS settlement
 * service STATES; a browser renders it.
 *
 * THE FIVE RULES THESE SHAPES EXIST TO KEEP UNAMBIGUOUS:
 *
 *   1. THE BASIS IS THE PRE-DISCOUNT CHARGE. A therapist's share is worked out
 *      from `session_charge.amountToman` as it was posted — the immutable
 *      snapshot — never from the family's effective amount after concessions
 *      and never from what the family actually paid. Settlement is independent
 *      of payment (CLAUDE.md), so a family who has not paid changes no figure
 *      here.
 *   2. THE APPLIED PERCENTAGE IS A HISTORICAL SNAPSHOT. It is copied onto the
 *      session when the session is rated and never re-resolved afterwards, so a
 *      share rule changed next month cannot rewrite last month's earnings.
 *   3. UNRATED IS A STATE, NOT A ZERO. A session nobody has rated has NO
 *      settlement fact, and the absence is reported as an exception COUNT. A
 *      zero would be indistinguishable from a therapist who genuinely earned
 *      nothing on that session, and it is the one confusion that quietly
 *      under-pays somebody.
 *   4. FREE IS NOT UNRATED AND NOT DISCOUNTED-TO-ZERO. A `FREE` session earns
 *      zero and is a rated fact; a `PAID` session waived to nothing earns on
 *      its pre-discount basis and the concession is allocated. `priceMode`
 *      already separates them at source (`catalog/tariffs.ts`) and nothing here
 *      re-infers either from an amount.
 *   5. A CLOSED PERIOD IS IMMUTABLE. It is never reopened, and a correction to
 *      something inside one is carried into a later period as its own line.
 *
 * NO PAYOUT VOCABULARY ANYWHERE (the frozen Milestone 8 terminology decision).
 * This milestone records what was EARNED and what has been SETTLED; it does not
 * record money leaving the clinic, and there is no therapist ledger, no
 * outstanding position and no running total of what is unpaid. So no field
 * anywhere in this directory is named `owed`, `payable`, `receivable`, `due` or
 * `balance` — a name that implies a money-out ledger is a liability modelled by
 * accident, and the first person to read it as one will be a therapist. The
 * accepted names are `earnedUnsettledToman`, `settledToman` and
 * `netSettlementToman`. The restriction is settlement-specific: the family
 * ledger keeps its own vocabulary, where a balance is a real balance.
 */

/**
 * A therapist's share, in BASIS POINTS: hundredths of one percent, 0 to 10000
 * inclusive.
 *
 * AN INTEGER, AND THE UNIT IS IN THE NAME. `sharePercent: 42.5` is the shape
 * this exists to make unreachable. A percentage carried as a floating-point
 * number is a money bug waiting for a session priced at an awkward amount: the
 * error is tiny, it accumulates over a month of sessions, and it is discovered
 * by the therapist whose settlement is a few hundred toman short. Basis points
 * let every agreement the clinic actually makes — 40%, 42.5%, two thirds
 * rounded to 66.67% — be stated exactly as a whole number, and the arithmetic
 * that uses them stays integer arithmetic over `BigInt` from end to end.
 *
 * `shareBasisPoints`, NEVER `sharePercent` OR `shareRate`. A number without its
 * unit in its name is the other half of the same bug: 40 means one thing as a
 * percentage and a completely different one as basis points, and both are
 * plausible readings of `share: 40`.
 *
 * 0 AND 10000 ARE BOTH LEGITIMATE. Zero is a therapist who takes no share of
 * this work — salaried cover, a complimentary programme the clinic funds — and
 * 10000 is an arrangement where the whole session value is theirs. Neither is a
 * sentinel: an UNRATED session has no share at all rather than a share of zero
 * (rule 3 above), which is why absence and zero are different SHAPES here and
 * not different values of one field.
 */
export const SHARE_BASIS_POINTS_MAX = 10000;

export const shareBasisPointsSchema = z
  .number()
  .int('a share must be a whole number of basis points')
  .min(0)
  .max(SHARE_BASIS_POINTS_MAX);

export type ShareBasisPoints = z.infer<typeof shareBasisPointsSchema>;

/**
 * HOW A SESSION'S VALUE IS SPLIT, STATED HERE SO NO LATER CHECKPOINT CAN
 * REINTERPRET IT.
 *
 * This is documentation and a pinned test, not an implementation: nothing in
 * this package computes money (see the header). The rule is:
 *
 *   therapistGross = round_half_up(baseAmount * shareBasisPoints / 10000)
 *   clinicGross    = baseAmount - therapistGross          // the exact residual
 *
 * ROUNDED HALF-UP TO WHOLE TOMAN, because toman is the approved unit and there
 * is no sub-unit to carry a remainder in (CLAUDE.md — money uses integer
 * storage in one approved unit). Half-up rather than half-even: it is the rule
 * a person checking the figure by hand applies, and a settlement number that
 * disagrees with the therapist's own arithmetic by one toman costs more to
 * explain than banker's rounding saves in aggregate.
 *
 * THE CLINIC TAKES THE RESIDUAL, AND THAT IS WHY IT IS NOT ROUNDED SEPARATELY.
 * Rounding both halves independently makes them sum to one toman more or less
 * than the session was worth, and the missing toman surfaces in a report that
 * has to balance. Exactly one side is rounded — the therapist's, because that
 * is the side somebody is owed a whole number of — and the clinic absorbs the
 * remainder by construction, so
 * `therapistGrossToman + clinicGrossToman === baseAmountToman` holds for every
 * session with no tolerance and no reconciliation step.
 *
 * THE ARITHMETIC IS INTEGER ARITHMETIC OVER `BigInt`, never floating point:
 * `(base * bp + 5000n) / 10000n`, which is exact. A base amount is never
 * negative, so no negative-half-up case exists and no sign convention has to be
 * chosen.
 *
 * `settlement-contracts.spec.ts` pins the rule with worked examples, so an
 * implementation that reaches for `Math.round((base * bp) / 10000)` — a
 * different answer above 2^53, and a different answer on a .5 that floating
 * point represents as slightly under — fails a test rather than a therapist's
 * month.
 */
export const SHARE_ROUNDING = 'HALF_UP';

/**
 * A recorded reason on a settlement act.
 *
 * The same shape as `ledgerReasonSchema`, restated rather than imported for the
 * reason that one restates `catalogReasonSchema`: a change to how a concession
 * explains itself must not silently change how a settlement correction does.
 * Required everywhere it appears — CLAUDE.md requires every settlement override
 * and correction to be explicit, reasoned and auditable.
 */
export const settlementReasonSchema = z.string().trim().min(1).max(500);

export type SettlementReason = z.infer<typeof settlementReasonSchema>;

/**
 * HOW THE RATING ACT HAPPENED — AND NOTHING ABOUT WHERE THE PERCENTAGE CAME
 * FROM, BECAUSE THERE IS ONLY ONE PLACE IT EVER COMES FROM.
 *
 *   * `AUTOMATIC` — the session was rated by the server in the same transaction
 *     that posted its charge.
 *   * `EXPLICIT` — a manager rated the session afterwards, with a reason,
 *     because no rule covered its service date at the moment it was charged (or
 *     because an earlier rating was corrected).
 *
 * BOTH RESOLVE THE SAME PERCENTAGE FROM THE SAME PLACE: the therapist's
 * effective-dated share rule covering the charge's SERVICE DATE. There is no
 * per-session override rate in this product and no way to type a percentage
 * onto one session — the share rule is the only source of settlement policy,
 * and correcting one is how a percentage changes. So `appliedShareRuleId` is
 * present on EVERY rating, whichever member this field carries.
 *
 * THIS IS NOT AN OVERRIDE FLAG. It answers "was this session rated as part of
 * charging it, or picked up later by hand?" — which is the question that finds
 * sessions that fell through a configuration gap, and it is a question about
 * process rather than about money. An `EXPLICIT` rating is not worth less and
 * is not suspect; it is the recovery path working.
 *
 * RECORDED RATHER THAN INFERRED FROM WHETHER A RULE HAPPENS TO MATCH TODAY.
 * Rules are effective-dated and can be voided and replaced, so any question
 * reconstructed from today's configuration has an answer that changes after the
 * fact.
 *
 * NEITHER MEMBER IS SUBMITTABLE. A caller never chooses this: the posting path
 * writes `AUTOMATIC` and every manager-initiated rating writes `EXPLICIT`, so
 * the field cannot disagree with what actually happened (`ratings.ts`).
 *
 * NEITHER MEMBER MEANS UNRATED. An unrated session has no settlement fact and
 * therefore no `ratedVia` at all (rule 3 in the header).
 */
export const RATED_VIA = ['AUTOMATIC', 'EXPLICIT'] as const;

export type RatedVia = (typeof RATED_VIA)[number];

export const ratedViaSchema = z.enum(RATED_VIA);

/**
 * WHAT A LINE IN A SETTLEMENT STATEMENT IS.
 *
 *   * `PRIMARY` — the ordinary settlement of a session that happened inside the
 *     period being read.
 *   * `CORRECTION` — the delta of a rating that was withdrawn and replaced
 *     AFTER the period it belonged to had been closed. A closed period is
 *     immutable and is never reopened, so the correction cannot be written back
 *     into it; it lands in the first period still open, carrying a pointer to
 *     the session it corrects.
 *
 * TWO MEMBERS RATHER THAN A BOOLEAN, and a line type rather than a separate
 * response section, because a reader adding up a statement has to see both
 * kinds in one column: a month whose corrections were reported elsewhere is a
 * month whose printed total is not the amount settled. The pointer on the row
 * is what lets somebody ask which session a correction belongs to, without the
 * statement having to carry last month's figures again.
 */
export const SETTLEMENT_LINE_TYPES = ['PRIMARY', 'CORRECTION'] as const;

export type SettlementLineType = (typeof SETTLEMENT_LINE_TYPES)[number];

export const settlementLineTypeSchema = z.enum(SETTLEMENT_LINE_TYPES);
