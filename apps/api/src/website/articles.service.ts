import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Article, CreateArticleRequest, UpdateArticleRequest } from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';
import { actorContext, canonicalOptionalText, canonicalText } from '../catalog/catalog-support';

/**
 * Articles, from the first draft to the moment they come off the website.
 *
 * Milestone 9, checkpoint A2.
 *
 * THE INVARIANT THIS FILE EXISTS TO HOLD: NO PROSE REACHES A VISITOR WITHOUT A
 * MANAGER PUBLISHING IT — not the first paragraph of a new article, and not a
 * rewrite of one that has been live for a month.
 *
 * That is why an article holds its copy TWICE. `title`, `summary` and `body`
 * are the working draft, which `article.draft` may rewrite at any time;
 * `published_title`, `published_summary` and `published_body` are what the
 * website says, and `setPublication` — reachable only under `article.publish` —
 * is the ONLY statement in this application that writes them. Every public read
 * selects the second set.
 *
 * The first shape of this checkpoint had one set of columns and a rule that a
 * published article stayed editable, which meant a receptionist's unreviewed
 * text appeared on the live page the instant they saved it. Refusing the edit
 * instead would have been the opposite error — an article nobody can correct
 * without a manager doing the typing. The product rule is neither, and two
 * column sets is the smallest thing that can state it.
 *
 * The A1 slug rule applies unchanged: a slug may be corrected freely until the
 * first publication and never afterwards, refused as `PUBLIC_SLUG_IMMUTABLE`
 * with the database trigger behind it as the authority.
 *
 * Every state change and its audit row share one transaction, as every write in
 * this application does.
 */

type ArticleRow = {
  id: string;
  public_slug: string;
  title: string;
  summary: string | null;
  body: string;
  published_title: string | null;
  published_summary: string | null;
  published_body: string | null;
  is_public: boolean;
  has_unpublished_changes: boolean;
  public_first_published_at: Date | null;
  public_revised_at: Date | null;
  created_at: Date;
};

/**
 * `has_unpublished_changes` is DERIVED IN THE READ rather than stored.
 *
 * A stored flag would be a fourth thing every write path had to remember to
 * keep in step with the other three, and the first time one forgot, a manager
 * would be told there was nothing to publish while the live page showed
 * something else. Computed from the two column sets it describes, it cannot
 * disagree with them.
 *
 * The row comparison is `IS DISTINCT FROM`, so a summary that is null on one
 * side and set on the other counts as a difference — which a plain `<>` would
 * report as unknown and therefore as "no change".
 */
const ARTICLE_COLUMNS = Prisma.sql`
  a.id,
  a.public_slug,
  a.title,
  a.summary,
  a.body,
  a.published_title,
  a.published_summary,
  a.published_body,
  a.is_public,
  (
    a.is_public
    AND (a.title, a.summary, a.body)
        IS DISTINCT FROM (a.published_title, a.published_summary, a.published_body)
  ) AS has_unpublished_changes,
  a.public_first_published_at,
  a.public_revised_at,
  a.created_at
`;

@Injectable()
export class ArticlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Everything, drafts included, newest first.
   *
   * This is the INTERNAL list — the one an author works from — and it is the
   * only read in the module that returns unpublished content. It is behind
   * `article.read`; the public list is a different query in a different file
   * and cannot return a draft at all.
   *
   * Ordered by id descending, which for a UUIDv7 is creation order reversed:
   * the article somebody is working on now is the one at the top.
   */
  async list(): Promise<Article[]> {
    const rows = await this.prisma.$queryRaw<ArticleRow[]>`
      SELECT ${ARTICLE_COLUMNS} FROM public_article a ORDER BY a.id DESC
    `;

    return rows.map(toArticle);
  }

  async get(id: string): Promise<Article> {
    const rows = await this.prisma.$queryRaw<ArticleRow[]>`
      SELECT ${ARTICLE_COLUMNS} FROM public_article a WHERE a.id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('ARTICLE_NOT_FOUND');
    return toArticle(row);
  }

  /** Always a draft. `is_public` is not a column this statement can set. */
  async create(
    input: CreateArticleRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<Article> {
    const id = uuidv7();
    const title = canonicalText(input.title);
    const summary = canonicalOptionalText(input.summary);
    const body = canonicalText(input.body);

    const created = await this.prisma.$transaction(async (tx) => {
      // No `public_slug`: the column's default assigns the address (M10-A10,
      // T-010), so nobody invents one and two drafts cannot race for a name.
      await tx.$executeRaw`
        INSERT INTO public_article (
          id, title, summary, body, is_public, created_at, created_by_user_id
        ) VALUES (
          ${id}::uuid, ${title}, ${summary}, ${body},
          FALSE, transaction_timestamp(), ${actor.userId}::uuid
        )
      `;

      const row = await this.readLocked(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'public_article.created',
        entityType: 'public_article',
        entityId: id,
        after: articleAudit(row),
      });

      return row;
    });

    return toArticle(created);
  }

  /**
   * Editing the DRAFT, at any point in the article's life.
   *
   * IT TOUCHES NO PUBLISHED COLUMN AND NO VISITOR SEES ANYTHING CHANGE. That is
   * what lets this method stay open to `article.draft` on an article that is
   * currently live: the person at the front desk can rewrite a paragraph, and
   * the page goes on saying exactly what the manager last approved until the
   * manager approves the new wording.
   *
   * IT DOES NOT MOVE `public_revised_at` EITHER. That column is the sitemap's
   * last-modified — a statement to a crawler about the PUBLISHED page — and a
   * draft edit has not modified the published page.
   *
   * The ADDRESS is not on this request at all (M10-A10, T-010): the database
   * assigned it when the article was created, and it never changes.
   */
  async update(
    id: string,
    input: UpdateArticleRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<Article> {
    const title = canonicalText(input.title);
    const summary = canonicalOptionalText(input.summary);
    const body = canonicalText(input.body);

    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, id);

      await tx.$executeRaw`
        UPDATE public_article
        SET title = ${title},
            summary = ${summary},
            body = ${body}
        WHERE id = ${id}::uuid
      `;

      const after = await this.readLocked(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'public_article.updated',
        entityType: 'public_article',
        entityId: id,
        before: articleAudit(before),
        after: articleAudit(after),
      });

      return after;
    });

    return toArticle(updated);
  }

  /**
   * THE ONLY PLACE IN THIS APPLICATION THAT MAKES ARTICLE PROSE VISIBLE.
   *
   * Publishing COPIES THE DRAFT ONTO THE PUBLISHED COLUMNS in the same
   * statement that sets the flag. That is what makes this one act rather than
   * two: "publish" means "what the draft now says is what the website says",
   * whether the page was empty before or was showing an earlier version, and a
   * separate approval route beside this one would be two names for one decision
   * that a manager would then have to choose between.
   *
   * WITHDRAWING LEAVES THE PUBLISHED COPY WHERE IT IS. Nothing reads it while
   * `is_public` is false, and keeping it means a withdrawn article still
   * records what the clinic last said — which republishing then deliberately
   * replaces rather than silently restores.
   *
   * IDEMPOTENT ON THE WHOLE ACT, NOT ON THE FLAG. Publishing an article that is
   * already public but carries a prepared change is a real publication and is
   * recorded as one; publishing one that is already public and already matches
   * its draft changes nothing and writes nothing, so a double-clicked button
   * does not fill the trail with entries whose before and after agree.
   */
  async setPublication(
    id: string,
    isPublic: boolean,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<Article> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, id);

      const alreadySettled = isPublic
        ? before.is_public && !before.has_unpublished_changes
        : !before.is_public;

      if (alreadySettled) return before;

      if (isPublic) {
        await tx.$executeRaw`
          UPDATE public_article
          SET is_public = TRUE,
              published_title = title,
              published_summary = summary,
              published_body = body,
              public_revised_at = transaction_timestamp()
          WHERE id = ${id}::uuid
        `;
      } else {
        await tx.$executeRaw`
          UPDATE public_article SET is_public = FALSE WHERE id = ${id}::uuid
        `;
      }

      const after = await this.readLocked(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: isPublic ? 'public_article.published' : 'public_article.unpublished',
        entityType: 'public_article',
        entityId: id,
        before: { isPublic: before.is_public },
        // The slug is on the publication row because it is the URL that came
        // into existence — or stopped answering — and a reviewer should not
        // have to join to the row as it stands today to find out which.
        //
        // The published title and body LENGTH say WHAT crossed the boundary, so
        // a second publication of a revised article is distinguishable from the
        // first without a reader having to compare timestamps. The prose itself
        // is not copied here, for the reason the draft actions do not copy it.
        after: {
          isPublic: after.is_public,
          publicSlug: after.public_slug,
          publishedTitle: after.published_title,
          publishedBodyLength: after.published_body === null ? 0 : after.published_body.length,
        },
      });

      return after;
    });

    return toArticle(updated);
  }

  private async lock(tx: Prisma.TransactionClient, id: string): Promise<ArticleRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM public_article WHERE id = ${id}::uuid FOR UPDATE
    `;

    if (locked[0] === undefined) throw new AppError('ARTICLE_NOT_FOUND');

    return this.readLocked(tx, id);
  }

  private async readLocked(tx: Prisma.TransactionClient, id: string): Promise<ArticleRow> {
    const rows = await tx.$queryRaw<ArticleRow[]>`
      SELECT ${ARTICLE_COLUMNS} FROM public_article a WHERE a.id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('ARTICLE_NOT_FOUND');
    return row;
  }
}

/**
 * What an audit row says about an article.
 *
 * THE BODY IS RECORDED AS ITS LENGTH, NOT ITS TEXT, and the summary likewise.
 * An article body is twenty thousand characters of prose; an audit table that
 * kept a copy of every draft of it would BE the content revision history this
 * checkpoint declines to build, hidden inside the one table in the schema that
 * can never be pruned or deleted. What a reviewer needs is that the text
 * changed, when, and who changed it — the title and the slug, which are short
 * and are what a page is identified by, are recorded in full.
 */
function articleAudit(row: ArticleRow): Record<string, string | number | boolean | null> {
  return {
    publicSlug: row.public_slug,
    // The DRAFT title and lengths, because these two actions ARE draft work.
    // What the website says is recorded on the publication row, by the act that
    // put it there.
    title: row.title,
    summaryLength: row.summary === null ? 0 : row.summary.length,
    bodyLength: row.body.length,
    isPublic: row.is_public,
  };
}

function toArticle(row: ArticleRow): Article {
  return {
    id: row.id,
    publicSlug: row.public_slug,
    title: row.title,
    summary: row.summary,
    body: row.body,
    isPublic: row.is_public,
    hasUnpublishedChanges: row.has_unpublished_changes,
    firstPublishedAt:
      row.public_first_published_at === null ? null : row.public_first_published_at.toISOString(),
    publicRevisedAt: row.public_revised_at === null ? null : row.public_revised_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}
