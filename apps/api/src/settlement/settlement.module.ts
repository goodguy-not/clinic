import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SessionRatingsController } from './ratings/session-ratings.controller';
import { SessionRatingService } from './ratings/session-rating.service';
import { ShareRulesController } from './share-rules/share-rules.controller';
import { ShareRulesService } from './share-rules/share-rules.service';
import { SettlementCloseService } from './close/settlement-close.service';
import { SettlementPeriodsController } from './close/settlement-periods.controller';
import { SettlementStatementController } from './statement/settlement-statement.controller';
import { SettlementStatementExportService } from './statement/settlement-statement-export.service';
import { SettlementStatementService } from './statement/settlement-statement.service';

/**
 * Therapist settlement.
 *
 * This module owns two tables and is the only code that queries either. They
 * are two different KINDS of thing and the milestone rests on not blurring
 * them:
 *
 *   * `therapist_share_rule` is CONFIGURATION — what a therapist was agreed to
 *     take, and between which dates (checkpoint C2).
 *   * `session_settlement` is HISTORICAL FACT — what one session actually
 *     earned, snapshotted at the instant somebody rated it and never
 *     re-resolved (checkpoint C3).
 *
 * C5 ADDS A THIRD PROVIDER AND NO THIRD TABLE. `SettlementStatementService`
 * READS the two above — plus the ledger's charges and concessions — and stores
 * nothing: no settlement period, no settlement line, no aggregate and no cached
 * total. It is the first code in the product that reads a rating in bulk, and it
 * deliberately does not import `share-rule-resolution`: a statement reports the
 * percentage that was APPLIED, never one resolved from today's configuration.
 *
 * C6 ADDS THE TWO TABLES THAT MAKE A FIGURE FINAL. `settlement_period` is the
 * ACT of closing one therapist's range, and `settlement_line` is the per-session
 * fact that act materialised — the first rows in this milestone that are
 * COPIED rather than derived, because a closed figure must keep saying what it
 * said. `SettlementCloseService` owns both, and `settlement-facts.ts` is the ONE
 * derivation of "what is this session worth now, and how much of that is already
 * closed?", shared by the close and the statement so the two can never disagree.
 *
 * Nothing here records a payout or writes anything about money leaving the
 * clinic. There is no therapist ledger, no payable, no receivable and no
 * balance: this milestone records what was EARNED and what has been SETTLED, and
 * `settled` means "closed off in a period", never "paid".
 *
 * C8 ADDS A FILE AND NO TABLE, NO FIGURE AND NO SEMANTIC.
 * `SettlementStatementExportService` is the statement asked for as a CSV: it
 * borrows the Milestone 7 export machinery whole (`reports/csv-export.ts`,
 * `reports/report-csv.ts`), reads its rows from `SettlementStatementService`
 * itself and computes nothing. The only row it writes is the one
 * `report.exported` audit row that records the ACT of data leaving the building
 * — never any value from the file, never the colleague's name, never a
 * percentage and never an amount.
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
  controllers: [
    ShareRulesController,
    SessionRatingsController,
    SettlementStatementController,
    SettlementPeriodsController,
  ],
  providers: [
    ShareRulesService,
    SessionRatingService,
    SettlementStatementService,
    SettlementStatementExportService,
    SettlementCloseService,
  ],
  exports: [SessionRatingService],
})
export class SettlementModule {}
