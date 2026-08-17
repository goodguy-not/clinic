import Link from 'next/link';
import type {
  FamilyAccountQuery,
  FamilyAccountResponse,
  FamilyDetailResponse,
  Payment,
} from '@clinic/contracts';
import { Badge, ButtonLink, EmptyState, Field, Panel, SubmitButton } from '@/components/ui';
import { FamilyFinancialPositionPanel } from '@/components/family-financial-position';
import { FamilyMoneyNavigation } from '@/components/family-money-navigation';
import { CONTROL_CLASS, FOCUS_RING } from '@/components/styles';
import {
  formatChargeMoney,
  formatAdjustmentMoney,
  formatFamilyAccountMoney,
} from '@/ledger/presentation';
import { formatScheduleDate } from '@/scheduling/presentation';
import { COPY } from '@/server/copy-fa';
import { toPersianDigits } from '@/server/numerals-fa';
import type { JalaliParts } from '@/server/jalali';
import { PaymentEntryPanel } from '../payments/payment-entry';

type Child = FamilyDetailResponse['children'][number];

const PERSIAN_INSTANT = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-arabext', {
  calendar: 'persian',
  timeZone: 'Asia/Tehran',
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function buildAccountHref(
  familyId: string,
  query: FamilyAccountQuery,
  page: number,
): string {
  const search = new URLSearchParams({
    page: String(page),
    pageSize: String(query.pageSize),
    includeVoided: String(query.includeVoided),
  });
  if (query.childId !== undefined) search.set('childId', query.childId);
  if (query.from !== undefined) search.set('from', query.from);
  if (query.to !== undefined) search.set('to', query.to);

  return `/families/${encodeURIComponent(familyId)}/account?${search.toString()}`;
}

export function FamilyAccountView({
  familyId,
  children,
  account,
  query,
  csrfToken,
  canAdjustCharge,
  canVoidCharge,
  canCreatePayment,
  recentPayments,
  clinicToday,
  clinicTodayJalali,
}: {
  familyId: string;
  children: Child[];
  account: FamilyAccountResponse;
  query: FamilyAccountQuery;
  csrfToken: string;
  canAdjustCharge: boolean;
  canVoidCharge: boolean;
  canCreatePayment: boolean;
  recentPayments: Payment[];
  clinicToday: string;
  clinicTodayJalali: JalaliParts;
}) {
  const totals = formatFamilyAccountMoney(account.totals);

  return (
    <>
      <FamilyMoneyNavigation familyId={familyId} active="account" />

      <FamilyFinancialPositionPanel position={account.position} />

      {canCreatePayment ? (
        <PaymentEntryPanel
          familyId={familyId}
          csrfToken={csrfToken}
          clinicToday={clinicToday}
          clinicTodayJalali={clinicTodayJalali}
          recentPayments={recentPayments}
        />
      ) : null}

      <Panel title={COPY.familyAccountTotalsTitle}>
        <dl
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          aria-label={COPY.familyAccountTotalsTitle}
        >
          <MoneyFact label={COPY.familyAccountChargedTotal} value={totals.charged} />
          <MoneyFact
            label={COPY.familyAccountAdjustmentTotal}
            value={totals.adjustments}
            tone="discount"
          />
          <MoneyFact label={COPY.familyAccountEffectiveTotal} value={totals.netCharged} emphasis />
        </dl>
        <div className="flex flex-wrap gap-2 text-xs text-slate-700">
          <span className="rounded-full bg-slate-100 px-3 py-1">
            {toPersianDigits(String(account.totals.chargeCount))}{' '}
            {COPY.familyAccountActiveChargeCount}
          </span>
          <span className="rounded-full bg-red-50 px-3 py-1 text-red-800">
            {toPersianDigits(String(account.totals.voidedChargeCount))}{' '}
            {COPY.familyAccountVoidedChargeCount}
          </span>
        </div>
      </Panel>

      <Panel title={COPY.familyAccountFiltersTitle}>
        <form
          method="get"
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        >
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-slate-900">
            {COPY.familyAccountChildFilter}
            <select name="childId" defaultValue={query.childId ?? ''} className={CONTROL_CLASS}>
              <option value="">{COPY.familyAccountAllChildren}</option>
              {children.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.firstName} {child.lastName} — {child.fileNumber}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-slate-900">
            {COPY.familyAccountHistoryFilter}
            <select
              name="includeVoided"
              defaultValue={String(query.includeVoided)}
              className={CONTROL_CLASS}
            >
              <option value="true">{COPY.familyAccountHistoryShown}</option>
              <option value="false">{COPY.familyAccountHistoryHidden}</option>
            </select>
          </label>
          <input type="hidden" name="pageSize" value={query.pageSize} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton>{COPY.familyAccountApplyFilters}</SubmitButton>
            <ButtonLink href={`/families/${familyId}/account`} tone="secondary">
              {COPY.familyAccountClearFilters}
            </ButtonLink>
          </div>
        </form>
      </Panel>

      <section aria-labelledby="family-account-history" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="family-account-history" className="text-lg font-bold text-slate-950">
            {COPY.familyAccountChargesTitle}
          </h2>
          <p className="text-sm text-slate-600">
            {COPY.familyAccountPageLabel} {toPersianDigits(String(account.page.page))} ·{' '}
            {toPersianDigits(String(account.page.total))} {COPY.familyAccountOfRows}
          </p>
        </div>

        {account.charges.length === 0 ? (
          <EmptyState message={COPY.familyAccountEmpty} />
        ) : (
          <ol className="flex list-none flex-col gap-4 p-0">
            {account.charges.map((view) => (
              <ChargeCard
                key={view.charge.id}
                familyId={familyId}
                view={view}
                csrfToken={csrfToken}
                canAdjustCharge={canAdjustCharge}
                canVoidCharge={canVoidCharge}
              />
            ))}
          </ol>
        )}

        <nav
          aria-label={COPY.familyAccountPageLabel}
          className="flex items-center justify-between gap-3"
        >
          {account.page.page > 1 ? (
            <PageLink href={buildAccountHref(familyId, query, account.page.page - 1)}>
              {COPY.familyAccountPreviousPage}
            </PageLink>
          ) : (
            <span />
          )}
          {account.page.hasMore ? (
            <PageLink href={buildAccountHref(familyId, query, account.page.page + 1)}>
              {COPY.familyAccountNextPage}
            </PageLink>
          ) : (
            <span />
          )}
        </nav>
      </section>
    </>
  );
}

function MoneyFact({
  label,
  value,
  emphasis = false,
  tone = 'normal',
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: 'normal' | 'discount';
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${emphasis ? 'border-brand-300 bg-brand-50' : 'border-slate-200 bg-slate-50'}`}
    >
      <dt className="text-xs font-medium text-slate-600">{label}</dt>
      <dd
        className={`mt-1 text-lg font-bold tabular-nums ${tone === 'discount' ? 'text-emerald-800' : 'text-slate-950'}`}
      >
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}

function ChargeCard({
  familyId,
  view,
  csrfToken,
  canAdjustCharge,
  canVoidCharge,
}: {
  familyId: string;
  view: FamilyAccountResponse['charges'][number];
  csrfToken: string;
  canAdjustCharge: boolean;
  canVoidCharge: boolean;
}) {
  const { charge, child, service, therapist } = view;
  const money = formatChargeMoney(charge);
  const voided = charge.voidedAt !== null;
  const date = formatScheduleDate(charge.serviceDate)?.full ?? charge.serviceDate;

  return (
    <li
      className={`overflow-hidden rounded-xl border shadow-sm ${voided ? 'border-red-200 bg-slate-50' : 'border-slate-200 bg-white'}`}
    >
      <article>
        <header className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-bold text-slate-950">
                {child.firstName} {child.lastName}
              </h3>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">
                {COPY.childFileNumberLabel}: <bdi>{child.fileNumber}</bdi>
              </span>
              {voided ? <Badge tone="danger">{COPY.familyAccountVoided}</Badge> : null}
              {!voided && charge.priceMode === 'FREE' ? (
                <Badge tone="info">{COPY.familyAccountFree}</Badge>
              ) : null}
              {!voided && charge.priceMode === 'PAID' && charge.effectiveAmountToman === '0' ? (
                <Badge tone="success">{COPY.familyAccountFullyAdjusted}</Badge>
              ) : null}
            </div>
            <p className="text-sm text-slate-700">
              {COPY.familyAccountService}: <span className="font-medium">{service.name}</span>
              <span aria-hidden="true"> · </span>
              {COPY.familyAccountTherapist}:{' '}
              <span className="font-medium">{therapist.fullName}</span>
            </p>
            <p className="text-sm text-slate-600">
              {COPY.familyAccountSessionDate}: {date}
              <span aria-hidden="true"> · </span>
              {COPY.familyAccountDuration}: {toPersianDigits(String(charge.durationMinutes))}{' '}
              {COPY.familyAccountMinutes}
            </p>
          </div>
        </header>

        {voided ? (
          <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            <p className="font-semibold">{COPY.familyAccountVoidedNoEffect}</p>
            <p>
              {COPY.familyAccountVoidReason}: {charge.voidReason}
            </p>
            <p>
              {COPY.familyAccountVoidedAt}: {formatInstant(charge.voidedAt!)}
            </p>
          </div>
        ) : null}

        <dl className="grid gap-px bg-slate-200 sm:grid-cols-3">
          <ChargeMoneyFact
            label={COPY.familyAccountOriginalAmount}
            value={money.charged}
            historical={voided}
          />
          <ChargeMoneyFact
            label={COPY.familyAccountActiveAdjustments}
            value={money.activeAdjustments}
            historical={voided}
          />
          <ChargeMoneyFact
            label={COPY.familyAccountEffectiveAmount}
            value={money.effective}
            historical={voided}
            emphasis={!voided}
          />
        </dl>

        {charge.adjustments.length > 0 ? (
          <div className="flex flex-col gap-3 p-4">
            <h4 className="text-sm font-bold text-slate-900">
              {COPY.familyAccountAdjustmentsTitle}
            </h4>
            <ul className="flex list-none flex-col gap-2 p-0">
              {charge.adjustments.map((adjustment) => {
                const adjustmentMoney = formatAdjustmentMoney(adjustment);
                const adjustmentVoided = adjustment.voidedAt !== null;
                return (
                  <li
                    key={adjustment.id}
                    className={`rounded-lg border p-3 text-sm ${adjustmentVoided ? 'border-red-200 bg-slate-50 text-slate-600' : 'border-emerald-200 bg-emerald-50 text-slate-800'}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold tabular-nums">
                        <bdi>{adjustmentMoney.clinicFunded}</bdi>
                      </span>
                      {adjustmentVoided ? (
                        <Badge tone="danger">{COPY.familyAccountVoidedAdjustment}</Badge>
                      ) : (
                        <Badge tone="success">{COPY.familyAccountClinicFunded}</Badge>
                      )}
                    </div>
                    <p>
                      {COPY.familyAccountAdjustmentReason}: {adjustment.reason}
                    </p>
                    {adjustmentVoided ? (
                      <div className="mt-2 border-t border-red-200 pt-2 text-red-900">
                        <p className="font-semibold">
                          {COPY.familyAccountVoidedAdjustmentNoEffect}
                        </p>
                        <p>
                          {COPY.familyAccountVoidReason}: {adjustment.voidReason}
                        </p>
                        <p>
                          {COPY.familyAccountVoidedAt}: {formatInstant(adjustment.voidedAt!)}
                        </p>
                      </div>
                    ) : canAdjustCharge && !voided ? (
                      <CorrectionDetails title={COPY.familyAccountAdjustmentVoidTitle}>
                        <p className="text-sm text-slate-700">
                          {COPY.familyAccountAdjustmentVoidHelp}
                        </p>
                        <form
                          method="post"
                          action="/api/ledger/adjustments/void"
                          className="mt-3 flex flex-col gap-3"
                        >
                          <CorrectionHiddenFields familyId={familyId} csrfToken={csrfToken} />
                          <input type="hidden" name="chargeId" value={charge.id} />
                          <input type="hidden" name="adjustmentId" value={adjustment.id} />
                          <ReasonField id={`adjustment-void-reason-${adjustment.id}`} />
                          <div>
                            <SubmitButton tone="danger">
                              {COPY.familyAccountAdjustmentVoidAction}
                            </SubmitButton>
                          </div>
                        </form>
                      </CorrectionDetails>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {!voided && (canAdjustCharge || canVoidCharge) ? (
          <div className="grid gap-3 border-t border-slate-200 bg-slate-50 p-4 lg:grid-cols-2">
            {canAdjustCharge &&
            charge.priceMode === 'PAID' &&
            charge.effectiveAmountToman !== '0' ? (
              <CorrectionDetails title={COPY.familyAccountAdjustmentCreateTitle}>
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                  {COPY.familyAccountAdjustmentClinicOnly}
                </p>
                <form
                  method="post"
                  action="/api/ledger/adjustments/create"
                  className="mt-3 flex flex-col gap-3"
                >
                  <CorrectionHiddenFields familyId={familyId} csrfToken={csrfToken} />
                  <input type="hidden" name="chargeId" value={charge.id} />
                  <Field
                    id={`adjustment-amount-${charge.id}`}
                    label={COPY.familyAccountAdjustmentAmount}
                    help={COPY.familyAccountAdjustmentAmountHelp}
                    required
                  >
                    {({ id, className, describedBy }) => (
                      <input
                        id={id}
                        name="amountToman"
                        type="text"
                        inputMode="numeric"
                        required
                        aria-describedby={describedBy}
                        className={className}
                      />
                    )}
                  </Field>
                  <ReasonField id={`adjustment-reason-${charge.id}`} />
                  <div>
                    <SubmitButton>{COPY.familyAccountAdjustmentCreateAction}</SubmitButton>
                  </div>
                </form>
              </CorrectionDetails>
            ) : null}
            {canVoidCharge ? (
              <CorrectionDetails title={COPY.familyAccountChargeVoidTitle}>
                <p className="text-sm text-slate-700">{COPY.familyAccountChargeVoidHelp}</p>
                <form
                  method="post"
                  action="/api/ledger/session-charges/void"
                  className="mt-3 flex flex-col gap-3"
                >
                  <CorrectionHiddenFields familyId={familyId} csrfToken={csrfToken} />
                  <input type="hidden" name="chargeId" value={charge.id} />
                  <ReasonField id={`charge-void-reason-${charge.id}`} />
                  <div>
                    <SubmitButton tone="danger">{COPY.familyAccountChargeVoidAction}</SubmitButton>
                  </div>
                </form>
              </CorrectionDetails>
            ) : null}
          </div>
        ) : null}
      </article>
    </li>
  );
}

function CorrectionDetails({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border border-slate-300 bg-white p-3">
      <summary className={`cursor-pointer font-bold text-slate-900 ${FOCUS_RING}`}>
        {COPY.familyAccountManagerCorrection}: {title}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function CorrectionHiddenFields({ familyId, csrfToken }: { familyId: string; csrfToken: string }) {
  return (
    <>
      <input type="hidden" name="familyId" value={familyId} />
      <input type="hidden" name="csrfToken" value={csrfToken} />
    </>
  );
}

function ReasonField({ id }: { id: string }) {
  return (
    <Field
      id={id}
      label={COPY.familyAccountCorrectionReason}
      help={COPY.familyAccountCorrectionReasonHelp}
      required
    >
      {({ id: fieldId, className, describedBy }) => (
        <textarea
          id={fieldId}
          name="reason"
          rows={2}
          required
          aria-describedby={describedBy}
          className={className}
        />
      )}
    </Field>
  );
}

function ChargeMoneyFact({
  label,
  value,
  historical,
  emphasis = false,
}: {
  label: string;
  value: string;
  historical: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className={`${historical ? 'bg-slate-100' : emphasis ? 'bg-brand-50' : 'bg-white'} p-4`}>
      <dt className="text-xs text-slate-600">{label}</dt>
      <dd
        className={`mt-1 font-bold tabular-nums ${historical ? 'text-slate-600' : emphasis ? 'text-brand-950' : 'text-slate-950'}`}
      >
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}

function PageLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 ${FOCUS_RING}`}
    >
      {children}
    </Link>
  );
}

function formatInstant(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : PERSIAN_INSTANT.format(date);
}
