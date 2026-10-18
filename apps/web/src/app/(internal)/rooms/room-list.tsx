import type { Room, Service } from '@clinic/contracts';
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

export function RoomList({
  rooms,
  services,
  csrfToken,
  errorMessage,
  canCreate,
  canUpdate,
  canUpdateStatus,
}: {
  rooms: Room[];
  services: Service[];
  csrfToken: string;
  errorMessage: string | null;
  canCreate: boolean;
  canUpdate: boolean;
  canUpdateStatus: boolean;
}) {
  // Names rather than ids: an id tells a manager nothing about which services a
  // room is limited to.
  const serviceNames = new Map(services.map((service) => [service.id, service.name]));

  return (
    <PageShell>
      <PageHeader
        title={COPY.roomsTitle}
        description={COPY.roomsDescription}
        backHref="/"
        backLabel={COPY.back}
        action={
          canCreate ? <ButtonLink href="/rooms/new">{COPY.roomAddAction}</ButtonLink> : undefined
        }
      />

      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}

      {rooms.length === 0 ? (
        <EmptyState
          message={COPY.roomEmpty}
          action={
            canCreate ? <ButtonLink href="/rooms/new">{COPY.roomAddAction}</ButtonLink> : undefined
          }
        />
      ) : (
        <RecordList>
          {rooms.map((room) => (
            <RecordItem
              key={room.id}
              title={room.name}
              badge={
                <StatusBadge
                  active={room.status === 'ACTIVE'}
                  labels={[COPY.statusActive, COPY.statusInactive]}
                />
              }
              details={
                room.allowedServiceIds.length === 0 ? (
                  <span>{COPY.roomUnrestrictedBadge}</span>
                ) : (
                  <span>
                    {COPY.roomRestrictedCountLabel}:{' '}
                    {room.allowedServiceIds.map((id) => serviceNames.get(id) ?? id).join('، ')}
                  </span>
                )
              }
              actions={
                canUpdate || canUpdateStatus ? (
                  <>
                    {canUpdate ? (
                      <ButtonLink href={`/rooms/${room.id}/edit`} tone="secondary">
                        {COPY.edit}
                      </ButtonLink>
                    ) : null}

                    {canUpdateStatus ? (
                      <form method="post" action="/api/catalog/rooms/status">
                        <input type="hidden" name="csrfToken" value={csrfToken} />
                        <input type="hidden" name="id" value={room.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={room.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'}
                        />
                        <SubmitButton tone="secondary">
                          {room.status === 'ACTIVE' ? COPY.deactivate : COPY.activate}
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
