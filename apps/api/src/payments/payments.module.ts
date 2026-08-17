import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PaymentHistoryService } from './payment-history.service';
import { PaymentVoidController } from './payment-void.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PromiseHistoryService } from './promise-history.service';
import { PromiseResolutionController } from './promise-resolution.controller';
import { PromisesController } from './promises.controller';
import { PromisesService } from './promises.service';

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
 * FOUR CONTROLLERS, AND THEY DIFFER ONLY IN WHICH PATH ROOT THE FROZEN CONTRACT
 * PUTS A ROUTE ON — recording money, reading a payment history, making a promise
 * and reading a promise history are done to a FAMILY; withdrawing money is done
 * to a PAYMENT, and fulfilling, rescheduling or cancelling is done to a PROMISE.
 * Each record's write paths delegate to one service, so there is exactly one
 * place where a payment's rules are stated and exactly one where a promise's are.
 *
 * THE TWO RECORDS ARE TWO SERVICES, NOT ONE. `PaymentsService` never reads a
 * promise and `PromisesService` never writes a payment: fulfilment records a
 * LINK to money that already stood on its own, and the whole of what a promise
 * does to the family's position is nothing, in every state (CLAUDE.md). Splitting
 * them is also what keeps the approved `payment_promise -> payment` lock order
 * legible — one class takes both rows, in that order, in one method.
 *
 * THE READS ARE SEPARATE SERVICES FROM THE WRITES (`PaymentHistoryService`,
 * `PromiseHistoryService`), exactly as `FamilyAccountService` is separate from
 * the ledger's writers: they take no lock, write no row and record no audit fact,
 * so nothing in them can become a financial transition by accident. Neither is a
 * second description of its record — both go through the one mapping in
 * `payment-detail.ts` and `promise-detail.ts` respectively, which is what keeps
 * `CONFIRMED` and the derived `MISSED` meaning one thing across every route.
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
  controllers: [
    PaymentsController,
    PaymentVoidController,
    PromisesController,
    PromiseResolutionController,
  ],
  providers: [PaymentsService, PaymentHistoryService, PromisesService, PromiseHistoryService],
})
export class PaymentsModule {}
