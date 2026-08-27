import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  publicRequestSubmissionSchema,
  publicSlugSchema,
  type PublicArticleDetailResponse,
  type PublicArticleListResponse,
  type PublicClinicProfileResponse,
  type PublicRequestSubmission,
  type PublicRequestSubmissionResponse,
  type PublicServiceDetailResponse,
  type PublicServiceListResponse,
  type PublicSitemapResponse,
  type PublicTeamResponse,
  type PublicTestimonialListResponse,
  type PublicTherapistProfileResponse,
} from '@clinic/contracts';
import { InternalOnly } from '../auth/decorators/endpoint-access';
import { Ctx } from '../auth/decorators/request.decorators';
import type { RequestContext } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { PublicRequestsService } from './public-requests.service';
import { PublicSiteService } from './public-site.service';

/**
 * THE ENTIRE PUBLIC SURFACE OF THIS API, IN ONE FILE.
 *
 * Milestone 9, checkpoint A1, extended in A2 and A3. NINE reads, ONE write, and
 * no other controller anywhere serves the website. Keeping them together is a privacy decision
 * rather than a filing preference: the question "what can the world see?" has
 * to be answerable by reading one screen, and it stops being answerable the
 * moment public routes are scattered through the domain modules that own the
 * private data.
 *
 * `@InternalOnly()` — INTERNAL KEY, NO SESSION, AND NO SECOND ARCHITECTURE.
 * These routes are reachable only from the Next.js server across the private
 * boundary, exactly like `POST /auth/login`; the browser never speaks to NestJS
 * and nothing here is exempt from `InternalKeyGuard`. "Public" describes the
 * AUDIENCE OF THE FACTS, not the reachability of the route, and the one route
 * classification that genuinely bypasses the key remains `/health` alone.
 *
 * A session is not required because a visitor has none. That is safe for the
 * reads because they are incapable of returning an unpublished row: every
 * predicate is in `PublicSiteService`, and the integration suite attacks each
 * route in turn with private, unpublished and deactivated records.
 *
 * ONE WRITE ROUTE, ADDED IN A3, AND IT IS THE ONLY ONE THERE WILL EVER BE HERE.
 * `POST /public/requests` is the contact form: the single act an anonymous
 * stranger may ask this application to perform. It is in THIS file, beside the
 * reads, for the reason the reads are here — the question "what can the world
 * do?" has to be answerable by reading one screen, and a write route filed with
 * the domain that owns its table is a write route nobody reviewing the public
 * surface would ever see.
 *
 * It is classified `@InternalOnly()` like everything above it. NOTHING ABOUT
 * ACCEPTING AN ANONYMOUS WRITE CHANGES THE BOUNDARY: the browser still speaks
 * to Next.js, Next.js still speaks to NestJS across the private network with
 * the internal key, and `/health` remains the only route in the product that
 * bypasses it. The A1 decision explicitly left this question to be re-opened
 * when a public WRITE arrived (DECISION_LOG, 2026-08-21); it is re-opened here,
 * and the answer is unchanged — "public" describes the AUDIENCE, not the
 * reachability, and a genuinely public route would put NestJS on the internet
 * for the first time to save the web tier a proxy it already performs for every
 * page.
 *
 * A SESSION IS STILL NOT REQUIRED, AND THIS IS WHERE THAT COSTS SOMETHING. The
 * reads above are safe without one because they are incapable of returning an
 * unpublished row. A write is not safe by construction in the same way, so it
 * carries its own protections instead: a frozen submission contract, an
 * explicit consent record, a duplicate window and a per-submitter throttle, all
 * in `PublicRequestsService`, and a response that tells the caller nothing but
 * that the message arrived.
 *
 * THERE IS NO PUBLIC READ OF WHAT IT WRITES. No route here, or anywhere in this
 * application, returns a website request, an inbox, a count of them or a
 * receipt for one. The inbox is checkpoint A4 and will be a STAFF surface behind
 * a named permission.
 *
 * THE MANAGER WRITE PATHS ADDED IN A2 ARE IN OTHER FILES — `ArticlesController`, `TestimonialsController`,
 * `ClinicProfileController`, `TherapistPublicProfileController` — every one of
 * them behind a named permission, precisely so that this file can go on being
 * the one screen that answers "what can the world see?".
 *
 * The responses still carry `Cache-Control: no-store` from
 * `NoStoreInterceptor`, which is left untouched: the web tier caches these
 * reads under the tags frozen in `@clinic/contracts` (`PUBLIC_CACHE_TAGS`) with
 * its own explicit fetch options, and weakening a security default for a
 * caching layer that lives one tier away would be the wrong trade.
 */
@Controller('public')
export class PublicSiteController {
  constructor(
    private readonly site: PublicSiteService,
    private readonly requests: PublicRequestsService,
  ) {}

  @Get('services')
  @InternalOnly()
  async listServices(): Promise<PublicServiceListResponse> {
    return { services: await this.site.listServices() };
  }

  /**
   * The slug is validated against the shared contract before it reaches a
   * query — a malformed one is `VALIDATION_FAILED`, not a database round trip
   * and not a 404 that looks like a real answer.
   */
  @Get('services/:slug')
  @InternalOnly()
  async getService(
    @Param('slug', new ZodBodyPipe(publicSlugSchema)) slug: string,
  ): Promise<PublicServiceDetailResponse> {
    return { service: await this.site.getService(slug) };
  }

  @Get('team')
  @InternalOnly()
  async listTeam(): Promise<PublicTeamResponse> {
    return { therapists: await this.site.listTeam() };
  }

  @Get('team/:slug')
  @InternalOnly()
  async getTherapist(
    @Param('slug', new ZodBodyPipe(publicSlugSchema)) slug: string,
  ): Promise<PublicTherapistProfileResponse> {
    return { therapist: await this.site.getTherapist(slug) };
  }

  @Get('clinic-profile')
  @InternalOnly()
  async getClinicProfile(): Promise<PublicClinicProfileResponse> {
    return { clinic: await this.site.getClinicProfile() };
  }

  @Get('articles')
  @InternalOnly()
  async listArticles(): Promise<PublicArticleListResponse> {
    return { articles: await this.site.listArticles() };
  }

  @Get('articles/:slug')
  @InternalOnly()
  async getArticle(
    @Param('slug', new ZodBodyPipe(publicSlugSchema)) slug: string,
  ): Promise<PublicArticleDetailResponse> {
    return { article: await this.site.getArticle(slug) };
  }

  @Get('testimonials')
  @InternalOnly()
  async listTestimonials(): Promise<PublicTestimonialListResponse> {
    return { testimonials: await this.site.listTestimonials() };
  }

  /**
   * The URL facts a sitemap is built from — not a sitemap.
   *
   * Classified `internal` like every other route here, and it carries no more
   * than the pages beside it already do: the slugs of pages that answer, and
   * when each last changed. It exists because the alternative is the web tier
   * assembling the same list from four separate fetches, which is four chances
   * to disagree with the site it is describing.
   */
  @Get('sitemap')
  @InternalOnly()
  async getSitemap(): Promise<PublicSitemapResponse> {
    return { entries: await this.site.listSitemapEntries() };
  }

  /**
   * A stranger asking to be telephoned. THE ONLY ANONYMOUS WRITE IN THE PRODUCT.
   *
   * Milestone 9, checkpoint A3.
   *
   * 202, NOT 201, AND THE DIFFERENCE IS HONESTY. A `201 Created` names a
   * resource that was created, and on the duplicate-suppressed path nothing was
   * — the message was already here. `202 Accepted` says exactly what is true on
   * BOTH paths and on neither more than the other: the clinic has the request,
   * and what happens next happens away from this response. It also carries no
   * `Location`, because there is no resource an anonymous caller may go and read.
   *
   * NO SESSION, NO PERMISSION, AND NO ACTOR. `@InternalOnly()` is the whole
   * authorisation: this is a message from somebody who by definition has no
   * account. The audit row it writes names an `ANONYMOUS` actor and carries
   * neither the caller's address nor their browser — see
   * `anonymousWebsiteAuditContext`.
   *
   * THE BODY IS THE SAME ON EVERY SUCCESSFUL PATH. `{ received: true }`,
   * whether a row was written or a resend was absorbed. See
   * `publicRequestSubmissionResponseSchema` for why any difference would be a
   * disclosure about a real family.
   */
  @Post('requests')
  @HttpCode(202)
  @InternalOnly()
  async submitRequest(
    @Body(new ZodBodyPipe(publicRequestSubmissionSchema)) body: PublicRequestSubmission,
    @Ctx() context: RequestContext,
  ): Promise<PublicRequestSubmissionResponse> {
    await this.requests.submit(body, context);
    return { received: true };
  }
}
