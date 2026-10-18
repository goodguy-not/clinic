import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  createArticleRequestSchema,
  updateArticlePublicationRequestSchema,
  updateArticleRequestSchema,
  type ArticleListResponse,
  type ArticleResponse,
  type CreateArticleRequest,
  type UpdateArticlePublicationRequest,
  type UpdateArticleRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../auth/decorators/request.decorators';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { ArticlesService } from './articles.service';

/**
 * Writing articles, and publishing them. TWO AUTHORITIES, VISIBLE IN THE
 * DECORATORS.
 *
 * Milestone 9, checkpoint A2. Four of the five routes name `article.read` or
 * `article.draft`, which a RECEPTIONIST holds: somebody at the front desk hears
 * what families actually ask and is the right person to write a first answer.
 * The fifth names `article.publish`, which only a MANAGER holds, and it is the
 * only route in this file that can make anything visible to a visitor.
 *
 * That split is the frozen A1 rule kept: draft authority does not imply publish
 * authority, and the permission that publishes is not the permission that
 * writes. It is enforced by `PermissionsGuard` from a role NestJS re-read from
 * the database on this request, and pinned in both directions by tests.
 *
 * NO DELETE ROUTE, AND THERE WILL NOT BE ONE. An article that should not be on
 * the website is unpublished; the row and its trail stay. The table carries a
 * BEFORE DELETE trigger that refuses one outright.
 */
@Controller('content/articles')
export class ArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  @Get()
  @RequirePermissions('article.read')
  async list(): Promise<ArticleListResponse> {
    return { articles: await this.articles.list() };
  }

  @Get(':id')
  @RequirePermissions('article.read')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<ArticleResponse> {
    return { article: await this.articles.get(id) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('article.draft')
  async create(
    @Body(new ZodBodyPipe(createArticleRequestSchema)) body: CreateArticleRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<ArticleResponse> {
    return { article: await this.articles.create(body, session, context) };
  }

  @Patch(':id')
  @RequirePermissions('article.draft')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateArticleRequestSchema)) body: UpdateArticleRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<ArticleResponse> {
    return { article: await this.articles.update(id, body, session, context) };
  }

  /**
   * Publishing and withdrawing. THE MANAGER'S ROUTE, and the only one here that
   * a receptionist is refused.
   *
   * One route with a boolean rather than `/publish` and `/unpublish`: it is one
   * decision — is this article on the website — and one control on the surface
   * that carries it. The two directions are separate AUDIT ACTIONS, because
   * "how often is something taken back down?" is a question a diff of a boolean
   * cannot be counted for.
   */
  @Patch(':id/publication')
  @RequirePermissions('article.publish')
  async setPublication(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateArticlePublicationRequestSchema))
    body: UpdateArticlePublicationRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<ArticleResponse> {
    return { article: await this.articles.setPublication(id, body.isPublic, session, context) };
  }
}
