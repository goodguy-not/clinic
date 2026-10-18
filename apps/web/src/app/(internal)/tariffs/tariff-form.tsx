import type { Service, Tariff, Therapist } from '@clinic/contracts';
import {
  Alert,
  Field,
  FormActions,
  PageHeader,
  PageShell,
  Panel,
  SubmitButton,
} from '@/components/ui';
import { COPY } from '@/server/copy-fa';
import { isoDateToJalali } from '@/server/jalali';
import { toPersianDigits } from '@/server/numerals-fa';
import { JalaliDateField } from './jalali-date-field';
import { TariffConditionalFields } from './tariff-conditional-fields';

/**
 * The tariff creation form, also used for a correction.
 *
 * Service and duration are one select, not two. With no client JavaScript a
 * separate duration list cannot react to the chosen service, so it would offer
 * durations that service does not have and rely on the server to refuse them.
 * One list of real combinations makes the invalid pairing unrepresentable.
 *
 * When correcting, `supersedes` fixes the scope: the replacement must price the
 * same service, duration and therapist, and the API refuses anything else. The
 * fields are therefore shown as read-only text plus hidden inputs rather than
 * as editable controls that would silently fail.
 *
 * The interactive fields render only the selected scope and price branch.
 */
export function TariffForm({
  services,
  therapists,
  supersedes,
  serviceNames,
  therapistNames,
  csrfToken,
  errorMessage,
}: {
  services: Service[];
  therapists: Therapist[];
  supersedes?: Tariff;
  serviceNames: Map<string, string>;
  therapistNames: Map<string, string>;
  csrfToken: string;
  errorMessage: string | null;
}) {
  const isCorrection = supersedes !== undefined;

  // Only active services with at least one duration can be priced. A service
  // with no durations has nothing to price, and an inactive one is not offered.
  const combinations = services
    .filter((service) => service.status === 'ACTIVE' && service.allowedDurationsMinutes.length > 0)
    .flatMap((service) =>
      service.allowedDurationsMinutes.map((minutes) => ({
        value: `${service.id}:${minutes}`,
        label: `${service.name} — ${toPersianDigits(String(minutes))} دقیقه`,
      })),
    );

  const activeTherapists = therapists.filter((therapist) => therapist.status === 'ACTIVE');
  const startValue = supersedes === undefined ? null : isoDateToJalali(supersedes.effectiveStart);

  return (
    <PageShell>
      <PageHeader
        title={isCorrection ? COPY.tariffCorrectTitle : COPY.tariffNewTitle}
        backHref="/tariffs"
        backLabel={COPY.back}
      />

      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}
      {isCorrection ? <Alert tone="info">{COPY.tariffSupersedeNotice}</Alert> : null}

      {combinations.length === 0 && !isCorrection ? (
        <Alert tone="info">{COPY.tariffNoServiceDurations}</Alert>
      ) : (
        <Panel>
          <form method="post" action="/api/catalog/tariffs/create" className="flex flex-col gap-5">
            <input type="hidden" name="csrfToken" value={csrfToken} />

            {isCorrection ? (
              <>
                {/* Scope is fixed by the tariff being replaced, and shown so the
                    manager can see what they are correcting. */}
                <input
                  type="hidden"
                  name="serviceDuration"
                  value={`${supersedes.serviceId}:${supersedes.durationMinutes}`}
                />
                <input
                  type="hidden"
                  name="scope"
                  value={supersedes.therapistId === null ? 'general' : 'therapist'}
                />
                {supersedes.therapistId !== null ? (
                  <input type="hidden" name="therapistId" value={supersedes.therapistId} />
                ) : null}
                <input type="hidden" name="supersedesTariffId" value={supersedes.id} />

                <dl className="flex flex-col gap-1 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <div>
                    <dt className="inline font-medium">{COPY.tariffServiceDurationLabel}: </dt>
                    <dd className="inline">
                      {serviceNames.get(supersedes.serviceId) ?? supersedes.serviceId} —{' '}
                      {toPersianDigits(String(supersedes.durationMinutes))} دقیقه
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">{COPY.tariffScopeLegend}: </dt>
                    <dd className="inline">
                      {supersedes.therapistId === null
                        ? COPY.tariffScopeGeneralBadge
                        : (therapistNames.get(supersedes.therapistId) ?? supersedes.therapistId)}
                    </dd>
                  </div>
                </dl>
              </>
            ) : (
              <>
                <Field
                  id="serviceDuration"
                  label={COPY.tariffServiceDurationLabel}
                  help={COPY.tariffServiceDurationHelp}
                  required
                >
                  {({ id, className, describedBy }) => (
                    <select
                      id={id}
                      name="serviceDuration"
                      required
                      defaultValue=""
                      aria-describedby={describedBy}
                      className={className}
                    >
                      <option value="" disabled>
                        —
                      </option>
                      {combinations.map((combination) => (
                        <option key={combination.value} value={combination.value}>
                          {combination.label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </>
            )}

            <TariffConditionalFields
              activeTherapists={activeTherapists}
              isCorrection={isCorrection}
            />

            <JalaliDateField
              legend={COPY.tariffEffectiveStartLabel}
              namePrefix="start"
              value={startValue}
              required
            />

            <JalaliDateField
              legend={COPY.tariffEffectiveEndLabel}
              help={COPY.tariffEffectiveEndHelp}
              namePrefix="end"
            />

            <FormActions>
              <SubmitButton>{COPY.save}</SubmitButton>
            </FormActions>
          </form>
        </Panel>
      )}
    </PageShell>
  );
}
