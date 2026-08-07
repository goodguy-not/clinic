import type {
  ChildSummary,
  Family,
  FamilySummary,
  Guardian,
  GuardianRelationship,
  GuardianSummary,
  RecordStatus,
} from '@clinic/contracts';

/**
 * Row shapes and mappers for the families module.
 *
 * Every query here is raw SQL, because the search predicate, the normalisation
 * and the advisory locks are all PostgreSQL features Prisma's query builder
 * cannot express. These types are the boundary between a `snake_case` row and
 * the strict contract the API returns.
 *
 * Two things never cross that boundary. The `search_*` columns are an internal
 * derived key and appear in no response — a caller has no use for them and
 * exposing them would invite somebody to filter on them from outside. And a
 * `BigInt` never crosses either: counts are converted to `number` here, because
 * JSON has no integer type and a serialised BigInt throws.
 */

export type FamilyRow = {
  id: string;
  family_name: string;
  address: string | null;
  note: string | null;
  status: RecordStatus;
  deactivated_at: Date | null;
  created_at: Date;
};

export type GuardianRow = {
  id: string;
  family_id: string;
  full_name: string;
  relationship: GuardianRelationship;
  relationship_note: string | null;
  mobile: string | null;
  landline: string | null;
  is_primary_contact: boolean;
};

export type ChildRow = {
  id: string;
  family_id: string;
  first_name: string;
  last_name: string;
  file_number: string;
  /** Already `YYYY-MM-DD`: the query casts `date` to text so no `Date` is built. */
  birth_date: string;
  status: RecordStatus;
};

export function toFamily(row: FamilyRow): Family {
  return {
    id: row.id,
    familyName: row.family_name,
    address: row.address,
    note: row.note,
    status: row.status,
    deactivatedAt: row.deactivated_at === null ? null : row.deactivated_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

export function toGuardian(row: GuardianRow): Guardian {
  return {
    id: row.id,
    fullName: row.full_name,
    relationship: row.relationship,
    relationshipNote: row.relationship_note,
    mobile: row.mobile,
    landline: row.landline,
    isPrimaryContact: row.is_primary_contact,
  };
}

export function toGuardianSummary(row: GuardianRow): GuardianSummary {
  return {
    fullName: row.full_name,
    relationship: row.relationship,
    mobile: row.mobile,
    landline: row.landline,
  };
}

export function toChildSummary(row: ChildRow): ChildSummary {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    fileNumber: row.file_number,
    birthDate: row.birth_date,
    status: row.status,
  };
}

/**
 * The primary contact first, then by name.
 *
 * Deterministic ordering is not cosmetic here. Guardians are replaced wholesale
 * on every family edit, so their ids churn; an interface that listed them in
 * insertion order would reshuffle a family's contacts after an unrelated
 * change, and a test asserting on the list would be asserting on luck.
 */
export function orderGuardians(rows: readonly GuardianRow[]): GuardianRow[] {
  return [...rows].sort((left, right) => {
    if (left.is_primary_contact !== right.is_primary_contact) {
      return left.is_primary_contact ? -1 : 1;
    }
    return left.full_name.localeCompare(right.full_name, 'fa') || left.id.localeCompare(right.id);
  });
}

/** Surname, then given name, then file number — the order a list is read in. */
export function orderChildren(rows: readonly ChildRow[]): ChildRow[] {
  return [...rows].sort(
    (left, right) =>
      left.last_name.localeCompare(right.last_name, 'fa') ||
      left.first_name.localeCompare(right.first_name, 'fa') ||
      left.file_number.localeCompare(right.file_number),
  );
}

/**
 * Assembles one search result row.
 *
 * `awaitingFirstChild` is stated rather than left to the caller to infer from an
 * empty array. A family registered a moment ago and not yet given a child is a
 * normal, complete record — registration is two requests — and saying so plainly
 * is what stops the list looking like it has failed.
 */
export function toFamilySummary(
  family: FamilyRow,
  guardians: readonly GuardianRow[],
  children: readonly ChildRow[],
): FamilySummary {
  const ordered = orderGuardians(guardians);
  const primary = ordered.find((guardian) => guardian.is_primary_contact);

  return {
    id: family.id,
    familyName: family.family_name,
    status: family.status,
    deactivatedAt: family.deactivated_at === null ? null : family.deactivated_at.toISOString(),
    primaryGuardian: primary === undefined ? null : toGuardianSummary(primary),
    guardianCount: guardians.length,
    children: orderChildren(children).map(toChildSummary),
    childCount: children.length,
    awaitingFirstChild: children.length === 0,
    createdAt: family.created_at.toISOString(),
  };
}

/** Groups child or guardian rows by their family, preserving query order. */
export function groupByFamily<T extends { family_id: string }>(
  rows: readonly T[],
): Map<string, T[]> {
  const byFamily = new Map<string, T[]>();

  for (const row of rows) {
    const existing = byFamily.get(row.family_id);
    if (existing === undefined) byFamily.set(row.family_id, [row]);
    else existing.push(row);
  }

  return byFamily;
}

export function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function presentValues(values: readonly (string | null)[]): string[] {
  return unique(values.filter((value): value is string => value !== null));
}
