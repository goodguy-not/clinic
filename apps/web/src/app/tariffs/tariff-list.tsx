import type { Service, Tariff, Therapist } from '@clinic/contracts';
import {
  Alert,
  Badge,
  ButtonLink,
  EmptyState,
  Field,
  PageHeader,
  PageShell,
  Panel,
  RecordItem,
  RecordList,
  SubmitButton,
} from '@/components/ui';
import { COPY } from '@/server/copy-fa';
import { isoDateToJalali, JALALI_MONTHS } from '@/server/jalali';
import { formatToman, toPersianDigits } from '@/server/numerals-fa';
import { tariffState, type TariffState } from './tariff-state';

/**
 * The tariff list.
 *
 * Correction is two separate actions, not one: voiding withdraws a price, and
 * replacing it records a new one. A single "edit" button would suggest the row
 * can be changed, which it cannot — the database refuses it.
 *
 * `today` is supplied by the page from the server, never read from the browser.
 */
export function TariffList({
  tariffs,
  services,
  therapists,
  today,
  csrfToken,
  errorMessage,
  voidTariffId,
  canCreate,
  canVoid,
}: {
  tariffs: Tariff[];
  services: Service[];
  therapists: Therapist[];
  today: string;
  csrfToken: string;
  errorMessage: string | null;
  voidTariffId?: string;
  canCreate: boolean;
  canVoid: boolean;
}) {
  const serviceNames = new Map(services.map((service) => [service.id, service.name]));
  const therapistNames = new Map(therapists.map((therapist) => [therapist.id, therapist.fullName]));

  const voiding = canVoid ? tariffs.find((tariff) => tariff.id === voidTariffId) : undefined;

  return (
    <PageShell>
      <PageHeader
        title={COPY.tariffsTitle}
        description={COPY.tariffsDescription}
        backHref="/"
        backLabel={COPY.back}
        action={
          canCreate ? (
            <ButtonLink href="/tariffs/new">{COPY.tariffAddAction}</ButtonLink>
          ) : undefined
        }
      />

      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}

      {voiding !== undefined ? (
        <Panel title={COPY.tariffVoidConfirmTitle}>
          {/*
            Shown before the reason is typed, so the manager confirms what they
            are withdrawing rather than trusting they clicked the right row.
          */}
          <Alert tone="info">{COPY.tariffVoidContextHelp}</Alert>
          <dl className="grid grid-cols-1 gap-1 text-sm text-slate-700 sm:grid-cols-2">
            <div>
              <dt className="inline font-medium">{COPY.tariffServiceDurationLabel}: </dt>
              <dd className="inline">{describeScope(voiding, serviceNames, therapistNames)}</dd>
            </div>
            <div>
              <dt className="inline font-medium">{COPY.tariffPeriodLabel}: </dt>
              <dd className="inline">{describePeriod(voiding)}</dd>
            </div>
            <div>
              <dt className="inline font-medium">{COPY.tariffPriceLabel}: </dt>
              <dd className="inline">{describePrice(voiding)}</dd>
            </div>
          </dl>

          <form method="post" action="/api/catalog/tariffs/void" className="flex flex-col gap-4">
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input type="hidden" name="id" value={voiding.id} />

            <Field
              id="voidReason"
              label={COPY.tariffVoidReasonLabelInput}
              help={COPY.tariffVoidReasonHelp}
              required
            >
              {({ id, className, describedBy }) => (
                <input
                  id={id}
                  name="reason"
                  type="text"
                  required
                  maxLength={500}
                  aria-describedby={describedBy}
                  className={className}
                />
              )}
            </Field>

            <div className="flex flex-col gap-2 sm:flex-row">
              <SubmitButton>{COPY.tariffVoidAction}</SubmitButton>
              <ButtonLink href="/tariffs" tone="secondary">
                {COPY.cancel}
              </ButtonLink>
            </div>
          </form>
        </Panel>
      ) : null}

      {tariffs.length === 0 ? (
        <EmptyState
          message={COPY.tariffEmpty}
          action={
            canCreate ? (
              <ButtonLink href="/tariffs/new">{COPY.tariffAddAction}</ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <RecordList>
          {tariffs.map((tariff) => {
            const state = tariffState(tariff, today);

            return (
              <RecordItem
                key={tariff.id}
                title={describeScope(tariff, serviceNames, therapistNames)}
                badge={
                  <>
                    <StateBadge state={state} />
                    {tariff.priceMode === 'FREE' ? (
                      <Badge tone="info">{COPY.tariffFreeBadge}</Badge>
                    ) : null}
                  </>
                }
                details={
                  <>
                    <span className="font-medium text-slate-900">{describePrice(tariff)}</span>
                    <span>
                      {COPY.tariffPeriodLabel}: {describePeriod(tariff)}
                    </span>
                    {tariff.freeReason !== null ? <span>{tariff.freeReason}</span> : null}
                    {tariff.voidReason !== null ? (
                      <span>
                        {COPY.tariffVoidReasonLabel}: {tariff.voidReason}
                      </span>
                    ) : null}
                  </>
                }
                actions={
                  state === 'voided' || (!canCreate && !canVoid) ? null : (
                    <>
                      {canCreate ? (
                        <ButtonLink href={`/tariffs/new?supersedes=${tariff.id}`} tone="secondary">
                          {COPY.tariffCorrectAction}
                        </ButtonLink>
                      ) : null}
                      {/*
                        A link, not a form: it opens the confirmation panel above
                        rather than performing the void, so the state change is
                        still a POST with a typed reason.
                      */}
                      {canVoid ? (
                        <ButtonLink href={`/tariffs?void=${tariff.id}`} tone="secondary">
                          {COPY.tariffVoidAction}
                        </ButtonLink>
                      ) : null}
                    </>
                  )
                }
              />
            );
          })}
        </RecordList>
      )}
    </PageShell>
  );
}

function StateBadge({ state }: { state: TariffState }) {
  const tones: Record<TariffState, 'success' | 'warning' | 'neutral' | 'danger'> = {
    current: 'success',
    future: 'warning',
    expired: 'neutral',
    voided: 'danger',
  };

  const labels: Record<TariffState, string> = {
    current: COPY.tariffStateCurrent,
    future: COPY.tariffStateFuture,
    expired: COPY.tariffStateExpired,
    voided: COPY.tariffStateVoided,
  };

  return <Badge tone={tones[state]}>{labels[state]}</Badge>;
}

function describeScope(
  tariff: Tariff,
  serviceNames: Map<string, string>,
  therapistNames: Map<string, string>,
): string {
  const service = serviceNames.get(tariff.serviceId) ?? tariff.serviceId;
  const duration = `${toPersianDigits(String(tariff.durationMinutes))} دقیقه`;
  const scope =
    tariff.therapistId === null
      ? COPY.tariffScopeGeneralBadge
      : (therapistNames.get(tariff.therapistId) ?? tariff.therapistId);

  return `${service} — ${duration} — ${scope}`;
}

function describePrice(tariff: Tariff): string {
  return tariff.priceMode === 'FREE' ? COPY.tariffFreeBadge : formatToman(tariff.priceToman);
}

/** Jalali for reading; the stored value stays Gregorian. */
export function formatJalali(isoDate: string): string {
  const parts = isoDateToJalali(isoDate);
  if (parts === null) return isoDate;

  const month = JALALI_MONTHS[parts.month - 1] ?? String(parts.month);

  return `${toPersianDigits(String(parts.day))} ${month} ${toPersianDigits(String(parts.year))}`;
}

function describePeriod(tariff: Tariff): string {
  const start = formatJalali(tariff.effectiveStart);

  return tariff.effectiveEnd === null
    ? `${start} —`
    : `${start} تا ${formatJalali(tariff.effectiveEnd)}`;
}
