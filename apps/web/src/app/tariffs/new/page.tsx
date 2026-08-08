import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { api } from '@/server/api-client';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { TariffForm } from '../tariff-form';
import { AppHeader } from '@/components/app-header';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Create a tariff, or correct one via `?supersedes=<id>`.
 *
 * There is no edit page and there will not be one: a tariff is immutable, so a
 * correction is a new row that supersedes the old one in the same transaction.
 */
export default async function NewTariffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession({ requirePermission: 'tariff.create' });

  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);

  const params = await searchParams;
  const supersedesId = typeof params['supersedes'] === 'string' ? params['supersedes'] : undefined;

  const [services, therapists] = await Promise.all([
    api.listServices(context),
    api.listTherapists(context),
  ]);

  let supersedes;
  if (supersedesId !== undefined) {
    const result = await api.getTariff(supersedesId, context);
    if (!result.ok) {
      if (result.code === 'TARIFF_NOT_FOUND') notFound();
      throw new Error(`Failed to load tariff: ${result.code}`);
    }
    supersedes = result.data.tariff;
  }

  const rawError = params['error'];
  const code = typeof rawError === 'string' ? rawError : null;

  const serviceList = services.ok ? services.data.services : [];
  const therapistList = therapists.ok ? therapists.data.therapists : [];

  return (
    <>
      <AppHeader />
      <TariffForm
        services={serviceList}
        therapists={therapistList}
        {...(supersedes === undefined ? {} : { supersedes })}
        serviceNames={new Map(serviceList.map((service) => [service.id, service.name]))}
        therapistNames={new Map(therapistList.map((t) => [t.id, t.fullName]))}
        csrfToken={(await readCsrfCookie()) ?? ''}
        errorMessage={isKnownErrorCode(code) ? persianMessage(code) : null}
      />
    </>
  );
}
