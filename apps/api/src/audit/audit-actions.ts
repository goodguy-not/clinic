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

  // Appointments. Endpoints arrive in the checkpoints that follow this one; the
  // vocabulary is fixed here for the same reason as above, so the audit
  // contract does not change underneath them.
  //
  // Completion and cancellation are separate actions rather than one
  // `appointment.status_changed`, unlike every catalog entity. A completion is
  // what will create a session charge and a cancellation deliberately creates
  // none. "How often is a session cancelled by the clinic?" is a question the
  // pilot will ask, and an answer buried in a JSON diff is not something you can
  // count.
  'appointment.created',
  'appointment.updated',
  'appointment.completed',
  'appointment.cancelled',
  // Reversing a completion entered by mistake, which PROJECT_SPEC.md 6 calls a
  // controlled operation and PROJECT_SPEC.md 4 keeps away from the receptionist.
  // Its own action rather than an `appointment.updated` carrying a status diff:
  // "how often is a completed session reopened?" is a question a manager will
  // ask of a pilot, and in Milestone 5 this is the point at which a session
  // charge has to be voided or offset. An answer buried in a JSON diff is not
  // something you can count, and not something a later financial rule can key
  // off.
  'appointment.reopened',
  // Names a participant, not the booking: one child's own outcome, which is a
  // separate fact from the booking's status. A no-show is recorded here, because
  // a no-show is a seat's outcome and not a state of the booking — there is
  // deliberately no `appointment.no_show_recorded`.
  'appointment.attendance_recorded',
  // There is deliberately no `appointment.availability_override`. Booking
  // outside a therapist's hours is not a change of its own: it is a property of
  // the create or move that carried it, and it is recorded in that row's
  // `metadata` alongside the reason. A second action would describe one state
  // change as two facts, and a reader reconstructing what happened would have to
  // pair them up by entity id and timestamp.
  //
  // This is the opposite of the `family.duplicate_override` decision, and for a
  // reason that distinguishes them: acknowledging a duplicate is a decision about
  // a record that already exists, while an availability override qualifies the
  // write being made in the same breath.
  'appointment_series.created',
  'appointment_series.updated',
  // Availability is current configuration, so a change is one action carrying
  // the windows as values — exactly how a guardian change is recorded inside
  // `family.updated`.
  'therapist_availability.updated',
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
  'appointment',
  // Present, unlike `guardian`: a seat is not replaced wholesale with its
  // booking. It carries its own attendance outcome, it will be named by a
  // session charge, and an audit row therefore has to be able to name the seat
  // rather than the appointment around it.
  'appointment_participant',
  'appointment_series',
  // `therapist_availability` and `therapist_availability_exception` are
  // deliberately absent, for the reason `guardian` is: they are current
  // configuration replaced as a set, and the change is recorded against the
  // existing `therapist` entity type as values rather than against a window id.
  // `guardian` is deliberately absent: guardians are replaced as a set with
  // their family, so a guardian change is recorded inside `family.updated` as
  // an ordered list of values, and no audit row ever names a guardian id.
  //
  // `registration_draft` is absent for a different reason: a draft is transient
  // workflow state that is deleted within ten minutes, not a historical fact.
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];
