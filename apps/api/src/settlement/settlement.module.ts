import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ShareRulesController } from './share-rules/share-rules.controller';
import { ShareRulesService } from './share-rules/share-rules.service';

/**
 * Therapist settlement.
 *
 * At checkpoint C2 this module owns exactly one table — `therapist_share_rule`
 * — and is the only code that queries it. The rule is CONFIGURATION: what a
 * therapist was agreed to take, and when. Nothing here records what a session
 * earned, closes a period, produces a statement or writes anything about money
 * leaving the clinic; those are later checkpoints, and each brings its own
 * table, service and permission enforcement.
 *
 * `AuditModule` is imported because every write here is audited in the same
 * transaction as the state change it records.
 *
 * The module exports its service so a later checkpoint can resolve a share rule
 * while rating a session, in that transaction, rather than re-implementing the
 * resolution rule beside it. One statement of "which percentage applied on this
 * date", so the endpoint's answer and a snapshot's cannot diverge.
 */
@Module({
  imports: [AuditModule],
  controllers: [ShareRulesController],
  providers: [ShareRulesService],
  exports: [ShareRulesService],
})
export class SettlementModule {}
