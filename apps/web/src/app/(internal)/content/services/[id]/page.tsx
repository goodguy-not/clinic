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
import { ServiceCopyEditor } from './service-copy-editor';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ServiceCopyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({ requirePermission: 'service.draft_public_copy' });
  const { id } = await params;
  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);
  const [serviceResult, result, mediaResult] = await Promise.all([
    api.getService(id, context),
    api.getServicePublicCopy(id, context),
    api.listMedia(context),
  ]);
  if (!serviceResult.ok) {
    if (serviceResult.code === 'SERVICE_NOT_FOUND') notFound();
    throw new Error(`Failed to load service: ${serviceResult.code}`);
  }
  if (!result.ok) {
    if (result.code === 'SERVICE_NOT_FOUND') notFound();
    throw new Error(`Failed to load service copy: ${result.code}`);
  }
  const query = await searchParams;
  const error = Array.isArray(query['error']) ? query['error'][0] : query['error'];
  const success = Array.isArray(query['success']) ? query['success'][0] : query['success'];
  const message =
    error !== undefined && isKnownErrorCode(error)
      ? persianMessage(error)
      : success === 'draft-saved'
        ? 'متن آماده ذخیره شد؛ نسخهٔ روی سایت تغییر نکرد.'
        : success === 'published'
          ? 'متن آماده روی سایت منتشر شد.'
          : success === 'withdrawn'
            ? 'توضیح منتشرشده از سایت برداشته شد.'
            : success === 'service-image-published'
              ? 'عکس خدمت پس از بررسی مدیر منتشر شد.'
              : success === 'service-image-withdrawn'
                ? 'عکس خدمت از سایت برداشته شد؛ نسخهٔ آماده برای بررسی باقی مانده است.'
                : null;

  return (
    <>
      <AppHeader />
      {user.role === 'MANAGER' ? (
        <div className="mx-auto max-w-6xl px-4 pt-4">
          <Link
            className="text-sm font-semibold text-teal-800 underline"
            href={`/content/preview/services/${result.data.copy.serviceId}`}
          >
            پیش‌نمایش خصوصی نسخهٔ آماده
          </Link>
        </div>
      ) : null}
      <ServiceCopyEditor
        copy={result.data.copy}
        csrfToken={(await readCsrfCookie()) ?? ''}
        canPublish={user.permissions.includes('service.update')}
        canPublishMedia={user.permissions.includes('media.publish')}
        media={mediaResult.ok ? mediaResult.data.media : []}
        mediaLoadError={mediaResult.ok ? null : persianMessage(mediaResult.code)}
        message={message}
        serviceStatus={serviceResult.data.service.status}
      />
    </>
  );
}
