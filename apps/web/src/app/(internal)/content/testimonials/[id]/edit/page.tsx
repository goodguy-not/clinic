import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
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
import { CONTENT_SUCCESS_MESSAGES } from '../../../presentation';
import { TestimonialForm } from '../../../testimonial-form';
import { imagesForTestimonial, TestimonialImageEditor } from '../../../testimonial-image-editor';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function EditTestimonialPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({ requirePermission: 'testimonial.draft' });
  const { id } = await params;
  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);
  const [result, mediaResult] = await Promise.all([
    api.getTestimonial(id, context),
    api.listMedia(context),
  ]);
  if (!result.ok) {
    if (result.code === 'TESTIMONIAL_NOT_FOUND') notFound();
    throw new Error(`Failed to load testimonial: ${result.code}`);
  }
  if (
    result.data.testimonial.status === 'APPROVED' &&
    !user.permissions.includes('testimonial.approve')
  ) {
    redirect('/content?error=TESTIMONIAL_APPROVED');
  }
  const query = await searchParams;
  const rawError = Array.isArray(query['error']) ? query['error'][0] : query['error'];
  const errorCode = rawError ?? null;
  const rawSuccess = Array.isArray(query['success']) ? query['success'][0] : query['success'];
  const csrfToken = (await readCsrfCookie()) ?? '';
  const testimonial = result.data.testimonial;

  return (
    <>
      <AppHeader />
      {user.role === 'MANAGER' ? (
        <div className="mx-auto max-w-6xl px-4 pt-4">
          <Link
            className="text-sm font-semibold text-teal-800 underline"
            href={`/content/preview/testimonials/${testimonial.id}`}
          >
            پیش‌نمایش خصوصی نسخهٔ آماده
          </Link>
        </div>
      ) : null}
      <TestimonialForm
        testimonial={testimonial}
        csrfToken={csrfToken}
        errorMessage={
          isKnownErrorCode(errorCode)
            ? persianMessage(errorCode)
            : mediaResult.ok
              ? null
              : persianMessage(mediaResult.code)
        }
        successMessage={
          rawSuccess === undefined ? null : (CONTENT_SUCCESS_MESSAGES[rawSuccess] ?? null)
        }
      >
        <TestimonialImageEditor
          testimonial={testimonial}
          images={imagesForTestimonial(
            mediaResult.ok ? mediaResult.data.media : [],
            testimonial.id,
          )}
          csrfToken={csrfToken}
          canApprove={user.permissions.includes('testimonial.approve')}
          canPublishMedia={user.permissions.includes('media.publish')}
        />
      </TestimonialForm>
    </>
  );
}
