import type { Metadata } from 'next';
import { AppHeader } from '@/components/app-header';
import { api } from '@/server/api-client';
import { callerContext, readSessionToken, requireSession } from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { AvailabilityList } from './availability-list';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AvailabilityPage() {
  await requireSession({ requirePermission: 'availability.read' });
  const token = await readSessionToken();
  const result = await api.listTherapists(await callerContext(token ?? undefined));

  return (
    <>
      <AppHeader />
      <AvailabilityList
        therapists={result.ok ? result.data.therapists : []}
        errorMessage={result.ok ? null : persianMessage(result.code)}
      />
    </>
  );
}
