import type { Metadata } from 'next';
import type { DuplicateCandidate } from '@clinic/contracts';
import { api } from '@/server/api-client';
import { readCsrfCookie, requireSession, readSessionToken } from '@/server/auth-session';
import { readDraftToken } from '@/server/draft-cookie';
import { persianMessage } from '@/server/errors-fa';
import { Alert, ButtonLink, PageHeader, PageShell, Panel, SubmitButton } from '@/components/ui';
import { COPY } from '@/server/copy-fa';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

const CONFIRM_ACTION: Record<string, `/api/${string}`> = {
  FAMILY_CREATE: '/api/families/confirm-registration',
  FAMILY_UPDATE: '/api/families/confirm-update',
  CHILD_CREATE: '/api/children/confirm-registration',
  CHILD_UPDATE: '/api/children/confirm-update',
};

/**
 * The comparison screen a blocked family or child registration lands on.
 *
 * The draft token lives only in this server's own HttpOnly cookie
 * (`draft-cookie.ts`) — it never appears in this page's markup or in the
 * confirm/discard form actions, which is what keeps it out of the browser's
 * hands entirely.
 */
export default async function ConfirmRegistrationPage() {
  await requireSession({ requirePermission: 'family.read' });

  const draftToken = await readDraftToken();

  if (draftToken === null) {
    return (
      <PageShell>
        <PageHeader title={COPY.duplicateTitle} backHref="/families" backLabel={COPY.back} />
        <Alert>{persianMessage('DRAFT_NOT_FOUND')}</Alert>
        <ButtonLink href="/families">{COPY.back}</ButtonLink>
      </PageShell>
    );
  }

  const sessionToken = await readSessionToken();
  const result = await api.currentDraft({ sessionToken: sessionToken ?? undefined, draftToken });

  if (!result.ok) {
    return (
      <PageShell>
        <PageHeader title={COPY.duplicateTitle} backHref="/families" backLabel={COPY.back} />
        <Alert>{persianMessage(result.code)}</Alert>
        <ButtonLink href="/families">{COPY.back}</ButtonLink>
      </PageShell>
    );
  }

  const draft = result.data;
  const isChild = draft.purpose === 'CHILD_CREATE' || draft.purpose === 'CHILD_UPDATE';
  const csrfToken = (await readCsrfCookie()) ?? '';

  return (
    <PageShell>
      <PageHeader title={COPY.duplicateTitle} />

      <Alert tone="info">{isChild ? COPY.duplicateChildIntro : COPY.duplicateFamilyIntro}</Alert>

      <form method="post" action={CONFIRM_ACTION[draft.purpose]} className="flex flex-col gap-4">
        <input type="hidden" name="csrfToken" value={csrfToken} />

        {draft.candidates.map((candidate) => (
          <CandidatePanel key={acknowledgementId(candidate)} candidate={candidate} />
        ))}

        <SubmitButton>{COPY.duplicateConfirmAction}</SubmitButton>
      </form>

      <form method="post" action="/api/registration-drafts/discard">
        <input type="hidden" name="csrfToken" value={csrfToken} />
        <SubmitButton tone="secondary">{COPY.duplicateDiscardAction}</SubmitButton>
      </form>
    </PageShell>
  );
}

function acknowledgementId(candidate: DuplicateCandidate): string {
  return candidate.childId ?? candidate.familyId;
}

function CandidatePanel({ candidate }: { candidate: DuplicateCandidate }) {
  const id = acknowledgementId(candidate);
  const checkboxId = `acknowledge-${id}`;

  return (
    <Panel>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-900">{candidate.familyName}</span>
          <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-900">
            {COPY.duplicateBlockingBadge}
          </span>
        </div>

        {candidate.primaryGuardianName !== null ? (
          <p className="text-sm text-slate-600">{candidate.primaryGuardianName}</p>
        ) : null}

        <p dir="ltr" className="text-start text-sm text-slate-600">
          {[candidate.maskedMobile, candidate.maskedLandline].filter((v) => v !== null).join(' — ')}
        </p>

        {candidate.childNames.length > 0 ? (
          <p className="text-sm text-slate-600">
            {COPY.duplicateChildrenInFamilyLabel}: {candidate.childNames.join('، ')}
          </p>
        ) : null}

        <label htmlFor={checkboxId} className="mt-2 flex items-start gap-2 text-sm">
          <input
            id={checkboxId}
            type="checkbox"
            name="acknowledgedDuplicateIds"
            value={id}
            required
            className="mt-1 size-4"
          />
          {COPY.duplicateAcknowledgeLabel}
        </label>
      </div>
    </Panel>
  );
}
