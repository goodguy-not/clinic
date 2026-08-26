import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  createTestimonialRequestSchema,
  updateTestimonialApprovalRequestSchema,
  updateTestimonialPublicationRequestSchema,
  updateTestimonialRequestSchema,
  type CreateTestimonialRequest,
  type TestimonialListResponse,
  type TestimonialResponse,
  type UpdateTestimonialApprovalRequest,
  type UpdateTestimonialPublicationRequest,
  type UpdateTestimonialRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { TestimonialsService } from './testimonials.service';

/**
 * Testimonials. FOUR DRAFT ROUTES AND TWO MANAGER ROUTES.
 *
 * Milestone 9, checkpoint A2. `testimonial.read` and `testimonial.draft` are a
 * receptionist's: taking down what a family said and preparing an anonymised
 * version of it is front-desk work. `testimonial.approve` is a manager's alone
 * and covers both of the last two routes — approving those exact words, and
 * putting them on a page — because both turn on the same question, and because
 * nothing in the product ever grants one without the other.
 *
 * NEITHER MANAGER ROUTE CAN BE REACHED BY ACCIDENT FROM A DRAFT ONE. Creating
 * and editing cannot set `status` or `isPublic`; those are not fields on their
 * requests.
 *
 * NO DELETE ROUTE. A testimonial is unpublished and its approval withdrawn; the
 * row and its trail stay, and the table refuses a DELETE outright. A family
 * asking for their words to come off the website is served by unpublishing —
 * which is immediate — and anything beyond that is a data-retention decision
 * nobody has taken.
 */
@Controller('content/testimonials')
export class TestimonialsController {
  constructor(private readonly testimonials: TestimonialsService) {}

  @Get()
  @RequirePermissions('testimonial.read')
  async list(): Promise<TestimonialListResponse> {
    return { testimonials: await this.testimonials.list() };
  }

  @Get(':id')
  @RequirePermissions('testimonial.read')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<TestimonialResponse> {
    return { testimonial: await this.testimonials.get(id) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('testimonial.draft')
  async create(
    @Body(new ZodBodyPipe(createTestimonialRequestSchema)) body: CreateTestimonialRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<TestimonialResponse> {
    return { testimonial: await this.testimonials.create(body, session, context) };
  }

  @Patch(':id')
  @RequirePermissions('testimonial.draft')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateTestimonialRequestSchema)) body: UpdateTestimonialRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<TestimonialResponse> {
    return { testimonial: await this.testimonials.update(id, body, session, context) };
  }

  /** The privacy review. Manager-only, and never inferred from anything. */
  @Patch(':id/approval')
  @RequirePermissions('testimonial.approve')
  async setApproval(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateTestimonialApprovalRequestSchema))
    body: UpdateTestimonialApprovalRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<TestimonialResponse> {
    return {
      testimonial: await this.testimonials.setApproval(id, body.approved, session, context),
    };
  }

  /** Placement on a page. Refused on anything the review has not passed. */
  @Patch(':id/publication')
  @RequirePermissions('testimonial.approve')
  async setPublication(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateTestimonialPublicationRequestSchema))
    body: UpdateTestimonialPublicationRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<TestimonialResponse> {
    return {
      testimonial: await this.testimonials.setPublication(id, body.isPublic, session, context),
    };
  }
}
