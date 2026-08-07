import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RegistrationDraftsController } from './drafts/registration-drafts.controller';
import { RegistrationDraftsService } from './drafts/registration-drafts.service';
import { FamiliesController } from './families/families.controller';
import { FamiliesService } from './families/families.service';

/**
 * Families, guardians, children and registration drafts.
 *
 * This module owns those four tables and is the only code that queries them.
 *
 * `AuditModule` is imported because every write here is audited in the same
 * transaction as the state change it records — a draft being the one exception,
 * and deliberately so: it is transient workflow state, not a historical fact.
 *
 * CHECKPOINT D SCOPE. Implemented: family search, detail and registration; the
 * duplicate-detection engine and its advisory locks; and the complete
 * registration-draft lifecycle — create-or-replace, resolve, discard and
 * one-time consumption through confirmation.
 *
 * The draft service is generic across every `DraftPurpose`, but only
 * `FAMILY_CREATE` has a confirmation route. A confirmation route exists to
 * perform a domain write, and the writes the other three would perform —
 * family update, child creation, child update — do not exist yet. Routes that
 * cannot do their job would be dead surface carrying a real permission.
 *
 * Still to come:
 *
 *  - family update and status change, and `POST /families/confirm-update`;
 *  - `ChildrenService` and every child route, with their two confirm routes.
 */
@Module({
  imports: [AuditModule],
  controllers: [FamiliesController, RegistrationDraftsController],
  providers: [FamiliesService, RegistrationDraftsService],
  exports: [FamiliesService],
})
export class FamiliesModule {}
