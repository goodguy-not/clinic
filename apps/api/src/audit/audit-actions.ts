/**
 * Every audit action this application can write.
 *
 * These live in `apps/api` rather than `@clinic/contracts` because they are
 * server vocabulary: the web tier has no audit surface in Milestone 1 and must
 * not gain the ability to name an action. They will move to contracts only if
 * an audit viewer needs them.
 *
 * `audit_log.action` is TEXT with a format CHECK rather than a PostgreSQL enum,
 * because every later milestone adds actions and an enum would cost an
 * `ALTER TYPE` migration each time — which cannot run in the same transaction
 * that uses the new value.
 *
 * Every action below accompanies a state change written in the same
 * transaction. There is deliberately no summary, aggregate or sampled action:
 * see `security-log.ts` for why non-state-changing rejections are not audited.
 */
export const AUDIT_ACTIONS = [
  // Authentication. Written only when an existing active account changes state.
  'auth.login.succeeded',
  'auth.login.failed',
  'auth.login.locked',
  'auth.logout',
  'auth.session.rotated',
  'auth.session.revoked',
  'auth.password.changed',
  'auth.password.reset',

  // Account administration. Endpoints arrive in a later checkpoint; the
  // vocabulary is fixed here so the audit contract does not change underneath
  // them.
  'user.created',
  'user.role_changed',
  'user.status_changed',
  'user.unlocked',

  // Clinic reference data. Endpoints arrive in the vertical slices that follow
  // this checkpoint; the vocabulary is fixed here for the same reason as above.
  'therapist.created',
  'therapist.updated',
  'therapist.status_changed',
  'service.created',
  'service.updated',
  'service.status_changed',
  'room.created',
  'room.updated',
  'room.status_changed',
  // A tariff is never edited. A correction voids the row and writes a new one,
  // so a price change is two audited facts — the value that stopped applying
  // and the value that replaced it — rather than one entry that has to be read
  // as a diff.
  'tariff.created',
  'tariff.voided',

  // Families and children. Every payload here passes through the masking
  // mapper: a name change is the fact being recorded and is written in full,
  // while a national identifier or a phone number is reduced to its last four
  // digits before it reaches this table.
  'family.created',
  'family.updated',
  'family.status_changed',
  'child.created',
  'child.updated',
  'child.status_changed',
  // A separate action rather than a flag inside the creation payload. "How
  // often does somebody override the duplicate warning?" is a question the
  // pilot will ask, and a key buried in JSON is not something you can count.
  // It records the candidate ids and the rule names, never an identifier.
  'family.duplicate_override',
  'child.duplicate_override',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Entity types currently written. Matches the `entity_type` format CHECK.
 *
 * These are table names, and deliberately so: an audit row names the row it
 * describes, and `entity_id` has no foreign key to enforce that pairing.
 */
export const AUDIT_ENTITY_TYPES = [
  'app_user',
  'user_session',
  'therapist',
  'service',
  'room',
  'tariff',
  'family',
  'child',
  // `guardian` is deliberately absent: guardians are replaced as a set with
  // their family, so a guardian change is recorded inside `family.updated` as
  // an ordered list of values, and no audit row ever names a guardian id.
  //
  // `registration_draft` is absent for a different reason: a draft is transient
  // workflow state that is deleted within ten minutes, not a historical fact.
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];
