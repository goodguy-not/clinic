import type { Metadata } from 'next';
import { AppHeader } from '@/components/app-header';
import { readCsrfCookie, requireSession } from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { TestimonialForm } from '../../testimonial-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function NewTestimonialPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession({ requirePermission: 'testimonial.draft' });
  const query = await searchParams;
  const rawError = Array.isArray(query['error']) ? query['error'][0] : query['error'];
  const errorCode = rawError ?? null;

  return (
    <>
      <AppHeader />
      <TestimonialForm
        csrfToken={(await readCsrfCookie()) ?? ''}
        errorMessage={isKnownErrorCode(errorCode) ? persianMessage(errorCode) : null}
      />
    </>
  );
}
