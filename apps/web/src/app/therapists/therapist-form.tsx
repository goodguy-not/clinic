import type { Service, Therapist } from '@clinic/contracts';
import {
  Alert,
  ChoiceGroup,
  ChoiceOption,
  Field,
  FormActions,
  PageHeader,
  PageShell,
  Panel,
  StatusBadge,
  SubmitButton,
} from '@/components/ui';
import { COPY } from '@/server/copy-fa';

/**
 * The create and edit form for a therapist.
 *
 * Services are checkboxes rather than a native `<select multiple>`. A
 * multi-select hides the unselected options behind a scroll, needs a modifier
 * key most people do not know about, and is awkward on a phone — where a
 * receptionist is as likely to be as at a desk. Checkboxes show every service
 * at once, are reachable by tab and space alone, and need no client JavaScript
 * either.
 *
 * An inactive service stays listed, stays checked if it was, and is marked as
 * inactive. Hiding or silently unchecking it would discard a decision somebody
 * made, and saving the form would then quietly remove the association.
 *
 * There are no credential fields, and there is no settlement percentage. A
 * therapist here is a record staff manage, not an account.
 */
export function TherapistForm({
  therapist,
  services,
  csrfToken,
  errorMessage,
}: {
  therapist?: Therapist;
  services: Service[];
  csrfToken: string;
  errorMessage: string | null;
}) {
  const isEdit = therapist !== undefined;
  const selected = new Set(therapist?.supportedServiceIds ?? []);

  return (
    <PageShell>
      <PageHeader
        title={isEdit ? COPY.therapistEditTitle : COPY.therapistNewTitle}
        backHref="/therapists"
        backLabel={COPY.back}
      />

      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}

      <Panel>
        <form
          method="post"
          action={isEdit ? '/api/catalog/therapists/update' : '/api/catalog/therapists/create'}
          className="flex flex-col gap-5"
        >
          <input type="hidden" name="csrfToken" value={csrfToken} />
          {isEdit ? <input type="hidden" name="id" value={therapist.id} /> : null}

          <Field
            id="fullName"
            label={COPY.therapistFullNameLabel}
            help={COPY.therapistFullNameHelp}
            required
          >
            {({ id, className, describedBy }) => (
              <input
                id={id}
                name="fullName"
                type="text"
                required
                maxLength={120}
                defaultValue={therapist?.fullName ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>

          <Field
            id="specialty"
            label={COPY.therapistSpecialtyLabel}
            help={COPY.therapistSpecialtyHelp}
            required
          >
            {({ id, className, describedBy }) => (
              <input
                id={id}
                name="specialty"
                type="text"
                required
                maxLength={120}
                defaultValue={therapist?.specialty ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>

          {services.length === 0 ? (
            <Alert tone="info">{COPY.therapistNoServicesAvailable}</Alert>
          ) : (
            <ChoiceGroup legend={COPY.therapistServicesLegend} help={COPY.therapistServicesHelp}>
              {services.map((service) => (
                <ChoiceOption
                  key={service.id}
                  id={`service-${service.id}`}
                  name="serviceIds"
                  value={service.id}
                  type="checkbox"
                  label={service.name}
                  defaultChecked={selected.has(service.id)}
                  badge={
                    service.status === 'INACTIVE' ? (
                      <StatusBadge
                        active={false}
                        labels={[COPY.statusActive, COPY.serviceInactiveBadge]}
                      />
                    ) : undefined
                  }
                />
              ))}
            </ChoiceGroup>
          )}

          <FormActions>
            <SubmitButton>{COPY.save}</SubmitButton>
          </FormActions>
        </form>
      </Panel>
    </PageShell>
  );
}
