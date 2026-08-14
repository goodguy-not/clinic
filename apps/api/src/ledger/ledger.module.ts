import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ChargeAdjustmentsController } from './charge-adjustments.controller';
import { ChargeAdjustmentsService } from './charge-adjustments.service';
import { ChargeLifecycleGuard } from './charge-lifecycle-guard';
import { ChargePostingService } from './charge-posting.service';
import { FamilyAccountController } from './family-account.controller';
import { FamilyAccountService } from './family-account.service';
import { SessionChargesController } from './session-charges.controller';
import { SessionChargesService } from './session-charges.service';

/**
 * The ledger: the money one completed, attended session cost one family.
 *
 * It owns `session_charge` and `charge_adjustment` and is the only code that
 * writes them. It READS `appointment`, `appointment_participant`, `child` and
 * `tariff` — for the two eligibility facts, the family the charged child belongs
 * to, the delivered snapshot and the price in force on the service date — and
 * writes nothing in any of them. `AppointmentsModule` owns those tables and
 * keeps owning them; this module never changes a status or an attendance.
 *
 * `ChargePostingService` IS EXPORTED AND NEITHER `SessionChargesService` NOR
 * `ChargeAdjustmentsService` IS. The appointment lifecycle needs to post a charge
 * inside its own transaction, so the routine that does it crosses the module
 * boundary; the classes that open a transaction for an HTTP endpoint do not,
 * because a caller that already has one must never reach them. Making that a module fact rather than a convention is
 * what keeps "the charge commits with the completion that caused it" true.
 *
 * `ChargeLifecycleGuard` CROSSES FOR THE SAME REASON, IN THE OTHER DIRECTION.
 * "May this session's outcome be reversed?" is answered by whether the seat still
 * carries money, which is this module's fact and not the diary's — so the
 * predicate is exported and `AppointmentsService` calls it on its own transaction,
 * rather than learning what a valid charge is. It is the only other way in, it
 * writes nothing, and it still cannot create or withdraw a charge.
 *
 * THE DEPENDENCY POINTS ONE WAY: appointments depend on the ledger, never the
 * reverse. Nothing here imports `AppointmentsModule`, so no cycle exists and the
 * posting routine cannot reach a scheduling rule — it re-reads the two facts it
 * needs with its own SQL, under the lock the caller established.
 *
 * `FamilyAccountController` SITS ON THE FAMILY'S PATH AND LIVES HERE. The money a
 * family was charged is derived from this module's two tables on every request —
 * there is no stored balance anywhere in this system — so the read stays beside
 * the rows it reads and `FamiliesModule` keeps touching no financial table. It
 * joins `child`, `service` and `therapist` for the names an interface prints,
 * which is the same read-only reach the posting service already has.
 *
 * There is deliberately no tariff resolution of its own: `resolveTariffSql` is
 * the catalog's fragment, used unchanged, so "which price applies" has one
 * statement in this system and not three.
 */
@Module({
  imports: [AuditModule],
  controllers: [SessionChargesController, ChargeAdjustmentsController, FamilyAccountController],
  providers: [
    ChargePostingService,
    ChargeLifecycleGuard,
    SessionChargesService,
    ChargeAdjustmentsService,
    FamilyAccountService,
  ],
  exports: [ChargePostingService, ChargeLifecycleGuard],
})
export class LedgerModule {}
