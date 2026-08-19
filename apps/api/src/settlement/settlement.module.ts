import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SessionRatingsController } from './ratings/session-ratings.controller';
import { SessionRatingService } from './ratings/session-rating.service';
import { ShareRulesController } from './share-rules/share-rules.controller';
import { ShareRulesService } from './share-rules/share-rules.service';

/**
 * Therapist settlement.
 *
 * At checkpoint C3 this module owns two tables and is the only code that
 * queries either. They are two different KINDS of thing and the milestone rests
 * on not blurring them:
 *
 *   * `therapist_share_rule` is CONFIGURATION — what a therapist was agreed to
 *     take, and between which dates (checkpoint C2).
 *   * `session_settlement` is HISTORICAL FACT — what one session actually
 *     earned, snapshotted at the instant somebody rated it and never
 *     re-resolved (checkpoint C3).
 *
 * Nothing here closes a period, produces a statement, allocates a concession
 * between the two sides or writes anything about money leaving the clinic; those
 * are later checkpoints, and each brings its own table, service and permission
 * enforcement.
 *
 * `AuditModule` is imported because every write here is audited in the same
 * transaction as the state change it records.
 *
 * `SessionRatingService` IS EXPORTED AND `ShareRulesService` IS NOT. The ledger
 * has to rate a session inside the transaction that posts its charge, and to
 * withdraw a rating inside the transaction that voids one, so that routine
 * crosses the module boundary; nothing outside this module needs to write a
 * share RULE, and the resolution both paths share is a plain function
 * (`share-rule-resolution.ts`) rather than a provider — one statement of "which
 * percentage applied on this date", so the endpoint's answer and a snapshot's
 * cannot diverge.
 *
 * THE DEPENDENCY POINTS ONE WAY: `LedgerModule` imports this module, and this
 * module imports nothing of the ledger's beyond two plain read helpers from
 * `charge-detail.ts`. No cycle exists, and the rating service cannot reach a
 * charge-posting rule.
 */
@Module({
  imports: [AuditModule],
  controllers: [ShareRulesController, SessionRatingsController],
  providers: [ShareRulesService, SessionRatingService],
  exports: [SessionRatingService],
})
export class SettlementModule {}
