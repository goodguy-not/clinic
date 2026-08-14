import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ChargePostingService } from './charge-posting.service';
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
 * `ChargePostingService` IS EXPORTED AND `SessionChargesService` IS NOT. The
 * appointment lifecycle needs to post a charge inside its own transaction, so the
 * routine that does it crosses the module boundary; the class that opens a
 * transaction for the HTTP endpoint does not, because a caller that already has
 * one must never reach it. Making that a module fact rather than a convention is
 * what keeps "the charge commits with the completion that caused it" true.
 *
 * THE DEPENDENCY POINTS ONE WAY: appointments depend on the ledger, never the
 * reverse. Nothing here imports `AppointmentsModule`, so no cycle exists and the
 * posting routine cannot reach a scheduling rule — it re-reads the two facts it
 * needs with its own SQL, under the lock the caller established.
 *
 * There is deliberately no tariff resolution of its own: `resolveTariffSql` is
 * the catalog's fragment, used unchanged, so "which price applies" has one
 * statement in this system and not three.
 */
@Module({
  imports: [AuditModule],
  controllers: [SessionChargesController],
  providers: [ChargePostingService, SessionChargesService],
  exports: [ChargePostingService],
})
export class LedgerModule {}
