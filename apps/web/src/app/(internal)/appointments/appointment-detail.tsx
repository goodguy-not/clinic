import Link from 'next/link';
import type { AppointmentView, SessionChargeDetail } from '@clinic/contracts';
import {
  Alert,
  Badge,
  ButtonLink,
  ChoiceGroup,
  ChoiceOption,
  Field,
  FOCUS_RING,
  FormActions,
  PageHeader,
  PageShell,
  Panel,
  SubmitButton,
} from '@/components/ui';
import { COPY } from '@/server/copy-fa';
import { toPersianDigits } from '@/server/numerals-fa';
import { appointmentChargeState, type ParticipantChargeLookup } from '@/ledger/appointment-charge';
import { formatChargeMoney } from '@/ledger/presentation';
import {
  APPOINTMENT_STATUS_PRESENTATION,
  ATTENDANCE_PRESENTATION,
  appointmentDateTimeLabel,
  appointmentInstantInClinic,
} from '@/scheduling/appointment-presentation';

const MONEY = new Intl.NumberFormat('fa-IR');

function HiddenWriteFields({ id, csrfToken }: { id: string; csrfToken: string }) {
  return (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="csrfToken" value={csrfToken} />
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-slate-50 px-3 py-2">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="text-sm font-semibold text-slate-900">{children}</dd>
    </div>
  );
}

function TariffSuggestion({ view }: { view: AppointmentView }) {
  const tariff = view.tariffSuggestion;

  return (
    <Panel title={COPY.appointmentTariffTitle}>
      {tariff.status === 'MISSING' ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <div className="mb-1 flex items-center gap-2 font-bold">
            <Badge tone="warning">تعرفه ثبت نشده</Badge>
          </div>
          <p>{COPY.appointmentTariffMissing}</p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-brand-50 px-4 py-3">
          <span className="font-bold text-brand-950">
            {tariff.priceMode === 'FREE'
              ? COPY.appointmentFreeTariff
              : `${MONEY.format(BigInt(tariff.priceToman))} تومان`}
          </span>
          <Badge tone="info">فقط خواندنی</Badge>
        </div>
      )}
      <p className="text-xs text-slate-600">{COPY.appointmentTariffReadOnly}</p>
    </Panel>
  );
}

function HistoricalCharge({ charge }: { charge: SessionChargeDetail }) {
  const money = formatChargeMoney(charge);

  return (
    <div className="rounded-lg border border-red-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone="danger">{COPY.appointmentChargeVoidedHistory}</Badge>
        <span>{COPY.appointmentChargeVoidedHelp}</span>
      </div>
      <p>
        {COPY.familyAccountEffectiveAmount}: <bdi className="font-semibold">{money.effective}</bdi>
      </p>
      {charge.voidReason !== null ? (
        <p>
          {COPY.familyAccountVoidReason}: {charge.voidReason}
        </p>
      ) : null}
    </div>
  );
}

function ChargeMoney({ charge }: { charge: SessionChargeDetail }) {
  const money = formatChargeMoney(charge);
  const fullyAdjusted = charge.priceMode === 'PAID' && charge.effectiveAmountToman === '0';

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="success">{COPY.appointmentChargePosted}</Badge>
        {charge.priceMode === 'FREE' ? (
          <Badge tone="info">{COPY.appointmentChargeFree}</Badge>
        ) : null}
        {fullyAdjusted ? <Badge tone="info">{COPY.appointmentChargeFullyAdjusted}</Badge> : null}
      </div>
      {charge.priceMode === 'FREE' ? (
        <p className="text-sm font-semibold text-emerald-950">
          {COPY.appointmentChargeFree} — <bdi>{money.effective}</bdi>
        </p>
      ) : (
        <dl className="grid gap-2 sm:grid-cols-2">
          <Fact label={COPY.appointmentChargeOriginal}>
            <bdi>{money.charged}</bdi>
          </Fact>
          <Fact label={COPY.appointmentChargeEffective}>
            <bdi>{money.effective}</bdi>
          </Fact>
        </dl>
      )}
    </div>
  );
}

function ChargePanel({
  view,
  charges,
  csrfToken,
  canPostCharge,
}: {
  view: AppointmentView;
  charges: ParticipantChargeLookup;
  csrfToken: string;
  canPostCharge: boolean;
}) {
  return (
    <Panel title={COPY.appointmentChargeTitle}>
      {view.participants.map(({ participant, child }) => {
        const state = appointmentChargeState(view, participant.id, charges[participant.id]);
        const historicalCharge =
          state.kind === 'UNPRICED' ||
          state.kind === 'READY_TO_POST' ||
          state.kind === 'NOT_CHARGEABLE'
            ? state.historicalCharge
            : undefined;
        const noChargeHelp =
          view.appointment.status === 'CANCELLED_BY_FAMILY' ||
          view.appointment.status === 'CANCELLED_BY_CLINIC'
            ? COPY.appointmentChargeCancelledHelp
            : participant.attendance === 'NO_SHOW'
              ? COPY.appointmentChargeNoShowHelp
              : COPY.appointmentChargeNotChargeableHelp;

        return (
          <section
            key={participant.id}
            aria-label={`${COPY.appointmentChargeTitle} ${child.firstName} ${child.lastName}`}
            className="flex flex-col gap-3"
          >
            {view.participants.length > 1 ? (
              <h3 className="text-sm font-bold text-slate-900">
                {child.firstName} {child.lastName}
              </h3>
            ) : null}

            {historicalCharge !== undefined ? <HistoricalCharge charge={historicalCharge} /> : null}

            {state.kind === 'CHARGED' ? <ChargeMoney charge={state.charge} /> : null}

            {state.kind === 'UNPRICED' ? (
              <div
                role="status"
                className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2 font-bold">
                  <Badge tone="warning">{COPY.appointmentChargeUnpriced}</Badge>
                </div>
                <p>{COPY.appointmentChargeUnpricedHelp}</p>
                <p className="mt-1">{COPY.appointmentChargeRepostHelp}</p>
                {canPostCharge ? (
                  <form method="post" action="/api/ledger/session-charges/post" className="mt-3">
                    <input type="hidden" name="appointmentId" value={view.appointment.id} />
                    <input type="hidden" name="participantId" value={participant.id} />
                    <input type="hidden" name="csrfToken" value={csrfToken} />
                    <SubmitButton>{COPY.appointmentChargePostAction}</SubmitButton>
                  </form>
                ) : null}
              </div>
            ) : null}

            {state.kind === 'READY_TO_POST' ? (
              <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-950">
                <div className="mb-2">
                  <Badge tone="info">{COPY.appointmentChargeReady}</Badge>
                </div>
                <p>{COPY.appointmentChargeReadyHelp}</p>
                {canPostCharge ? (
                  <form method="post" action="/api/ledger/session-charges/post" className="mt-3">
                    <input type="hidden" name="appointmentId" value={view.appointment.id} />
                    <input type="hidden" name="participantId" value={participant.id} />
                    <input type="hidden" name="csrfToken" value={csrfToken} />
                    <SubmitButton>{COPY.appointmentChargePostAction}</SubmitButton>
                  </form>
                ) : null}
              </div>
            ) : null}

            {state.kind === 'NOT_CHARGEABLE' ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <div className="mb-2">
                  <Badge tone="neutral">{COPY.appointmentChargeNotChargeable}</Badge>
                </div>
                <p>{noChargeHelp}</p>
              </div>
            ) : null}

            {state.kind === 'UNAVAILABLE' ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                {COPY.appointmentChargeUnavailable}
              </p>
            ) : null}
          </section>
        );
      })}
    </Panel>
  );
}

export function AppointmentDetail({
  view,
  csrfToken,
  errorMessage,
  successMessage,
  canUpdate,
  canCancel,
  canComplete,
  canReopen,
  charges,
  canReadCharges,
  canPostCharge,
}: {
  view: AppointmentView;
  csrfToken: string;
  errorMessage: string | null;
  successMessage: string | null;
  canUpdate: boolean;
  canCancel: boolean;
  canComplete: boolean;
  canReopen: boolean;
  charges: ParticipantChargeLookup;
  canReadCharges: boolean;
  canPostCharge: boolean;
}) {
  const { appointment } = view;
  const seat = view.participants[0];
  const child = seat?.child;
  const participant = seat?.participant;
  const status = APPOINTMENT_STATUS_PRESENTATION[appointment.status];
  const dayDate = appointmentInstantInClinic(appointment.startsAt)?.date;
  const scheduled = appointment.status === 'SCHEDULED';
  const completed = appointment.status === 'COMPLETED';
  const mutableOutcome = scheduled || completed;

  return (
    <PageShell>
      <PageHeader
        title={COPY.appointmentDetailTitle}
        description={appointmentDateTimeLabel(appointment.startsAt)}
        backHref={dayDate === undefined ? '/appointments' : `/appointments?date=${dayDate}`}
        backLabel={COPY.appointmentsTitle}
        action={
          appointment.seriesId !== null ? (
            <div className="flex flex-wrap gap-2">
              <ButtonLink href={`/appointment-series/${appointment.seriesId}`} tone="secondary">
                مدیریت مجموعه
              </ButtonLink>
              {scheduled && canUpdate ? (
                <ButtonLink href={`/appointments/${appointment.id}/edit`} tone="secondary">
                  {COPY.appointmentMoveAction}
                </ButtonLink>
              ) : null}
            </div>
          ) : scheduled && canUpdate ? (
            <ButtonLink href={`/appointments/${appointment.id}/edit`} tone="secondary">
              {COPY.appointmentMoveAction}
            </ButtonLink>
          ) : undefined
        }
      />

      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}
      {successMessage !== null ? <Alert tone="info">{successMessage}</Alert> : null}
      {view.outcomeUnresolved ? (
        <div
          role="status"
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950"
        >
          نتیجهٔ این جلسه هنوز ثبت نشده است. حضور کودک را مشخص کنید.
        </div>
      ) : null}

      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="me-auto text-lg font-bold text-slate-950">
            {child === undefined ? 'کودک ثبت‌نشده' : `${child.firstName} ${child.lastName}`}
          </h2>
          <Badge tone={status.badgeTone}>{status.label}</Badge>
          {participant !== undefined ? (
            <Badge tone={ATTENDANCE_PRESENTATION[participant.attendance].tone}>
              {ATTENDANCE_PRESENTATION[participant.attendance].label}
            </Badge>
          ) : null}
        </div>
        <dl className="grid gap-2 sm:grid-cols-2">
          <Fact label={COPY.appointmentService}>{view.service.name}</Fact>
          <Fact label={COPY.appointmentTherapist}>{view.therapist.fullName}</Fact>
          <Fact label={COPY.appointmentRoom}>{view.room.name}</Fact>
          <Fact label={COPY.appointmentDuration}>
            {toPersianDigits(String(appointment.durationMinutes))} دقیقه
          </Fact>
          {child !== undefined ? (
            <Fact label={COPY.appointmentFileNumber}>
              <Link
                href={`/families/${child.familyId}`}
                className={`text-brand-800 underline-offset-4 hover:underline ${FOCUS_RING}`}
              >
                {toPersianDigits(child.fileNumber)}
              </Link>
            </Fact>
          ) : null}
          {appointment.availabilityOverrideReason !== null ? (
            <Fact label={COPY.appointmentAvailabilityOverridden}>
              {appointment.availabilityOverrideReason}
            </Fact>
          ) : null}
          {appointment.cancellationReason !== null ? (
            <Fact label={COPY.appointmentCancellationReason}>{appointment.cancellationReason}</Fact>
          ) : null}
        </dl>
        <div className="rounded-lg border border-slate-200 px-3 py-2">
          <h3 className="text-xs font-medium text-slate-500">{COPY.appointmentNote}</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
            {appointment.note ?? COPY.appointmentNoNote}
          </p>
        </div>
      </Panel>

      <TariffSuggestion view={view} />

      {canReadCharges ? (
        <ChargePanel
          view={view}
          charges={charges}
          csrfToken={csrfToken}
          canPostCharge={canPostCharge}
        />
      ) : null}

      {mutableOutcome && canComplete && participant !== undefined ? (
        <Panel title={COPY.appointmentAttendanceTitle}>
          <p className="text-sm text-slate-600">{COPY.appointmentAttendanceCorrection}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {participant.attendance !== 'ATTENDED' ? (
              <form method="post" action="/api/appointments/attendance">
                <HiddenWriteFields id={appointment.id} csrfToken={csrfToken} />
                <input type="hidden" name="participantId" value={participant.id} />
                <input type="hidden" name="attendance" value="ATTENDED" />
                <SubmitButton>{COPY.appointmentAttendedAction}</SubmitButton>
              </form>
            ) : null}
            {participant.attendance !== 'NO_SHOW' ? (
              <form method="post" action="/api/appointments/attendance">
                <HiddenWriteFields id={appointment.id} csrfToken={csrfToken} />
                <input type="hidden" name="participantId" value={participant.id} />
                <input type="hidden" name="attendance" value="NO_SHOW" />
                <SubmitButton tone="danger">{COPY.appointmentNoShowAction}</SubmitButton>
              </form>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {scheduled && (canComplete || canCancel) ? (
        <Panel title="عملیات نوبت">
          {canComplete ? (
            <form
              method="post"
              action="/api/appointments/complete"
              className="rounded-lg border border-emerald-200 bg-emerald-50 p-3"
            >
              <HiddenWriteFields id={appointment.id} csrfToken={csrfToken} />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-emerald-950">
                  پس از پایان جلسه، انجام آن را ثبت کنید. نتیجهٔ حضور جداگانه نگهداری می‌شود.
                </p>
                <SubmitButton>{COPY.appointmentCompleteAction}</SubmitButton>
              </div>
            </form>
          ) : null}

          {canCancel ? (
            <details className="rounded-lg border border-red-200 bg-white p-3">
              <summary
                className={`cursor-pointer rounded-sm text-sm font-bold text-red-800 ${FOCUS_RING}`}
              >
                {COPY.appointmentCancelTitle}
              </summary>
              <form
                method="post"
                action="/api/appointments/cancel"
                className="mt-4 flex flex-col gap-4"
              >
                <HiddenWriteFields id={appointment.id} csrfToken={csrfToken} />
                <ChoiceGroup legend={COPY.appointmentCancelParty}>
                  <ChoiceOption
                    id="cancel-family"
                    name="cancelledBy"
                    value="FAMILY"
                    label={COPY.appointmentCancelFamily}
                    defaultChecked
                  />
                  <ChoiceOption
                    id="cancel-clinic"
                    name="cancelledBy"
                    value="CLINIC"
                    label={COPY.appointmentCancelClinic}
                  />
                </ChoiceGroup>
                <Field id="cancel-reason" label={COPY.appointmentCancelReason} required>
                  {({ id, className }) => (
                    <textarea
                      id={id}
                      name="reason"
                      required
                      maxLength={500}
                      rows={3}
                      className={className}
                    />
                  )}
                </Field>
                <FormActions>
                  <SubmitButton tone="danger">{COPY.appointmentCancelAction}</SubmitButton>
                </FormActions>
              </form>
            </details>
          ) : null}
        </Panel>
      ) : null}

      {completed && canReopen ? (
        <Panel title={COPY.appointmentReopenTitle}>
          <p className="text-sm text-slate-600">{COPY.appointmentManagerOnly}</p>
          <form method="post" action="/api/appointments/reopen" className="flex flex-col gap-4">
            <HiddenWriteFields id={appointment.id} csrfToken={csrfToken} />
            <Field id="reopen-reason" label={COPY.appointmentReopenReason} required>
              {({ id, className }) => (
                <textarea
                  id={id}
                  name="reason"
                  required
                  maxLength={500}
                  rows={3}
                  className={className}
                />
              )}
            </Field>
            <FormActions>
              <SubmitButton tone="danger">{COPY.appointmentReopenAction}</SubmitButton>
            </FormActions>
          </form>
        </Panel>
      ) : null}
    </PageShell>
  );
}
