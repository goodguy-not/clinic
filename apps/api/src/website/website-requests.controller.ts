import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  changeWebsiteRequestStatusRequestSchema,
  linkWebsiteRequestRequestSchema,
  websiteRequestInboxQuerySchema,
  type ChangeWebsiteRequestStatusRequest,
  type LinkWebsiteRequestRequest,
  type WebsiteRequestDetail,
  type WebsiteRequestInboxQuery,
  type WebsiteRequestInboxResponse,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../auth/decorators/request.decorators';
import { WEBSITE_REQUEST_LINK_PERMISSIONS } from '../auth/permissions';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { WebsiteRequestsService } from './website-requests.service';

/**
 * The website request inbox: four internal routes, and not one of them is
 * public.
 *
 * Milestone 9, checkpoint A4.
 *
 * THE OTHER SIDE OF `PublicSiteController`, AND DELIBERATELY NOT IN IT. That
 * controller is the file that answers "what can the world do?", and it must go
 * on answering it completely — so the one anonymous write lives there, and
 * everything the CLINIC does with what the world sent lives here, behind
 * permissions, on a path with no `public` segment in it. A reader checking
 * whether the inbox is exposed has one file to read, and its answer is that it
 * contains no `@InternalOnly()` route at all.
 *
 * TWO AUTHORITIES, AND THE RECEPTIONIST HOLDS BOTH. Reading the inbox is
 * `website_request.read`; moving a request along it and linking it to a family
 * are `website_request.process`. Answering the clinic's contact form is
 * front-desk work, exactly as the telephone is — see the comment on the two
 * names in `@clinic/contracts`.
 *
 * LINKING DEMANDS `family.read` AS WELL (`WEBSITE_REQUEST_LINK_PERMISSIONS`),
 * because it names a family, checks that family's status and returns its name. A
 * caller holding only the process authority would otherwise be able to attach a
 * stranger's message to a family they may not open, and would learn from the
 * refusal alone whether a given family id exists.
 *
 * THERE IS NO CONVERSION ROUTE, AND THAT ABSENCE IS THE CONVERSION DESIGN. The
 * accepted path has two halves: an existing family is named here, and a NEW
 * family is registered through the existing registration workflow — its
 * duplicate detection, its confirmation screen, its `family.create` — and linked
 * here afterwards. A `POST /website-requests/:id/convert` that created a family
 * would be a second family-creation path with a second chance to skip the
 * duplicate check, reachable from a screen whose input is text a stranger typed.
 *
 * THERE IS NO DELETE AND NO EDIT. A request records what somebody said and is
 * never rewritten (the A3 rule, unchanged); it is erased in place by the
 * retention run ninety days after closure, which is an operator command and not
 * an HTTP route — nothing a browser can reach destroys anything here.
 */
@Controller('website-requests')
export class WebsiteRequestsController {
  constructor(private readonly requests: WebsiteRequestsService) {}

  /**
   * A page of the inbox.
   *
   * A GET WITH A QUERY STRING, UNLIKE THE FAMILY SEARCH NEXT DOOR, AND THE
   * DIFFERENCE IS WHAT TRAVELS. A family search term is a guardian's name or a
   * telephone number, which is why it is a POST body; this query carries a page
   * number and a list of statuses, and there is deliberately no search term to
   * put in it. Searching an inbox by mobile number would make it a way to ask
   * "has this person contacted the clinic?" of a store the clinic has promised to
   * erase.
   *
   * `ZodBodyPipe` on the query string, as the dashboard and the day view read
   * theirs: one validation system, and a strict schema means an unknown
   * parameter is refused rather than silently ignored.
   */
  @Get()
  @RequirePermissions('website_request.read')
  async inbox(
    @Query(new ZodBodyPipe(websiteRequestInboxQuerySchema)) query: WebsiteRequestInboxQuery,
  ): Promise<WebsiteRequestInboxResponse> {
    return this.requests.inbox(query);
  }

  /**
   * One request, with the note the visitor wrote.
   *
   * THIS IS ALSO THE CONVERSION PREFILL CONTRACT, AND IT IS THE ONLY ONE. A
   * colleague registering a family from a request reads it here and copies what
   * they can defend into the ordinary registration form. There is no server-side
   * mapping endpoint, and that is a decision rather than an omission: `familyName`
   * is not the parent's name, a child's first and last name are not one field a
   * stranger typed, and `childAgeYears` IS NOT A BIRTH DATE. Inventing any of
   * those three mappings would write a wrong, authoritative-looking value into a
   * permanent record, so the mapping is a person's judgement rather than a
   * server's guess.
   */
  @Get(':id')
  @RequirePermissions('website_request.read')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<WebsiteRequestDetail> {
    return this.requests.get(id);
  }

  /**
   * Moving a request along the accepted lifecycle.
   *
   * A `PATCH` on a sub-resource, exactly as a family's status change is: it is a
   * different decision from reading, with a different permission, and must not
   * happen as a side effect of anything else.
   *
   * The body carries a status and nothing else — `changeWebsiteRequestStatus
   * RequestSchema` is strict and excludes `CONVERTED_TO_FAMILY` and `NEW` — so
   * there is no reason field for a caller to fill in and no way to claim a
   * conversion without naming a family.
   */
  @Patch(':id/status')
  @RequirePermissions('website_request.process')
  async changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(changeWebsiteRequestStatusRequestSchema))
    body: ChangeWebsiteRequestStatusRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<WebsiteRequestDetail> {
    return this.requests.changeStatus(id, body, session, context);
  }

  /**
   * Tying this message to a family that already exists.
   *
   * 200, not 201: nothing is created. A family is named, not made — this route
   * cannot write a family, a guardian or a child, and the response is the request
   * as it now stands.
   *
   * A POST rather than a PATCH because it is an ACT with a name rather than an
   * edit to a field: it moves the request to `CONVERTED_TO_FAMILY`, records who
   * decided so and when, and can never be undone or repeated.
   */
  @Post(':id/link')
  @HttpCode(200)
  @RequirePermissions(...WEBSITE_REQUEST_LINK_PERMISSIONS)
  async link(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(linkWebsiteRequestRequestSchema)) body: LinkWebsiteRequestRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<WebsiteRequestDetail> {
    return this.requests.link(id, body, session, context);
  }
}
