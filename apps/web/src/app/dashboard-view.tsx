import Link from 'next/link';
import type { DashboardResponse } from '@clinic/contracts';
import { Badge, ButtonLink, EmptyState, FOCUS_RING, PageHeader, PageShell } from '@/components/ui';
import { COPY } from '@/server/copy-fa';
import { formatToman, toPersianDigits } from '@/server/numerals-fa';
import { dashboardDateLabel, paymentMethodLabel } from '@/dashboard/presentation';

const count = (value: number): string => toPersianDigits(String(value));

function Metric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'warning' | 'danger' | 'success';
}) {
  const colors = {
    neutral: 'border-slate-200 bg-white',
    warning: 'border-amber-200 bg-amber-50/60',
    danger: 'border-red-200 bg-red-50/60',
    success: 'border-emerald-200 bg-emerald-50/60',
  }[tone];
  return (
    <div className={`flex min-w-0 flex-col gap-1 rounded-xl border p-4 ${colors}`}>
      <span className="text-2xl font-bold tabular-nums text-slate-950">{count(value)}</span>
      <span className="text-sm text-slate-600">{label}</span>
    </div>
  );
}

function AttentionRow({
  href,
  label,
  value,
  urgent = false,
}: {
  href: string;
  label: string;
  value: number;
  urgent?: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        className={`flex min-h-12 items-center justify-between gap-3 rounded-lg border px-3 py-2 transition-colors hover:border-brand-300 hover:bg-brand-50 ${urgent && value > 0 ? 'border-red-200 bg-red-50/50' : 'border-slate-200 bg-white'} ${FOCUS_RING}`}
      >
        <span className="text-sm font-medium text-slate-800">{label}</span>
        <Badge tone={value === 0 ? 'neutral' : urgent ? 'danger' : 'warning'}>{count(value)}</Badge>
      </Link>
    </li>
  );
}

function MethodRows({ rows }: { rows: DashboardResponse['reconciliation']['byMethod'] }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-3">
      {rows.map((row) => (
        <div key={row.method} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <dt className="text-xs text-slate-600">{paymentMethodLabel(row.method)}</dt>
          <dd className="mt-1 flex flex-wrap items-baseline justify-between gap-2 text-sm font-semibold text-slate-900">
            <bdi>{formatToman(row.totalToman)}</bdi>
            <span className="text-xs font-normal text-slate-500">
              {count(row.count)} {COPY.dashboardCountUnit}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function DashboardView({ dashboard }: { dashboard: DashboardResponse }) {
  const dayHref = `/appointments?date=${encodeURIComponent(dashboard.date)}`;
  const appointment = dashboard.appointments;
  const issueFree =
    dashboard.promises.dueTodayCount === 0 &&
    dashboard.promises.missedCount === 0 &&
    dashboard.dataIssues.missingTariffCount === 0 &&
    dashboard.dataIssues.unchargedCompletedSessionCount === 0 &&
    appointment.unresolvedOutcomes === 0;
  const financial = dashboard.financialScope === 'CLINIC_WIDE' ? dashboard.clinicFinancial : null;

  return (
    <PageShell wide>
      <PageHeader
        title={COPY.dashboardTitle}
        description={`${dashboardDateLabel(dashboard.date)} · ${COPY.homeWelcome}`}
        action={<ButtonLink href={dayHref}>{COPY.dashboardOpenDay}</ButtonLink>}
      />

      <section aria-labelledby="dashboard-appointments" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="dashboard-appointments" className="text-base font-bold text-slate-900">
            {COPY.dashboardAppointments}
          </h2>
          <Link
            href={dayHref}
            className={`rounded-sm text-sm font-semibold text-brand-800 hover:underline ${FOCUS_RING}`}
          >
            {COPY.dashboardReviewDay}
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label={COPY.dashboardTotalAppointments} value={appointment.total} />
          <Metric label={COPY.dashboardScheduledAppointments} value={appointment.scheduled} />
          <Metric
            label={COPY.dashboardCompletedAppointments}
            value={appointment.completed}
            tone={appointment.completed > 0 ? 'success' : 'neutral'}
          />
          <Metric
            label={COPY.dashboardUnresolvedAppointments}
            value={appointment.unresolvedOutcomes}
            tone={appointment.unresolvedOutcomes > 0 ? 'danger' : 'neutral'}
          />
        </div>
        <Link
          href={dayHref}
          className={`flex min-h-12 items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3 transition-colors hover:border-brand-300 hover:bg-brand-50 ${FOCUS_RING}`}
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-brand-950">
              {COPY.dashboardAvailabilityOverrides}
            </span>
            <span className="block text-xs leading-6 text-slate-600">
              {COPY.dashboardAvailabilityOverridesHelp}
            </span>
          </span>
          <Badge tone="info">{count(dashboard.availabilityOverrideCount)}</Badge>
        </Link>
        {appointment.total === 0 ? (
          <EmptyState message={COPY.dashboardNoAppointments} />
        ) : (
          <p className="text-xs text-slate-500">
            {COPY.dashboardCancelledAppointments}: {count(appointment.cancelled)} ·{' '}
            {COPY.dashboardNoShows}: {count(appointment.noShows)}
          </p>
        )}
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <section
          aria-labelledby="dashboard-attention"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
        >
          <h2 id="dashboard-attention" className="mb-3 text-base font-bold text-slate-900">
            {COPY.dashboardAttention}
          </h2>
          {issueFree ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-4 text-sm text-emerald-900">
              {COPY.dashboardAttentionClear}
            </div>
          ) : null}
          <ul className="grid list-none gap-2 p-0">
            <AttentionRow
              href={dayHref}
              label={COPY.dashboardUnresolvedAppointments}
              value={appointment.unresolvedOutcomes}
              urgent
            />
            <AttentionRow
              href="/families"
              label={COPY.dashboardPromiseDueToday}
              value={dashboard.promises.dueTodayCount}
            />
            <AttentionRow
              href="/families"
              label={COPY.dashboardPromiseMissed}
              value={dashboard.promises.missedCount}
              urgent
            />
            <AttentionRow
              href={dayHref}
              label={COPY.dashboardMissingTariff}
              value={dashboard.dataIssues.missingTariffCount}
            />
            <AttentionRow
              href={dayHref}
              label={COPY.dashboardUnchargedSession}
              value={dashboard.dataIssues.unchargedCompletedSessionCount}
              urgent
            />
          </ul>
          <p className="mt-3 text-xs leading-6 text-slate-500">{COPY.dashboardIssuesOverlap}</p>
        </section>

        <section
          aria-labelledby="dashboard-reconciliation"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
        >
          <div className="mb-4">
            <h2 id="dashboard-reconciliation" className="text-base font-bold text-slate-900">
              {COPY.dashboardMyReconciliation}
            </h2>
            <p className="mt-1 text-xs leading-6 text-slate-600">
              {COPY.dashboardMyReconciliationHelp}
            </p>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-brand-950 p-4 text-white">
              <p className="text-xs text-brand-100">
                {COPY.dashboardConfirmedPayments} · {count(dashboard.reconciliation.confirmedCount)}{' '}
                {COPY.dashboardCountUnit}
              </p>
              <p className="mt-1 text-lg font-bold">
                <bdi>{formatToman(dashboard.reconciliation.confirmedTotalToman)}</bdi>
              </p>
            </div>
            <Metric
              label={COPY.dashboardVoidedPayments}
              value={dashboard.reconciliation.voidedCount}
              tone={dashboard.reconciliation.voidedCount > 0 ? 'warning' : 'neutral'}
            />
          </div>
          <MethodRows rows={dashboard.reconciliation.byMethod} />

          <h3 className="mb-2 mt-5 text-sm font-bold text-slate-900">
            {COPY.dashboardPaymentEntries}
          </h3>
          {dashboard.reconciliation.entries.length === 0 ? (
            <EmptyState message={COPY.dashboardNoPayments} />
          ) : (
            <ul
              className="max-h-96 list-none space-y-2 overflow-y-auto p-0 pe-1"
              tabIndex={0}
              aria-label={COPY.dashboardPaymentEntries}
            >
              {dashboard.reconciliation.entries.map(({ payment, family }) => (
                <li key={payment.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <Link
                        href={`/families/${family.id}/payments`}
                        className={`font-semibold text-brand-900 hover:underline ${FOCUS_RING}`}
                      >
                        {family.familyName}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {paymentMethodLabel(payment.method)} · {COPY.dashboardReceivedOn}:{' '}
                        {dashboardDateLabel(payment.receivedOn)}
                      </p>
                    </div>
                    <div className="text-end">
                      <p className="font-bold text-slate-900">
                        <bdi>{formatToman(payment.amountToman)}</bdi>
                      </p>
                      <Badge tone={payment.status === 'CONFIRMED' ? 'success' : 'danger'}>
                        {payment.status === 'CONFIRMED'
                          ? COPY.dashboardPaymentConfirmed
                          : COPY.dashboardPaymentVoided}
                      </Badge>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {financial !== null ? (
        <section
          aria-labelledby="dashboard-clinic-financial"
          className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 shadow-sm sm:p-6"
        >
          <div className="mb-5">
            <Badge tone="info">{COPY.dashboardManagerOnly}</Badge>
            <h2 id="dashboard-clinic-financial" className="mt-2 text-lg font-bold text-slate-950">
              {COPY.dashboardClinicFinancial}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{COPY.dashboardClinicFinancialHelp}</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="font-bold text-slate-900">{COPY.dashboardClinicPayments}</h3>
              <p className="mt-2 text-2xl font-bold text-brand-950">
                <bdi>{formatToman(financial.payments.confirmedTotalToman)}</bdi>
              </p>
              <p className="text-xs text-slate-500">
                {count(financial.payments.confirmedCount)} {COPY.dashboardConfirmedPayments} ·{' '}
                {count(financial.payments.voidedCount)} {COPY.dashboardVoidedPayments}
              </p>
              <div className="mt-4">
                <MethodRows rows={financial.payments.byMethod} />
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="font-bold text-slate-900">{COPY.dashboardClinicCharges}</h3>
              <p className="mt-2 text-2xl font-bold text-slate-950">
                <bdi>{formatToman(financial.charges.netChargedTotalToman)}</bdi>
              </p>
              <p className="text-xs text-slate-500">
                {COPY.dashboardNetCharged} · {count(financial.charges.chargeCount)}{' '}
                {COPY.dashboardActiveCharges} · {count(financial.charges.voidedChargeCount)}{' '}
                {COPY.dashboardVoidedCharges}
              </p>
              <h4 className="mb-2 mt-5 text-sm font-bold text-slate-900">
                {COPY.dashboardByRecorder}
              </h4>
              {financial.payments.byUser.length === 0 ? (
                <p className="text-sm text-slate-600">{COPY.dashboardNoClinicPayments}</p>
              ) : (
                <ul className="list-none divide-y divide-slate-100 p-0">
                  {financial.payments.byUser.map((row) => (
                    <li
                      key={row.user.id}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <span>{row.user.displayName}</span>
                      <span className="text-end font-semibold">
                        <bdi>{formatToman(row.confirmedTotalToman)}</bdi>
                        <small className="block font-normal text-slate-500">
                          {count(row.confirmedCount)} {COPY.dashboardCountUnit} ·{' '}
                          {count(row.voidedCount)} {COPY.dashboardPaymentVoided}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </PageShell>
  );
}
