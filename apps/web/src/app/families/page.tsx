import type { Metadata } from 'next';
import { api } from '@/server/api-client';
import { callerContext, readSessionToken, requireSession } from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { isKnownNoticeCode, persianNotice } from '@/server/notices';
import { Alert, ButtonLink, PageHeader, PageShell } from '@/components/ui';
import { COPY } from '@/server/copy-fa';
import { FamilySearch } from './family-search';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The search screen.
 *
 * This render is the "no search submitted yet" state: the recent
 * registrations, which is the path taken straight after creating a family. A
 * submitted search never arrives here — it is posted to `searchFamiliesAction`
 * and answered in the response to that same request, so no search term is ever
 * carried in this page's URL, and there is no `?q=` to read.
 */
export default async function FamiliesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession({ requirePermission: 'family.read' });

  const sessionToken = await readSessionToken();
  const result = await api.searchFamilies({}, await callerContext(sessionToken ?? undefined));

  const params = await searchParams;
  const rawError = params['error'];
  const errorCode = typeof rawError === 'string' ? rawError : null;
  const rawNotice = params['notice'];
  const noticeCode = typeof rawNotice === 'string' ? rawNotice : null;

  const errorMessage = isKnownErrorCode(errorCode)
    ? persianMessage(errorCode)
    : result.ok
      ? null
      : persianMessage(result.code);

  return (
    <PageShell>
      <PageHeader
        title={COPY.familiesTitle}
        description={COPY.familiesDescription}
        backHref="/"
        backLabel={COPY.back}
        action={<ButtonLink href="/families/new">{COPY.familyAddAction}</ButtonLink>}
      />

      {isKnownNoticeCode(noticeCode) ? (
        <Alert tone="info">{persianNotice(noticeCode)}</Alert>
      ) : null}

      <FamilySearch
        initial={{
          q: '',
          includeInactive: false,
          families: result.ok ? result.data.families : [],
          truncated: result.ok ? result.data.truncated : false,
          searched: false,
          errorMessage,
        }}
      />
    </PageShell>
  );
}
