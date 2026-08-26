import type { Service } from '@clinic/contracts';
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
 * The service list.
 *
 * Each row carries its own small form for the status change, posting to a
 * dedicated Route Handler — the Milestone 1 staff pattern. A link cannot be
 * used: deactivating is a state change and must not happen on a GET.
 */
export function ServiceList({
  services,
  csrfToken,
  errorMessage,
  canCreate,
  canUpdate,
  canUpdateStatus,
}: {
  services: Service[];
  csrfToken: string;
  errorMessage: string | null;
  canCreate: boolean;
  canUpdate: boolean;
  canUpdateStatus: boolean;
}) {
  return (
    <PageShell>
      <PageHeader
        title={COPY.servicesTitle}
        description={COPY.servicesDescription}
        backHref="/"
        backLabel={COPY.back}
        action={
          canCreate ? (
            <ButtonLink href="/services/new">{COPY.serviceAddAction}</ButtonLink>
          ) : undefined
        }
      />

      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}

      {services.length === 0 ? (
        <EmptyState
          message={COPY.serviceEmpty}
          action={
            canCreate ? (
              <ButtonLink href="/services/new">{COPY.serviceAddAction}</ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <RecordList>
          {services.map((service) => (
            <RecordItem
              key={service.id}
              title={service.name}
              badge={
                <>
                  <StatusBadge
                    active={service.status === 'ACTIVE'}
                    labels={[COPY.statusActive, COPY.statusInactive]}
                  />
                  <StatusBadge
                    active={service.isPublic}
                    labels={[COPY.servicePublicBadge, COPY.servicePrivateBadge]}
                  />
                </>
              }
              details={
                <>
                  <span>
                    {COPY.serviceDurationsValue}:{' '}
                    <span dir="ltr">{service.allowedDurationsMinutes.join('، ')}</span>
                  </span>
                  {service.publicDescription !== null ? (
                    <span className="line-clamp-2">{service.publicDescription}</span>
                  ) : null}
                </>
              }
              actions={
                canUpdate || canUpdateStatus ? (
                  <>
                    {canUpdate ? (
                      <ButtonLink href={`/services/${service.id}/edit`} tone="secondary">
                        {COPY.edit}
                      </ButtonLink>
                    ) : null}

                    {canUpdateStatus ? (
                      <form method="post" action="/api/catalog/services/status">
                        <input type="hidden" name="csrfToken" value={csrfToken} />
                        <input type="hidden" name="id" value={service.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={service.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'}
                        />
                        <SubmitButton tone="secondary">
                          {service.status === 'ACTIVE' ? COPY.deactivate : COPY.activate}
                        </SubmitButton>
                      </form>
                    ) : null}
                  </>
                ) : undefined
              }
            />
          ))}
        </RecordList>
      )}
    </PageShell>
  );
}
