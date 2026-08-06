import type {
  ChildSex,
  DuplicateRule,
  Guardian,
  GuardianRelationship,
  RecordStatus,
} from '@clinic/contracts';
import type { AuditJsonObject } from '../audit/audit.types';

/**
 * The only place a family or child audit payload is built.
 *
 * `audit_log` is append-only and permanent. Everything written here outlives
 * the reason it was written, so a national identifier or a phone number copied
 * into it is a second, unbounded, undeletable store of that identifier — held
 * to answer a question ("what changed, and who changed it?") that does not
 * require the value itself.
 *
 * So identifiers are reduced to their last four digits, which is enough to
 * confirm that a row refers to the number somebody has in front of them, and
 * not enough to be a copy of it. Names, notes and addresses are written in
 * full: a change to a name *is* the fact being recorded, and masking it would
 * make the trail useless for the corrections it exists to explain.
 *
 * The masked shapes are exact, not merely prefixed. Six asterisks and four
 * digits is unsatisfiable by a ten-digit identifier, so a full value cannot
 * masquerade as a masked one — which a "starts with an asterisk" rule would
 * have permitted.
 *
 * Two further layers back this up: `assertAuditPayloadSafe` walks every payload
 * and throws on an identifier key that is neither `null` nor exactly masked,
 * and `audit_log_masked_identifiers_chk` makes PostgreSQL refuse the row. This
 * module is the one that gets it right; those two are what stop a future call
 * site getting it wrong.
 */

/** The mask character. ASCII, so audit JSON stays greppable. */
const MASK = '*';

/**
 * Keeps the last four digits and replaces everything before them.
 *
 * The output length always equals the input length, which is what makes the
 * exact shapes in `assertAuditPayloadSafe` checkable: an eleven-digit mobile
 * masks to seven asterisks and four digits, and nothing else does.
 *
 * A value too short to mask meaningfully is replaced outright rather than
 * partly revealed. Nothing valid reaches that branch — every identifier the
 * contracts admit is at least ten characters — but a masking function whose
 * failure mode is "print the value" is the wrong failure mode to have.
 */
export function maskIdentifier(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value.length <= 4) return MASK.repeat(value.length);

  return MASK.repeat(value.length - 4) + value.slice(-4);
}

/** A guardian as it appears in an audit payload. */
export type AuditSafeGuardian = {
  fullName: string;
  relationship: GuardianRelationship;
  relationshipNote: string | null;
  mobile: string | null;
  landline: string | null;
  isPrimaryContact: boolean;
};

/**
 * Guardians as an ordered list of values, never ids.
 *
 * They are replaced wholesale on every family edit, so their ids change even
 * when nothing a human cares about did. Recording values in a deterministic
 * order — the primary contact first, then by name — means a before/after pair
 * reads as the change that actually happened rather than as a wholesale
 * replacement of six rows.
 */
export function auditSafeGuardians(
  guardians: readonly Pick<
    Guardian,
    'fullName' | 'relationship' | 'relationshipNote' | 'mobile' | 'landline' | 'isPrimaryContact'
  >[],
): AuditSafeGuardian[] {
  return [...guardians]
    .sort((left, right) => {
      if (left.isPrimaryContact !== right.isPrimaryContact) {
        return left.isPrimaryContact ? -1 : 1;
      }
      return left.fullName.localeCompare(right.fullName, 'fa');
    })
    .map((guardian) => ({
      fullName: guardian.fullName,
      relationship: guardian.relationship,
      relationshipNote: guardian.relationshipNote,
      mobile: maskIdentifier(guardian.mobile),
      landline: maskIdentifier(guardian.landline),
      isPrimaryContact: guardian.isPrimaryContact,
    }));
}

export type AuditSafeFamilyInput = {
  familyName: string;
  address: string | null;
  note: string | null;
  status?: RecordStatus;
  guardians?: readonly Pick<
    Guardian,
    'fullName' | 'relationship' | 'relationshipNote' | 'mobile' | 'landline' | 'isPrimaryContact'
  >[];
};

/** A family, with its guardian set, ready to be a `before` or an `after`. */
export function auditSafeFamily(family: AuditSafeFamilyInput): AuditJsonObject {
  return {
    familyName: family.familyName,
    address: family.address,
    note: family.note,
    ...(family.status === undefined ? {} : { status: family.status }),
    ...(family.guardians === undefined ? {} : { guardians: auditSafeGuardians(family.guardians) }),
  };
}

export type AuditSafeChildInput = {
  familyId: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  fileNumber: string;
  legacyPaperFileNumber: string | null;
  nationalId: string | null;
  sex: ChildSex;
  referralSource: string | null;
  note: string | null;
  status?: RecordStatus;
};

/**
 * A child, ready to be a `before` or an `after`.
 *
 * `fileNumber` is written in full and deliberately so. It is a clinic-assigned
 * reference with no meaning outside this system, it never changes, and it is
 * how a person identifies which record an audit row is about. `nationalId` is
 * the opposite on every count.
 */
export function auditSafeChild(child: AuditSafeChildInput): AuditJsonObject {
  return {
    familyId: child.familyId,
    firstName: child.firstName,
    lastName: child.lastName,
    birthDate: child.birthDate,
    fileNumber: child.fileNumber,
    legacyPaperFileNumber: child.legacyPaperFileNumber,
    nationalId: maskIdentifier(child.nationalId),
    sex: child.sex,
    referralSource: child.referralSource,
    note: child.note,
    ...(child.status === undefined ? {} : { status: child.status }),
  };
}

/**
 * The metadata written alongside a duplicate override.
 *
 * Ids and rule names only. The candidates carry names and masked numbers when
 * they are shown on screen, because somebody has to recognise them; none of
 * that belongs in a permanent record of the decision. An id resolves to the
 * family for anyone who needs it and to nothing for anyone who does not.
 */
export function auditSafeDuplicateOverride(input: {
  acknowledgedIds: readonly string[];
  rules: readonly DuplicateRule[];
}): AuditJsonObject {
  return {
    acknowledgedIds: [...input.acknowledgedIds].sort(),
    rules: [...new Set(input.rules)].sort(),
  };
}
