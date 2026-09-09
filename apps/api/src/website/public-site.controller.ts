import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  MEDIA_RENDITION_CONTENT_TYPE,
  PUBLIC_MEDIA_MAX_AGE_SECONDS,
  publicRequestSubmissionSchema,
  publicSlugSchema,
  type PublicArticleDetailResponse,
  type PublicArticleListResponse,
  type PublicClinicContentResponse,
  type PublicClinicProfileResponse,
  type PublicRequestSubmission,
  type PublicRequestSubmissionResponse,
  type PublicServiceDetailResponse,
  type PublicServiceListResponse,
  type PublicSitemapResponse,
  type PublicSpaceListResponse,
  type PublicTeamResponse,
  type PublicTestimonialListResponse,
  type PublicTherapistProfileResponse,
} from '@clinic/contracts';
import { InternalOnly } from '../auth/decorators/endpoint-access';
import { Ctx } from '../auth/decorators/request.decorators';
import type { RequestContext } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { PublicMediaService } from '../media/public-media.service';
import { PublicRequestsService } from './public-requests.service';
import { PublicSiteService } from './public-site.service';

/**
 * THE ENTIRE PUBLIC SURFACE OF THIS API, IN ONE FILE.
 *
 * Milestone 9, checkpoint A1, extended in A2, A3, 9.5/A5, 9.5/A7 and 9.5/A8.
 * TWELVE reads, ONE write, and no other controller anywhere serves the website.
 * Eleven of the reads are JSON projections; the remaining one, added in A5, is
 * a photograph's bytes. Keeping them together is a privacy decision
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
    private readonly media: PublicMediaService,
  ) {}

  /**
   * ONE PHOTOGRAPH, IN ONE SIZE AND ONE FORMAT. THE ONLY ROUTE IN THIS
   * APPLICATION THAT RETURNS SOMETHING OTHER THAN JSON.
   *
   * Milestone 9.5, checkpoint A5. It is HERE, among the JSON reads, for the
   * reason `POST /public/requests` is here: this file has to go on being the
   * one screen that answers "what can the world see?", and a byte-serving route
   * filed with the module that owns its table is a route nobody reviewing the
   * public surface would ever see.
   *
   * `@InternalOnly()` LIKE EVERYTHING ELSE HERE. The browser asks Next.js,
   * Next.js asks NestJS across the private network with the internal key, and
   * `/health` remains the only route in the product that bypasses it. "Public"
   * describes the AUDIENCE, not the reachability.
   *
   * THE `:renditionId` IS A RENDITION AND NEVER AN ASSET, AND THAT IS THE
   * REASON THE ORIGINAL IS UNREACHABLE. The master — the metadata-free copy the
   * clinic keeps — is a column on `media_asset` and has no row in the table
   * this route selects from, so there is no identifier a caller could send that
   * would name it. The photograph the telephone produced was never written at
   * all.
   *
   * EVERY REFUSAL IS `MEDIA_NOT_FOUND`, WITH THE SAME 404. Unknown id, archived
   * asset, unattached asset, drafted or unpublished attachment, unpublished
   * owner, detached attachment, missing file: one answer, because two would let
   * a stranger walk the identifier space and learn which photographs the clinic
   * is holding back.
   *
   * THIS IS THE ONE ROUTE WHOSE RESPONSE IS CACHEABLE, AND THE ONLY PLACE
   * `NoStoreInterceptor`'S DEFAULT IS DELIBERATELY OVERRIDDEN. The interceptor
   * sets `no-store` before the handler runs; the handler sets `public,
   * max-age=..., s-maxage=...` afterwards, with exactly
   * `PUBLIC_MEDIA_MAX_AGE_SECONDS`. That number is the STATED REVOCATION
   * WINDOW: five minutes, for every cache Vala controls between this origin and
   * the reader. The ORIGIN itself is immediate — the predicate is re-evaluated
   * per request against live rows, with nothing cached inside this process — and
   * a copy that has already reached a browser, a scraper or a search index is
   * bounded by nothing at all. See `PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS`,
   * which says all of that in one place and is where the reasoning belongs.
   *
   * THE REFUSAL PATH IS NOT CACHEABLE. `ErrorEnvelopeFilter` sets `no-store` on
   * every error response, so the 404 that follows an unpublish is never itself
   * stored — which matters, because a cached 404 would outlive a manager
   * changing their mind.
   *
   * `ETag` AND `304`. The tag is the SHA-256 of exactly these bytes, so a cache
   * revalidating after the window costs a round trip and not a re-download, and
   * a replaced photograph is unmistakably a different resource. Revalidation is
   * a REVOCATION CHECK as much as a freshness check: the 304 is only reached
   * after the publication predicate has already said yes on this request.
   *
   * `nosniff` BECAUSE THE BODY IS UPLOADED CONTENT. The type is the one this
   * product encoded, not the one the uploader claimed, and the browser is told
   * not to guess. `Content-Disposition: inline` with no filename, because the
   * filename the uploader chose is very often a family's surname and is
   * recorded nowhere.
   */
  @Get('media/:renditionId')
  @InternalOnly()
  @Header('x-content-type-options', 'nosniff')
  @Header('content-disposition', 'inline')
  async getMedia(
    @Param('renditionId', ParseUUIDPipe) renditionId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile | undefined> {
    const rendition = await this.media.findServableRendition(renditionId);
    const etag = `"${rendition.contentHash}"`;

    response.setHeader('etag', etag);
    response.setHeader(
      'cache-control',
      `public, max-age=${PUBLIC_MEDIA_MAX_AGE_SECONDS}, s-maxage=${PUBLIC_MEDIA_MAX_AGE_SECONDS}, must-revalidate`,
    );

    if (matchesEtag(request.headers['if-none-match'], etag)) {
      response.status(304);
      return undefined;
    }

    return new StreamableFile(rendition.bytes, {
      type: MEDIA_RENDITION_CONTENT_TYPE[rendition.format],
      length: rendition.byteSize,
    });
  }

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

  /**
   * The clinic's own routine copy, and the picture a link to this site unfurls
   * into. Milestone 9.5, checkpoint A8.
   *
   * A SECOND READ OF ONE SURFACE, DELIBERATELY, AND NOT A SECOND SURFACE. It is
   * the same thing one manager maintains on one screen as
   * `GET /public/clinic-profile`, and it carries the same cache tag
   * (`PUBLIC_CACHE_TAGS.clinicProfile`) so one manager act drops both. It is a
   * separate ROUTE because the two shapes are different — a single row of facts
   * against an ordered list of blocks with photographs — and because adding
   * fields to the profile response would have broken a contract the web tier
   * already ships against for no gain a visitor could see.
   *
   * THE CLINIC'S PUBLIC NAME IS NOT HERE. It is `displayName` on the profile
   * read, it is there once, and nothing in this response repeats it.
   *
   * AN UNWRITTEN BLOCK IS SIMPLY ABSENT, and so is its photograph: the media
   * predicate re-derives "has this block been written?" per request, so a
   * manager clearing a heading takes the words and the picture down together at
   * the origin, immediately.
   *
   * NO OPERATIONAL FACT CAN REACH THIS RESPONSE. `clinic_content_entry` holds
   * no reference to a therapist, a room, a service, an appointment, a family or
   * a child, and the statement behind this route joins nothing.
   */
  @Get('clinic-content')
  @InternalOnly()
  async getClinicContent(): Promise<PublicClinicContentResponse> {
    return this.site.getClinicContent();
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
   * The clinic's own published spaces. Milestone 9.5, checkpoint A7.
   *
   * IT IS AN EDITORIAL READ AND NOT AN OPERATIONAL ONE. What it returns is what
   * the clinic has decided to say about parts of its building: a heading, a
   * paragraph and the photographs a manager published. There is NO ROOM READ
   * ANYWHERE ON THIS CONTROLLER, and there cannot be one here by accident —
   * `public_space` holds no reference to `room`, so no widening of the
   * statement behind this route could return a room id, a room status, a
   * service restriction or an availability window.
   *
   * A DRAFT OR WITHDRAWN SPACE IS SIMPLY ABSENT, and so are its photographs:
   * the media predicate re-derives the space's own publication per request, so
   * a manager withdrawing a space takes its pictures down with it at the origin
   * immediately.
   */
  @Get('spaces')
  @InternalOnly()
  async listSpaces(): Promise<PublicSpaceListResponse> {
    return { spaces: await this.site.listSpaces() };
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

/**
 * Whether the caller already holds these exact bytes.
 *
 * `If-None-Match` may carry a list and may carry weak tags. The comparison is
 * the WEAK one (RFC 9110 8.8.3.2), which is what a conditional GET is defined
 * to use, and `*` matches anything — a client saying "any version will do", to
 * which the honest answer for an immutable resource is 304.
 *
 * It is a plain function rather than a method because it decides nothing about
 * access: the publication predicate has already said yes by the time it runs.
 */
function matchesEtag(header: string | string[] | undefined, etag: string): boolean {
  if (header === undefined) return false;

  const values = (Array.isArray(header) ? header.join(',') : header)
    .split(',')
    .map((value) => value.trim().replace(/^W\//, ''));

  return values.includes('*') || values.includes(etag);
}
