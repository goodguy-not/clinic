import { ButtonLink } from '@/components/ui';
import { COPY } from '@/server/copy-fa';

export function FamilyDetailActions({
  familyId,
  canEdit,
  canReadAccount,
}: {
  familyId: string;
  canEdit: boolean;
  canReadAccount: boolean;
}) {
  if (!canEdit && !canReadAccount) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {canReadAccount ? (
        <ButtonLink href={`/families/${familyId}/account`}>{COPY.familyAccountAction}</ButtonLink>
      ) : null}
      {canEdit ? (
        <ButtonLink href={`/families/${familyId}/edit`} tone="secondary">
          {COPY.edit}
        </ButtonLink>
      ) : null}
    </div>
  );
}
