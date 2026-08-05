import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  createTariffRequestSchema,
  resolveTariffQuerySchema,
  tariffListQuerySchema,
  voidTariffRequestSchema,
  type CreateTariffRequest,
  type ResolveTariffQuery,
  type ResolveTariffResponse,
  type TariffListQuery,
  type TariffListResponse,
  type TariffResponse,
  type VoidTariffRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { ZodBodyPipe } from '../../common/zod-validation.pipe';
import { TariffsService } from './tariffs.service';

/**
 * Effective-dated prices. Manager-only in this milestone; the receptionist is
 * explicitly barred from global tariff changes (PROJECT_SPEC.md 4) and holds no
 * catalog permission at all, so every route here refuses them.
 *
 * There is no update route and no delete route, and neither is an oversight: a
 * tariff is immutable once written, and a correction voids the row and inserts
 * a replacement so the price that applied on a past date stays readable.
 */
@Controller('catalog')
export class TariffsController {
  constructor(private readonly tariffs: TariffsService) {}

  // `ZodBodyPipe` is a plain Zod validation pipe; it is named for its usual
  // position but works anywhere a value needs parsing, including a query.
  @Get('tariffs')
  @RequirePermissions('tariff.read')
  async list(
    @Query(new ZodBodyPipe(tariffListQuerySchema)) query: TariffListQuery,
  ): Promise<TariffListResponse> {
    return { tariffs: await this.tariffs.list(query) };
  }

  /**
   * Deliberately not nested under `tariffs/`.
   *
   * `/catalog/tariffs/resolve` would sit in the same space as
   * `/catalog/tariffs/:id`, and which one answered would depend on the order
   * the routes happen to be declared in — a silent trap for a later edit. A
   * distinct path cannot collide at all.
   */
  @Get('tariff-resolution')
  @RequirePermissions('tariff.read')
  async resolve(
    @Query(new ZodBodyPipe(resolveTariffQuerySchema)) query: ResolveTariffQuery,
  ): Promise<ResolveTariffResponse> {
    return { tariff: await this.tariffs.resolve(query) };
  }

  @Get('tariffs/:id')
  @RequirePermissions('tariff.read')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<TariffResponse> {
    return { tariff: await this.tariffs.get(id) };
  }

  /**
   * Create a tariff, optionally superseding one in the same transaction.
   *
   * The body is a discriminated union on `priceMode`, so a paid tariff cannot
   * carry a free-programme reason and a free one cannot carry an amount — the
   * two shapes are structurally incapable of being confused.
   */
  @Post('tariffs')
  @HttpCode(201)
  @RequirePermissions('tariff.create')
  async create(
    @Body(new ZodBodyPipe(createTariffRequestSchema)) body: CreateTariffRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<TariffResponse> {
    return { tariff: await this.tariffs.create(body, session, context) };
  }

  @Post('tariffs/:id/void')
  @HttpCode(200)
  @RequirePermissions('tariff.void')
  async void(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(voidTariffRequestSchema)) body: VoidTariffRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<TariffResponse> {
    return { tariff: await this.tariffs.void(id, body.reason, session, context) };
  }
}
