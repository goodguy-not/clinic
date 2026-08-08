import type { Metadata } from 'next';
import { api } from '@/server/api-client';
import {
  callerContext,
  readCsrfCookie,
  readSessionToken,
  requireSession,
} from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { clinicToday } from '@/server/clinic-time';
import { TariffList } from './tariff-list';
import { AppHeader } from '@/components/app-header';

export const dynamic = 'force-dynamic';

/** Internal administration is never indexed. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function TariffsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession({ requirePermission: 'tariff.read' });

  const token = await readSessionToken();
  const context = await callerContext(token ?? undefined);

  // Services and therapists are fetched so rows can name what they price rather
  // than showing ids. Page-specific aggregation is what the selective BFF is for.
  const [tariffs, services, therapists] = await Promise.all([
    api.listTariffs({ includeVoided: true }, context),
    api.listServices(context),
    api.listTherapists(context),
  ]);

  const params = await searchParams;
  const rawError = params['error'];
  const code = typeof rawError === 'string' ? rawError : null;
  const voidTariffId = typeof params['void'] === 'string' ? params['void'] : undefined;

  const errorMessage = isKnownErrorCode(code)
    ? persianMessage(code)
    : tariffs.ok
      ? null
      : persianMessage(tariffs.code);

  return (
    <>
      <AppHeader />
      <TariffList
        tariffs={tariffs.ok ? tariffs.data.tariffs : []}
        services={services.ok ? services.data.services : []}
        therapists={therapists.ok ? therapists.data.therapists : []}
        // The clinic's own date, computed on the server. A browser clock that is
        // a day out — or a server running in UTC — would describe a tariff as
        // current when it is not.
        today={clinicToday()}
        csrfToken={(await readCsrfCookie()) ?? ''}
        errorMessage={errorMessage}
        {...(voidTariffId === undefined ? {} : { voidTariffId })}
      />
    </>
  );
}
