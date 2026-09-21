import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
import { api } from '@/server/api-client';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { ArticleImageEditor, imagesForArticle } from '../../../article-image-editor';
import { ArticleForm } from '../../../article-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function EditArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({ requirePermission: 'article.draft' });
  const { id } = await params;
  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);
  const [result, mediaResult] = await Promise.all([
    api.getArticle(id, context),
    api.listMedia(context),
  ]);
  if (!result.ok) {
    if (result.code === 'ARTICLE_NOT_FOUND') notFound();
    throw new Error(`Failed to load article: ${result.code}`);
  }
  const query = await searchParams;
  const rawError = Array.isArray(query['error']) ? query['error'][0] : query['error'];
  const errorCode = rawError ?? null;

  const csrfToken = (await readCsrfCookie()) ?? '';
  const article = result.data.article;

  return (
    <>
      <AppHeader />
      {user.role === 'MANAGER' ? (
        <div className="mx-auto max-w-6xl px-4 pt-4">
          <Link
            className="text-sm font-semibold text-teal-800 underline"
            href={`/content/preview/articles/${article.id}`}
          >
            پیش‌نمایش خصوصی نسخهٔ آماده
          </Link>
        </div>
      ) : null}
      <ArticleForm
        article={article}
        csrfToken={csrfToken}
        errorMessage={
          isKnownErrorCode(errorCode)
            ? persianMessage(errorCode)
            : mediaResult.ok
              ? null
              : persianMessage(mediaResult.code)
        }
      >
        <ArticleImageEditor
          article={article}
          images={imagesForArticle(mediaResult.ok ? mediaResult.data.media : [], article.id)}
          csrfToken={csrfToken}
          canPublishMedia={user.permissions.includes('media.publish')}
        />
      </ArticleForm>
    </>
  );
}
