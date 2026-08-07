import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ChildrenController } from './children/children.controller';
import { ChildrenService } from './children/children.service';
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
 * Fifteen routes: family search, detail, registration, editing and status;
 * child registration, detail, editing and status; the four confirmation routes
 * that complete a write refused as a possible duplicate; and the two that
 * resolve or discard a draft.
 *
 * The draft service is generic across every `DraftPurpose`, and each
 * confirmation route lives on the controller that owns the write it performs —
 * so a token minted for one flow can never be spent on another, and no route
 * exists that could not do its job.
 *
 * Neither `family` nor `child` has a delete route, and neither will: both are
 * named by session charges from Milestone 5 onward, so history is preserved
 * through deactivation and the database refuses a `DELETE` outright.
 */
@Module({
  imports: [AuditModule],
  controllers: [FamiliesController, ChildrenController, RegistrationDraftsController],
  providers: [FamiliesService, ChildrenService, RegistrationDraftsService],
  exports: [FamiliesService, ChildrenService],
})
export class FamiliesModule {}
