import { Controller, Get, Param } from '@nestjs/common';
import {
  publicSlugSchema,
  type PublicClinicProfileResponse,
  type PublicServiceDetailResponse,
  type PublicServiceListResponse,
  type PublicTeamResponse,
  type PublicTherapistProfileResponse,
} from '@clinic/contracts';
import { InternalOnly } from '../auth/decorators/endpoint-access';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { PublicSiteService } from './public-site.service';

/**
 * THE ENTIRE PUBLIC SURFACE OF THIS API, IN ONE FILE.
 *
 * Milestone 9, checkpoint A1. Five reads, no writes, and no other controller
 * anywhere serves the website. Keeping them together is a privacy decision
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
 * A session is not required because a visitor has none. That is safe here and
 * only here, because these five reads are incapable of returning an
 * unpublished row: every predicate is in `PublicSiteService`, and the
 * integration suite attacks each route in turn with private, unpublished and
 * deactivated records.
 *
 * NO WRITE ROUTE, AND NOT BECAUSE ONE IS PENDING. The public request form is a
 * later checkpoint and will arrive with its own consent, rate-limiting and
 * inbox decisions; until it does, an anonymous caller cannot cause this
 * application to write anything.
 *
 * The responses still carry `Cache-Control: no-store` from
 * `NoStoreInterceptor`, which is left untouched: the web tier caches these
 * reads under the tags frozen in `@clinic/contracts` (`PUBLIC_CACHE_TAGS`) with
 * its own explicit fetch options, and weakening a security default for a
 * caching layer that lives one tier away would be the wrong trade.
 */
@Controller('public')
export class PublicSiteController {
  constructor(private readonly site: PublicSiteService) {}

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
}
