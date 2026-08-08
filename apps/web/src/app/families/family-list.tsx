import type { FamilySummary } from '@clinic/contracts';
import { EmptyState, RecordItem, RecordList, StatusBadge } from '@/components/ui';
import { COPY } from '@/server/copy-fa';
import Link from 'next/link';

export function FamilyList({
  families,
  truncated,
  searched,
}: {
  families: FamilySummary[];
  truncated: boolean;
  searched: boolean;
}) {
  if (families.length === 0) {
    return <EmptyState message={COPY.familyEmpty} />;
  }

  return (
    <div className="flex flex-col gap-3">
      {!searched ? <p className="text-sm text-slate-600">{COPY.familyRecentNotice}</p> : null}
      {truncated ? <p className="text-sm text-slate-600">{COPY.familyTruncatedNotice}</p> : null}

      <RecordList>
        {families.map((family) => (
          <RecordItem
            key={family.id}
            title={family.familyName}
            badge={
              <StatusBadge
                active={family.status === 'ACTIVE'}
                labels={[COPY.statusActive, COPY.statusInactive]}
              />
            }
            details={
              <>
                {family.primaryGuardian !== null ? (
                  <span dir="ltr" className="text-start">
                    {family.primaryGuardian.fullName}
                    {family.primaryGuardian.mobile !== null
                      ? ` — ${family.primaryGuardian.mobile}`
                      : family.primaryGuardian.landline !== null
                        ? ` — ${family.primaryGuardian.landline}`
                        : ''}
                  </span>
                ) : null}
                {family.awaitingFirstChild ? (
                  <span>{COPY.familyAwaitingFirstChild}</span>
                ) : (
                  <span>
                    {family.children
                      .map((child) => `${child.firstName} ${child.lastName}`)
                      .join('، ')}
                  </span>
                )}
              </>
            }
            actions={
              <Link
                href={`/families/${family.id}`}
                className="text-sm text-brand-800 underline underline-offset-4 hover:text-brand-950"
              >
                {COPY.view}
              </Link>
            }
          />
        ))}
      </RecordList>
    </div>
  );
}
