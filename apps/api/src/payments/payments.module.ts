import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * Money in: what a family paid, and what it promised to pay.
 *
 * ITS OWN MODULE RATHER THAN A THIRD CONTROLLER IN `LedgerModule`. The ledger
 * owns `session_charge` and `charge_adjustment` — what a family was CHARGED —
 * and this module owns `payment` (and `payment_promise` from A6). The two never
 * write each other's tables and, deliberately, do not meet at all in a payment:
 * a payment names no charge (DECISION_LOG, 2026-08-15 — A payment is a family
 * fact), so there is no allocation for a shared module to hold. Where they DO
 * meet is the family position, which is a read computed over both sets of rows.
 *
 * IT READS `family` FOR EXISTENCE AND WRITES NOTHING IN IT. `FamiliesModule`
 * keeps owning that table and still touches no financial one, which is the same
 * one-way reach the ledger already has.
 *
 * NOTHING IS EXPORTED. No other module needs to record a payment inside its own
 * transaction — unlike `ChargePostingService`, which the appointment lifecycle
 * genuinely calls — so the class that opens a transaction for an HTTP endpoint
 * stays unreachable from anywhere else.
 */
@Module({
  imports: [AuditModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
