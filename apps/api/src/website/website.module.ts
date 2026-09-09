import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MediaModule } from '../media/media.module';
import { ArticlesController } from './articles.controller';
import { ArticlesService } from './articles.service';
import { ClinicProfileController } from './clinic-profile.controller';
import { ClinicProfileService } from './clinic-profile.service';
import { PublicRequestsService } from './public-requests.service';
import { PublicSiteController } from './public-site.controller';
import { PublicSiteService } from './public-site.service';
import { SpacesController } from './spaces.controller';
import { SpacesService } from './spaces.service';
import { TestimonialsController } from './testimonials.controller';
import { TestimonialsService } from './testimonials.service';
import { WebsiteRequestRetentionService } from './website-request-retention.service';
import { WebsiteRequestsController } from './website-requests.controller';
import { WebsiteRequestsService } from './website-requests.service';

/**
 * The public website: what the world reads, and the manager surface that
 * decides it.
 *
 * Milestone 9, checkpoint A1 delivered nine read-only projections' worth of
 * foundation — the published services, one published service, the opted-in
 * team, one opted-in profile, and the clinic's own public facts. Checkpoint A2
 * adds the published articles, one published article, the approved
 * testimonials and the sitemap's URL facts, and — the point of the checkpoint —
 * the WRITE paths behind all of it.
 *
 * IT OWNS `clinic_public_profile`, `public_article` AND `public_testimonial`,
 * AND READS TWO TABLES IT DOES NOT OWN. `service` and `therapist` belong to
 * `CatalogModule`, which remains the only code that WRITES them — including the
 * therapist public profile, which is a separate service and a separate
 * permission inside that module rather than a second writer here. This module
 * reads a deliberately narrow projection of their published columns and does
 * not import that module, because the reads it needs are not the reads an
 * administrator needs: sharing them would put the public site one widened
 * `SELECT` away from a leak.
 *
 * CHECKPOINT A3 ADDS ONE SERVICE AND NO CONTROLLER. `PublicRequestsService` is
 * the anonymous contact form; its route lives on `PublicSiteController`,
 * deliberately, so that the one file answering "what can the world do?" answers
 * it completely. It owns `website_request` — protected against DELETE and
 * TRUNCATE like every other historical table here, and erased in place by the
 * ninety-day retention rule A4 owns — and it reads exactly one column of
 * `service`, under the same
 * published-only predicate every public read applies, so that a stranger cannot
 * use the form to enumerate the internal catalogue.
 *
 * CHECKPOINT A4 ADDS THE INTERNAL SIDE OF THAT ONE ANONYMOUS WRITE, and it is
 * the first controller in this module that is not about publishing.
 * `WebsiteRequestsController` is the inbox — read a page of requests, open one,
 * move it along the accepted five-status lifecycle, link it to a family that
 * already exists — and every route on it carries a permission. NOTHING IN IT IS
 * PUBLIC, and the separation from `PublicSiteController` is deliberate: that
 * file answers "what can the world do?" and must go on answering it completely.
 *
 * `WebsiteRequestRetentionService` IS EXPORTED AND HAS NO ROUTE. It is the
 * ninety-day erasure, and it is reached only by the `purge-website-requests`
 * operator command — no HTTP route in this application destroys anything. It is
 * exported rather than private because `CliModule` runs it, and it lives here
 * rather than in the CLI so that the erasure and the table it erases are read
 * side by side.
 *
 * MILESTONE 9.5, CHECKPOINT A5 IMPORTS `MediaModule` AND ADDS NO SERVICE,
 * NO TABLE AND NO CONTROLLER HERE. The media subsystem owns its three tables
 * and its own staff controller; what this module takes from it is
 * `PublicMediaService` — the published-only projection — for two reasons. The
 * four public reads now carry the photographs the clinic has published, and the
 * ONE ANONYMOUS BYTE ROUTE IN THE PRODUCT is declared on
 * `PublicSiteController` rather than in the media module, so that the file
 * answering "what can the world see?" goes on answering it completely.
 *
 * `AuditModule` IS IMPORTED NOW, WHERE A1 DELIBERATELY DID NOT. Reading a
 * published page is still not an audited act and nothing in
 * `PublicSiteService` writes a row. What changed is that this module now
 * PUBLISHES — an article going live, a testimonial passing its privacy review,
 * the clinic's own address changing — and every one of those writes its audit
 * row in the same transaction as the change, as every write in this
 * application does.
 *
 * MILESTONE 9.5, CHECKPOINT A7 ADDS ONE TABLE, ONE SERVICE, ONE STAFF
 * CONTROLLER AND ONE PUBLIC READ — AND NO LINK TO THE CATALOG.
 *
 * `public_space` is editorial content about the building, owned here beside
 * articles and testimonials because it is the same kind of thing: a receptionist
 * drafts it, a manager publishes it, and the public read returns the published
 * copy only. `room` remains scheduling configuration owned by `CatalogModule`,
 * and this module STILL does not import that one — the two concepts share no
 * table, no foreign key and no service, so an operational change cannot publish
 * editorial content and editorial content cannot carry an operational fact.
 *
 * The space's photographs are the A5 subsystem used unchanged, through the
 * `MediaModule` this module already imports.
 */
@Module({
  imports: [AuditModule, MediaModule],
  controllers: [
    PublicSiteController,
    ArticlesController,
    TestimonialsController,
    SpacesController,
    ClinicProfileController,
    WebsiteRequestsController,
  ],
  providers: [
    PublicSiteService,
    PublicRequestsService,
    ArticlesService,
    TestimonialsService,
    SpacesService,
    ClinicProfileService,
    WebsiteRequestsService,
    WebsiteRequestRetentionService,
  ],
  exports: [PublicSiteService, WebsiteRequestsService, WebsiteRequestRetentionService],
})
export class WebsiteModule {}
