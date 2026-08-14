import { Injectable } from '@nestjs/common';
import type { PostSessionChargeResponse } from '@clinic/contracts';
import { AppError } from '../common/app-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { ChargePostingService } from './charge-posting.service';

/**
 * The explicit, operator-initiated post.
 *
 * IT OWNS THE TRANSACTION AND NOTHING ELSE. Every rule — the two facts, the
 * lock, the idempotent answer, the tariff, the snapshot, the audit row — belongs
 * to `ChargePostingService` and is not restated here. What this class adds is the
 * transaction boundary the lifecycle callers already have, and the translation
 * from the two declining outcomes into the refusals an operator sees.
 *
 * THIS IS THE RECOVERY PATH, and there are two things to recover from. A session
 * completed while its service had no applicable tariff is completed, attended and
 * unpriced: a manager records the tariff and posts the charge from here. A charge
 * raised wrongly is voided (checkpoint A4) and re-raised from here — which works
 * because `session_charge_one_valid_per_participant_uq` is partial on
 * `voided_at IS NULL`, so the withdrawn row leaves the index and stays in the
 * table.
 *
 * A REFUSAL ROLLS THE TRANSACTION BACK, and there is nothing in it to lose:
 * nothing was written before the decision. `TARIFF_MISSING` here is deliberately
 * an error rather than the silence the automatic path answers with — a person
 * asked for this charge to exist now, and telling them nothing happened without
 * saying why is the failure mode PROJECT_SPEC.md 5 requires a visible pricing
 * error instead of.
 *
 * A RETRY IS NOT A REFUSAL. A second post against a seat that already has a valid
 * charge is `ALREADY_POSTED` with that charge, never
 * `CHARGE_EXISTS_FOR_PARTICIPANT`: the request asked for the session to be
 * charged and it is, so nothing was refused (CLAUDE.md — retries are idempotent).
 */
@Injectable()
export class SessionChargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: ChargePostingService,
  ) {}

  async post(
    participantId: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<PostSessionChargeResponse> {
    return this.prisma.$transaction(async (tx) => {
      const attempt = await this.posting.post(tx, {
        participantId,
        actor,
        context,
        trigger: 'EXPLICIT_REPOST',
      });

      switch (attempt.status) {
        case 'POSTED':
          return { outcome: 'POSTED' as const, charge: attempt.charge };
        case 'ALREADY_POSTED':
          return { outcome: 'ALREADY_POSTED' as const, charge: attempt.charge };
        // The session was not completed, or this child did not attend it. One
        // code for both, because the caller's fix is the same: record what
        // actually happened to the session first.
        case 'NOT_ELIGIBLE':
          throw new AppError('CHARGE_NOT_ELIGIBLE');
        // Reused rather than duplicated as a charge-shaped variant: a date no
        // tariff covers is the same fact whether it is met while pricing or
        // while charging, and one code keeps one Persian message and one fix.
        case 'TARIFF_MISSING':
          throw new AppError('TARIFF_MISSING');
      }
    });
  }
}
