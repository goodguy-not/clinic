import type { Service, Therapist } from '@clinic/contracts';
import {
  Alert,
  ButtonLink,
  EmptyState,
  PageHeader,
  PageShell,
  RecordItem,
  RecordList,
  StatusBadge,
  SubmitButton,
} from '@/components/ui';
import { COPY } from '@/server/copy-fa';

/**
 * The therapist list.
 *
 * Each row carries its own form for the status change, posting to a dedicated
 * Route Handler. A link cannot be used: deactivating is a state change and must
 * not happen on a GET.
 */
export function TherapistList({
  therapists,
  services,
  csrfToken,
  errorMessage,
}: {
  therapists: Therapist[];
  services: Service[];
  csrfToken: string;
  errorMessage: string | null;
}) {
  // Names rather than ids: an id tells a manager nothing about what a therapist
  // actually does.
  const serviceNames = new Map(services.map((service) => [service.id, service.name]));

  return (
    <PageShell>
      <PageHeader
        title={COPY.therapistsTitle}
        description={COPY.therapistsDescription}
        backHref="/"
        backLabel={COPY.back}
        action={<ButtonLink href="/therapists/new">{COPY.therapistAddAction}</ButtonLink>}
      />

      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}

      {therapists.length === 0 ? (
        <EmptyState
          message={COPY.therapistEmpty}
          action={<ButtonLink href="/therapists/new">{COPY.therapistAddAction}</ButtonLink>}
        />
      ) : (
        <RecordList>
          {therapists.map((therapist) => (
            <RecordItem
              key={therapist.id}
              title={therapist.fullName}
              badge={
                <StatusBadge
                  active={therapist.status === 'ACTIVE'}
                  labels={[COPY.statusActive, COPY.statusInactive]}
                />
              }
              details={
                <>
                  <span>{therapist.specialty}</span>
                  {therapist.supportedServiceIds.length === 0 ? (
                    // Said plainly: no assigned services is a normal state for a
                    // newly entered therapist, not a broken row.
                    <span>{COPY.therapistNoServices}</span>
                  ) : (
                    <span>
                      {COPY.therapistServicesValue}:{' '}
                      {therapist.supportedServiceIds
                        .map((id) => serviceNames.get(id) ?? id)
                        .join('، ')}
                    </span>
                  )}
                </>
              }
              actions={
                <>
                  <ButtonLink href={`/therapists/${therapist.id}/edit`} tone="secondary">
                    {COPY.edit}
                  </ButtonLink>

                  <form method="post" action="/api/catalog/therapists/status">
                    <input type="hidden" name="csrfToken" value={csrfToken} />
                    <input type="hidden" name="id" value={therapist.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={therapist.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'}
                    />
                    <SubmitButton tone="secondary">
                      {therapist.status === 'ACTIVE' ? COPY.deactivate : COPY.activate}
                    </SubmitButton>
                  </form>
                </>
              }
            />
          ))}
        </RecordList>
      )}
    </PageShell>
  );
}
