import type { Therapist } from '@clinic/contracts';
import {
  Alert,
  ButtonLink,
  EmptyState,
  PageHeader,
  PageShell,
  RecordItem,
  RecordList,
  StatusBadge,
} from '@/components/ui';
import { COPY } from '@/server/copy-fa';

export function AvailabilityList({
  therapists,
  errorMessage,
}: {
  therapists: Therapist[];
  errorMessage: string | null;
}) {
  return (
    <PageShell>
      <PageHeader
        title={COPY.availabilityTitle}
        description={COPY.availabilityChooseTherapist}
        backHref="/"
        backLabel={COPY.back}
      />

      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}

      {therapists.length === 0 ? (
        <EmptyState message={COPY.availabilityEmptyTherapists} />
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
              details={<span>{therapist.specialty}</span>}
              actions={
                <ButtonLink href={`/therapists/${therapist.id}/availability`} tone="secondary">
                  {COPY.availabilityViewAction}
                </ButtonLink>
              }
            />
          ))}
        </RecordList>
      )}
    </PageShell>
  );
}
