import type { Room, Service } from '@clinic/contracts';
import {
  Alert,
  ChoiceGroup,
  ChoiceOption,
  Field,
  FormActions,
  PageHeader,
  PageShell,
  Panel,
  SubmitButton,
} from '@/components/ui';
import { COPY } from '@/server/copy-fa';

/**
 * The create and edit form for a room.
 *
 * The restriction question is asked explicitly, as two radio options, rather
 * than inferred from whether the multi-select is empty. In the data those two
 * states are identical — no `room_service` rows means "any service" — so an
 * empty selection is ambiguous to a user in a way it never is to the database.
 * Making the choice explicit is what removes the guess; the Route Handler turns
 * the answer into zero or more rows.
 *
 * Inactive services stay selectable and stay selected. A restriction somebody
 * entered is current configuration, and deactivating a service is not a
 * decision to discard it.
 */
export function RoomForm({
  room,
  services,
  csrfToken,
  errorMessage,
}: {
  room?: Room;
  services: Service[];
  csrfToken: string;
  errorMessage: string | null;
}) {
  const isEdit = room !== undefined;
  const isRestricted = room !== undefined && room.allowedServiceIds.length > 0;

  return (
    <PageShell>
      <PageHeader
        title={isEdit ? COPY.roomEditTitle : COPY.roomNewTitle}
        backHref="/rooms"
        backLabel={COPY.back}
      />

      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}

      <Panel>
        <form
          method="post"
          action={isEdit ? '/api/catalog/rooms/update' : '/api/catalog/rooms/create'}
          className="flex flex-col gap-5"
        >
          <input type="hidden" name="csrfToken" value={csrfToken} />
          {isEdit ? <input type="hidden" name="id" value={room.id} /> : null}

          <Field id="name" label={COPY.roomNameLabel} help={COPY.roomNameHelp} required>
            {({ id, className, describedBy }) => (
              <input
                id={id}
                name="name"
                type="text"
                required
                maxLength={120}
                defaultValue={room?.name ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>

          <ChoiceGroup legend={COPY.roomRestrictionLegend}>
            <ChoiceOption
              id="restriction-all"
              name="restriction"
              value="all"
              label={COPY.roomUnrestrictedLabel}
              description={COPY.roomUnrestrictedDescription}
              defaultChecked={!isRestricted}
            />
            <ChoiceOption
              id="restriction-selected"
              name="restriction"
              value="selected"
              label={COPY.roomRestrictedLabel}
              description={COPY.roomRestrictedDescription}
              defaultChecked={isRestricted}
            />
          </ChoiceGroup>

          {services.length === 0 ? (
            <Alert tone="info">{COPY.roomNoServicesAvailable}</Alert>
          ) : (
            <Field id="serviceIds" label={COPY.roomServicesLabel} help={COPY.roomServicesHelp}>
              {({ id, className, describedBy }) => (
                <select
                  id={id}
                  name="serviceIds"
                  multiple
                  size={Math.min(services.length, 6)}
                  defaultValue={room?.allowedServiceIds ?? []}
                  aria-describedby={describedBy}
                  className={className}
                >
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          <FormActions>
            <SubmitButton>{COPY.save}</SubmitButton>
          </FormActions>
        </form>
      </Panel>
    </PageShell>
  );
}
