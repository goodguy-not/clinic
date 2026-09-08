import type { Metadata } from 'next';
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
  await requireSession({ requirePermission: 'article.draft' });
  const { id } = await params;
  const token = await readSessionToken();
  const result = await api.getArticle(id, await callerContext(token ?? undefined));
  if (!result.ok) {
    if (result.code === 'ARTICLE_NOT_FOUND') notFound();
    throw new Error(`Failed to load article: ${result.code}`);
  }
  const query = await searchParams;
  const rawError = Array.isArray(query['error']) ? query['error'][0] : query['error'];
  const errorCode = rawError ?? null;

  return (
    <>
      <AppHeader />
      <ArticleForm
        article={result.data.article}
        csrfToken={(await readCsrfCookie()) ?? ''}
        errorMessage={isKnownErrorCode(errorCode) ? persianMessage(errorCode) : null}
      />
    </>
  );
}
