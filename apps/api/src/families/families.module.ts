import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
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
 * CHECKPOINT C SCOPE. Implemented: family search, family detail, family
 * registration, the duplicate-detection engine and its advisory locks, and the
 * minimum draft capability a blocked registration needs.
 *
 * Not yet here, each waiting on its own checkpoint:
 *
 *  - `RegistrationDraftsController` — resolving, confirming and discarding a
 *    draft. The service can currently only create one, which is all a blocking
 *    409 requires;
 *  - family update and status change;
 *  - every child operation.
 */
@Module({
  imports: [AuditModule],
  controllers: [FamiliesController],
  providers: [FamiliesService, RegistrationDraftsService],
  exports: [FamiliesService],
})
export class FamiliesModule {}
