import { Module } from '@nestjs/common';
import { PublicSiteController } from './public-site.controller';
import { PublicSiteService } from './public-site.service';

/**
 * The public website's side of the API.
 *
 * Milestone 9, checkpoint A1: five read-only projections — the published
 * services, one published service, the opted-in team, one opted-in profile, and
 * the clinic's own public facts.
 *
 * IT OWNS `clinic_public_profile` AND READS TWO TABLES IT DOES NOT OWN.
 * `service` and `therapist` belong to `CatalogModule`, which remains the only
 * code that WRITES them. This module reads a deliberately narrow projection of
 * their published columns and does not import that module, because the reads it
 * needs are not the reads an administrator needs: sharing them would put the
 * public site one widened `SELECT` away from a leak, and the point of a
 * projection is that it cannot widen by accident.
 *
 * NO `AuditModule`, BECAUSE NOTHING HERE WRITES. Reading a published page is
 * not an audited act; publishing IS, and the manager surface that publishes
 * arrives in CHECKPOINT A2 — the service's public fields on the existing
 * manager form, the therapist's public profile and opt-in under
 * `therapist.publish_profile`, and the clinic profile under
 * `clinic_profile.update` — each with its audit inside the same transaction as
 * the change, as every write in this application already is (DECISION_LOG,
 * 2026-08-21).
 */
@Module({
  controllers: [PublicSiteController],
  providers: [PublicSiteService],
  exports: [PublicSiteService],
})
export class WebsiteModule {}
