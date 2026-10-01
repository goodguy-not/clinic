import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { familyBalanceSchema } from '@clinic/contracts';
import { api } from '@/server/api-client';
import { readCsrfCookie, readSessionToken, requireSession } from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { isKnownErrorCode } from '@/server/handler-support';
import { isKnownNoticeCode, persianNotice } from '@/server/notices';
import {
  Alert,
  ButtonLink,
  EmptyState,
  PageHeader,
  PageShell,
  Panel,
  RecordItem,
  RecordList,
  StatusBadge,
  SubmitButton,
} from '@/components/ui';
import { COPY } from '@/server/copy-fa';
import { GUARDIAN_RELATIONSHIP_LABEL } from '../relationship-labels';
import { AppHeader } from '@/components/app-header';
import { FamilyDetailActions } from './family-detail-actions';
import { formatToman } from '@/server/numerals-fa';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function FamilyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession({ requirePermission: 'family.read' });

  const { id } = await params;
  const token = await readSessionToken();

  const result = await api.getFamily(id, { sessionToken: token ?? undefined });

  if (!result.ok) {
    if (result.code === 'FAMILY_NOT_FOUND') notFound();
    throw new Error(`Failed to load family: ${result.code}`);
  }

  const { family, guardians, children } = result.data;

  const query = await searchParams;
  const rawError = query['error'];
  const errorCode = typeof rawError === 'string' ? rawError : null;
  const rawNotice = query['notice'];
  const noticeCode = typeof rawNotice === 'string' ? rawNotice : null;
  const pendingBalance = familyBalanceSchema.safeParse({
    amountDueToman: query['balanceDue'],
    creditToman: query['balanceCredit'],
  });
  const balanceWarning =
    family.status === 'ACTIVE' &&
    pendingBalance.success &&
    (pendingBalance.data.amountDueToman !== '0' || pendingBalance.data.creditToman !== '0')
      ? pendingBalance.data
      : null;

  const csrfToken = (await readCsrfCookie()) ?? '';
  const canUpdate = user.permissions.includes('family.update');
  const canUpdateStatus = user.permissions.includes('family.update_status');
  const canCreateChild = user.permissions.includes('child.create');
  const canUpdateChildStatus = user.permissions.includes('child.update_status');

  return (
    <>
      <AppHeader />
      <PageShell>
        <PageHeader
          title={family.familyName}
          backHref="/families"
          backLabel={COPY.back}
          action={
            <FamilyDetailActions
              familyId={id}
              canEdit={canUpdate}
              canReadAccount={user.permissions.includes('charge.read')}
            />
          }
        />

        {isKnownNoticeCode(noticeCode) ? (
          <Alert tone="info">{persianNotice(noticeCode)}</Alert>
        ) : null}
        {isKnownErrorCode(errorCode) ? <Alert>{persianMessage(errorCode)}</Alert> : null}

        {canUpdateStatus && balanceWarning !== null ? (
          <section
            role="alert"
            className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950"
          >
            <p>
              {balanceWarning.amountDueToman !== '0' ? (
                <>
                  این خانواده <bdi>{formatToman(balanceWarning.amountDueToman)}</bdi> بدهکار است.
                </>
              ) : (
                <>
                  این خانواده <bdi>{formatToman(balanceWarning.creditToman)}</bdi> اعتبار دارد.
                </>
              )}{' '}
              اگر پرونده را غیرفعال کنید، این مبلغ همچنان در گزارش مالی می‌ماند و{' '}
              {balanceWarning.amountDueToman !== '0'
                ? 'خانواده بعداً هم می‌تواند بدهی را پرداخت کند.'
                : 'بعداً هم می‌توان اعتبار را به خانواده بازپرداخت کرد.'}
            </p>
            <form method="post" action="/api/families/status" className="mt-3">
              <input type="hidden" name="csrfToken" value={csrfToken} />
              <input type="hidden" name="id" value={family.id} />
              <input type="hidden" name="status" value="INACTIVE" />
              <input type="hidden" name="amountDueToman" value={balanceWarning.amountDueToman} />
              <input type="hidden" name="creditToman" value={balanceWarning.creditToman} />
              <div className="flex flex-wrap gap-2">
                <SubmitButton tone="secondary">مبلغ را دیدم؛ خانواده غیرفعال شود</SubmitButton>
                <ButtonLink href={`/families/${id}`} tone="secondary">
                  انصراف
                </ButtonLink>
              </div>
            </form>
          </section>
        ) : null}

        <Panel>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              active={family.status === 'ACTIVE'}
              labels={[COPY.statusActive, COPY.statusInactive]}
            />
          </div>

          {family.address !== null ? (
            <p className="text-sm text-slate-700">
              <span className="font-medium">{COPY.familyAddressLabel}:</span> {family.address}
            </p>
          ) : null}

          {family.note !== null ? (
            <p className="text-sm text-slate-700">
              <span className="font-medium">{COPY.familyNoteLabel}:</span> {family.note}
            </p>
          ) : null}

          {canUpdateStatus && balanceWarning === null ? (
            <form method="post" action="/api/families/status" className="pt-1">
              <input type="hidden" name="csrfToken" value={csrfToken} />
              <input type="hidden" name="id" value={family.id} />
              <input
                type="hidden"
                name="status"
                value={family.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'}
              />
              <SubmitButton tone="secondary">
                {family.status === 'ACTIVE' ? COPY.deactivate : COPY.activate}
              </SubmitButton>
            </form>
          ) : null}
        </Panel>

        <Panel title={COPY.familyGuardiansTitle}>
          <RecordList>
            {guardians.map((guardian) => (
              <RecordItem
                key={guardian.id}
                title={guardian.fullName}
                badge={
                  guardian.isPrimaryContact ? (
                    <span className="inline-flex items-center rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-medium text-brand-900">
                      {COPY.familyPrimaryContactBadge}
                    </span>
                  ) : undefined
                }
                details={
                  <>
                    <span>{GUARDIAN_RELATIONSHIP_LABEL[guardian.relationship]}</span>
                    <span dir="ltr" className="text-start">
                      {[guardian.mobile, guardian.landline].filter((v) => v !== null).join(' — ')}
                    </span>
                  </>
                }
              />
            ))}
          </RecordList>
        </Panel>

        <Panel title={COPY.familyChildrenTitle}>
          {canCreateChild ? (
            <ButtonLink href={`/families/${id}/children/new`}>
              {COPY.familyAddChildAction}
            </ButtonLink>
          ) : null}

          {children.length === 0 ? (
            <EmptyState message={COPY.familyAwaitingFirstChild} />
          ) : (
            <RecordList>
              {children.map((child) => (
                <RecordItem
                  key={child.id}
                  title={`${child.firstName} ${child.lastName}`}
                  badge={
                    <StatusBadge
                      active={child.status === 'ACTIVE'}
                      labels={[COPY.statusActive, COPY.statusInactive]}
                    />
                  }
                  details={
                    <span>
                      {COPY.childFileNumberLabel}: {child.fileNumber}
                    </span>
                  }
                  actions={
                    <>
                      <ButtonLink href={`/children/${child.id}/edit`} tone="secondary">
                        {COPY.edit}
                      </ButtonLink>
                      {canUpdateChildStatus ? (
                        <form method="post" action="/api/children/status">
                          <input type="hidden" name="csrfToken" value={csrfToken} />
                          <input type="hidden" name="id" value={child.id} />
                          <input
                            type="hidden"
                            name="status"
                            value={child.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'}
                          />
                          <SubmitButton tone="secondary">
                            {child.status === 'ACTIVE' ? COPY.deactivate : COPY.activate}
                          </SubmitButton>
                        </form>
                      ) : null}
                    </>
                  }
                />
              ))}
            </RecordList>
          )}
        </Panel>
      </PageShell>
    </>
  );
}
