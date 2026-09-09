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
  const result = await api.getServicePublicCopy(id, await callerContext(token ?? undefined));
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
            : null;

  return (
    <>
      <AppHeader />
      <ServiceCopyEditor
        copy={result.data.copy}
        csrfToken={(await readCsrfCookie()) ?? ''}
        canPublish={user.permissions.includes('service.update')}
        message={message}
      />
    </>
  );
}
