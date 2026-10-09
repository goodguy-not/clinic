import type { GuardianRelationship } from '@clinic/contracts';
import { COPY } from '@/shared/copy-fa';

/** Persian labels for `GuardianRelationship`, shared by the form and the detail view. */
export const GUARDIAN_RELATIONSHIP_LABEL: Record<GuardianRelationship, string> = {
  MOTHER: COPY.relationshipMother,
  FATHER: COPY.relationshipFather,
  GRANDMOTHER: COPY.relationshipGrandmother,
  GRANDFATHER: COPY.relationshipGrandfather,
  GUARDIAN: COPY.relationshipGuardian,
  OTHER: COPY.relationshipOther,
};
