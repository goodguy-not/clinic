import type { Metadata } from 'next';
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
import { EditorialWorkspace } from './editorial-workspace';
import { CONTENT_SUCCESS_MESSAGES } from './presentation';
import { CatalogEditorialWorkspace } from './catalog-editorial-workspace';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({
    requirePermission: ['article.read', 'testimonial.read'],
  });
  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);
  const [
    articleResult,
    testimonialResult,
    serviceCopyResult,
    therapistCopyResult,
    therapists,
    query,
  ] = await Promise.all([
    api.listArticles(context),
    api.listTestimonials(context),
    api.listServicePublicCopies(context),
    api.listTherapistProfileCopies(context),
    api.listTherapists(context),
    searchParams,
  ]);

  const rawError = Array.isArray(query['error']) ? query['error'][0] : query['error'];
  const rawSuccess = Array.isArray(query['success']) ? query['success'][0] : query['success'];
  const errorCode = rawError ?? null;
  const loadError = !articleResult.ok
    ? persianMessage(articleResult.code)
    : !testimonialResult.ok
      ? persianMessage(testimonialResult.code)
      : !serviceCopyResult.ok
        ? persianMessage(serviceCopyResult.code)
        : !therapistCopyResult.ok
          ? persianMessage(therapistCopyResult.code)
          : null;

  return (
    <>
      <AppHeader />
      <EditorialWorkspace
        articles={articleResult.ok ? articleResult.data.articles : []}
        testimonials={testimonialResult.ok ? testimonialResult.data.testimonials : []}
        csrfToken={(await readCsrfCookie()) ?? ''}
        errorMessage={isKnownErrorCode(errorCode) ? persianMessage(errorCode) : loadError}
        successMessage={
          rawSuccess === undefined ? null : (CONTENT_SUCCESS_MESSAGES[rawSuccess] ?? null)
        }
        canDraftArticles={user.permissions.includes('article.draft')}
        canPublishArticles={user.permissions.includes('article.publish')}
        canDraftTestimonials={user.permissions.includes('testimonial.draft')}
        canApproveTestimonials={user.permissions.includes('testimonial.approve')}
      />
      <div className="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-6">
        <CatalogEditorialWorkspace
          services={serviceCopyResult.ok ? serviceCopyResult.data.copies : []}
          therapistCopies={therapistCopyResult.ok ? therapistCopyResult.data.copies : []}
          therapists={therapists.ok ? therapists.data.therapists : []}
          canManageServices={user.permissions.includes('service.update')}
          canPublishTherapists={user.permissions.includes('therapist.publish_profile')}
          canManageClinic={user.permissions.includes('clinic_profile.update')}
        />
      </div>
    </>
  );
}
