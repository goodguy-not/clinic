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

  // Appointments. The vocabulary was fixed here before the endpoints existed so
  // the audit contract could not change underneath them; every action below is
  // written by a Milestone 4 state change.
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

  // The ledger. Four actions over two records, named after the tables they
  // describe, and every one of them is a financial fact rather than a status
  // diff. The runtime writes arrive with the services that make these state
  // changes; the vocabulary is fixed here so the audit contract cannot change
  // underneath them.
  //
  // Posting and voiding are separate actions rather than one
  // `session_charge.changed`, for the reason completion and cancellation are:
  // "how often is a charge withdrawn, and why?" is the question PROJECT_SPEC.md
  // 9 exists to let a manager ask, and an answer buried in a JSON diff is not
  // something you can count.
  //
  // There is deliberately no `session_charge.adjusted`. A concession is a row in
  // `charge_adjustment`, not a change to the charge, so the audit row names the
  // record that was actually written — and the pair of adjustment actions is
  // what makes "granted then withdrawn" two facts instead of one entry read as
  // a diff. Nothing here records a re-post as its own action either: a re-post
  // IS a post, and the void that preceded it is already its own fact.
  'session_charge.posted',
  'session_charge.voided',
  'charge_adjustment.created',
  'charge_adjustment.voided',

  // Money in. Six actions over two records, named after the tables they
  // describe, exactly as the ledger's are. The runtime writes arrive with the
  // services that make these state changes; the vocabulary is fixed here in
  // checkpoint A2 so the audit contract cannot change underneath them.
  //
  // `payment.recorded` rather than `payment.created`: the row is created, but
  // the fact is that money was received, and the action a manager searches for
  // is the one named after the fact.
  //
  // THE THREE PROMISE RESOLUTIONS ARE THREE ACTIONS, not one
  // `payment_promise.resolved` carrying a status diff — even though they share a
  // single permission. The permission is one authority because none of the three
  // moves money; the audit is three facts because "how often does a family
  // reschedule rather than pay?" is precisely the question a pilot asks of
  // promises, and an answer buried in a JSON diff is not something you can
  // count.
  //
  // There is deliberately no `payment_promise.missed`. Missed is a fact about
  // the clock that nobody performs, derived on read from an OPEN promise whose
  // due date has passed (DECISION_LOG, 2026-08-15), and audit records state
  // changes rather than the passage of time. There is no `payment.updated`
  // either: nothing about a payment is ever rewritten.
  'payment.recorded',
  'payment.voided',
  'payment_promise.created',
  'payment_promise.fulfilled',
  'payment_promise.rescheduled',
  'payment_promise.cancelled',

  // Reporting. ONE ACTION, AND IT IS THE MILESTONE 7 EXCEPTION TO "A READ IS
  // NOT AUDITED" (checkpoint C5). Every other report route writes nothing at
  // all, deliberately: copying a read into an append-only permanent table would
  // build a second, undeletable store of who was seen and what they owe, growing
  // with every screen refresh. An EXPORT is a different kind of event — the
  // facts leave the system as a file, the file outlives the session, and nothing
  // in this application can observe it again — so what is recorded is the ACT of
  // taking it, once, at the moment it succeeded.
  //
  // IT RECORDS THAT AN EXPORT HAPPENED AND WHAT IT WAS SCOPED TO, NEVER WHAT WAS
  // IN IT. The payload is the report name, the format, the range and basis where
  // the report has one, the opaque entity ids the caller filtered by, and the
  // number of rows. No amount, no total, no family, child, therapist or user
  // name, no file number, no identifier and no free text of any kind — see
  // `reports/report-export-audit.ts`, which builds the payload and is the only
  // place that may.
  //
  // ONE ACTION RATHER THAN ONE PER REPORT. "How often does anybody take data out
  // of this system?" is the question this row exists to answer, and it is asked
  // of exports as a class; WHICH report is a value in the payload, which is
  // exactly the shape a reviewer filters on. That is the opposite of the
  // completion-versus-cancellation split above, and for the reason that
  // distinguishes them: those are two different state changes, while these are
  // one act performed on five surfaces.
  //
  // A REFUSED EXPORT WRITES NOTHING HERE. `PermissionsGuard` rejects it before
  // any service runs, and an authorisation failure is a security-log concern
  // rather than an audit fact (`common/security-log.ts`) — auditing refusals
  // would let an unauthenticated caller fill the table by asking.
  'report.exported',

  // Therapist settlement (Milestone 8, checkpoint C1). FIVE ACTIONS OVER THREE
  // RECORDS, named after the tables they will describe, exactly as the ledger's
  // and the payment's are. Nothing writes any of them yet: the vocabulary is
  // fixed here so the audit contract cannot change underneath the services that
  // arrive in the later checkpoints, which is the same reason every previous
  // milestone fixed its actions a checkpoint early.
  //
  // A SHARE RULE IS NEVER EDITED, so there is no `therapist_share_rule.updated`.
  // A correction voids the row and writes a replacement, and a percentage change
  // is therefore two audited facts — the share that stopped applying and the one
  // that replaced it — rather than one entry a reader has to interpret as a
  // diff. It is the tariff decision, applied to the other side of the money.
  //
  // RATING AND VOIDING ARE SEPARATE FACTS, for the reason posting and voiding a
  // charge are. "How often is a therapist's rating withdrawn, and why?" is
  // exactly the question PROJECT_SPEC.md 9 exists to let a manager ask about
  // somebody's earnings, and an answer buried in a JSON diff is not something
  // you can count. A CORRECTION — withdrawal and replacement in one transaction
  // — writes BOTH of them in that transaction rather than a third
  // `session_settlement.corrected` action: the two facts are what actually
  // happened, they share the request id that ties them together, and a third
  // name would describe one act as three.
  //
  // `settlement_period.closed` IS THE ONLY PERIOD ACTION, because closing is the
  // only thing that ever happens to a period. There is deliberately no
  // `settlement_period.reopened`: a closed period is immutable and is never
  // reopened, so an action naming that act would be vocabulary for a capability
  // the product refuses to have — and the first person to read the list would
  // reasonably assume it exists.
  //
  // NOTHING HERE RECORDS A PAYOUT. Milestone 8 does not record money leaving the
  // clinic, so there is no `settlement.paid`, no `therapist_payment.recorded`
  // and no action of any kind naming a payment to a therapist.
  //
  // EACH MATCHING ENTITY TYPE ARRIVES WITH ITS TABLE, NOT WITH ITS ACTION.
  // `AUDIT_ENTITY_TYPES` is asserted against the real schema — every entry is a
  // table, except the declared non-row subjects, which must NOT be
  // (DECISION_LOG, 2026-08-18) — so an entity type named before its table
  // exists fails that assertion for exactly as long as the table is missing.
  // The action names carry no such coupling: `audit_log.action` is TEXT with a
  // format CHECK, so a name is legal the moment it has the right shape.
  //
  // CHECKPOINT C2 CREATED `therapist_share_rule`, C3 CREATED
  // `session_settlement` AND C6 CREATES `settlement_period`; each entity type is
  // paired below in the checkpoint that created its table. The tripwire in
  // `audit-actions.spec.ts` pins the split in both directions, so it can neither
  // be forgotten nor arrive early.
  'therapist_share_rule.created',
  'therapist_share_rule.voided',
  'session_settlement.rated',
  'session_settlement.voided',
  'settlement_period.closed',

  // The public website (Milestone 9, checkpoint A2). NINE ACTIONS, AND EVERY
  // ONE OF THEM IS A PUBLICATION-BEARING FACT SOMEBODY MAY LATER HAVE TO
  // ACCOUNT FOR.
  //
  // PUBLISHING AND UNPUBLISHING ARE SEPARATE FROM EDITING, AND FROM EACH OTHER.
  // This is the completion-versus-cancellation split applied to content, and
  // the reason is the same: "when did this go on the website, and when did it
  // come off again?" is precisely the question asked after somebody complains
  // about a page, and an answer buried in a JSON diff of a boolean is not
  // something you can count or filter. The draft actions are the ordinary
  // editorial trail; the publication actions are the ones a reviewer reads.
  //
  // A TESTIMONIAL HAS FOUR, BECAUSE APPROVAL AND PUBLICATION ARE DIFFERENT
  // FACTS. `public_testimonial.approved` records that a manager read those
  // exact words and accepted responsibility for them — the privacy review
  // PROJECT_SPEC.md 11 requires — while `.published` records that they were
  // placed on a page. Withdrawing approval also unpublishes, so that one act
  // writes BOTH `.approval_revoked` and `.unpublished` in one transaction,
  // sharing a request id: two things genuinely happened, and a third name for
  // the pair would describe one act as three.
  //
  // THE THERAPIST'S THREE NAME THE PERSON, NOT THE PAGE. Publishing a named
  // colleague's photograph and biography is a decision ABOUT THAT PERSON taken
  // with their agreement, and it is the one audited act in this product whose
  // subject may one day ask to see it. `therapist.public_profile_updated` is
  // preparing the content, which publishes nobody.
  //
  // THERE IS DELIBERATELY NO `service.published` OR `service.public_updated`.
  // A service's public description, slug and visibility are columns on the
  // catalog row, written by the SAME manager form and the SAME `service.update`
  // authority as its name (DECISION_LOG, 2026-08-21) — it is one state change,
  // and `service.updated` already records it with the before and after of every
  // one of those columns in its payload. A second action would describe one
  // write as two facts a reader would then have to pair up, which is the
  // `appointment.availability_override` reasoning rather than the
  // completion-versus-cancellation one.
  //
  // `clinic_public_profile.updated` IS ONE ACTION FOR ONE ROW. There is no
  // publication act to separate: the profile is always live, so editing it IS
  // publishing, and the payload carries what changed.
  //
  // NO FREE-TEXT REASON IS REQUIRED BY ANY OF THESE. A recorded reason exists
  // in this product where an approved rule demands one — the availability
  // override, a void, a concession — and no accepted M9 rule demands one for
  // publishing. Adding a mandatory reason nobody reads is how a mandatory
  // reason becomes a full stop.
  'public_article.created',
  'public_article.updated',
  'public_article.published',
  'public_article.unpublished',
  'public_testimonial.created',
  'public_testimonial.updated',
  'public_testimonial.approved',
  'public_testimonial.approval_revoked',
  'public_testimonial.published',
  'public_testimonial.unpublished',
  'therapist.public_profile_updated',
  'therapist.public_profile_published',
  'therapist.public_profile_unpublished',
  'clinic_public_profile.updated',

  // The public request form (Milestone 9, checkpoint A3). ONE ACTION, AND IT
  // RECORDS AN ACT WITH NO CONTENT WHATSOEVER.
  //
  // `website_request.received` is written by the only anonymous write this
  // application accepts. Its payload is EMPTY — no `before`, no `after`, no
  // `metadata` — and that emptiness is the design rather than an oversight.
  //
  // `website_request` IS THE ONLY TABLE IN THIS SCHEMA WHOSE CONTENT IS ERASED:
  // it holds a stranger's name, mobile, child and words, gathered under a notice
  // promising the clinic will not keep them beyond ninety days, and the retention
  // rule clears those columns in place. `audit_log` is append-only and
  // unprunable. Any intake field copied into a payload here would therefore
  // become a SECOND, PERMANENT copy of exactly the data the erasure exists to
  // remove, and the ninety-day promise would be false the moment it was made.
  //
  // So this row records that a request arrived, when, and under which id, and
  // nothing else. It is the `report.exported` shape — the ACT, never its
  // contents — taken one step further, because an export at least names a
  // report and this names nothing at all. AFTER THE PURGE, THE `entity_id` STILL
  // NAMES A ROW — the minimal lifecycle row the erasure leaves behind — and that
  // is a better residue than the dangling id an outright delete would have left:
  // "somebody wrote in on this day, consented, and we kept nothing they said" is
  // the honest permanent record, and both halves of it are addressable.
  //
  // IT ALSO CARRIES NO IP AND NO USER AGENT, unlike every other audited write in
  // this application. See `anonymousWebsiteAuditContext` in
  // `website/anonymous-audit.ts`, which is the only way this action may be
  // written and drops both.
  //
  // NOTHING RECORDS A REFUSAL. A throttled submission and a malformed one write
  // no audit row at all: they change no state, and an unauthenticated caller who
  // could write to an unprunable table by asking is exactly the growth
  // `security-log.ts` exists to keep out of it. A DUPLICATE-SUPPRESSED
  // SUBMISSION WRITES NOTHING EITHER, for the same reason and one more — it
  // creates no row, so there is no act and no entity to name.
  //
  // NO ACTION ABOUT AN INBOX, A STATUS, A CONVERSION OR A PURGE RUN. Those are
  // checkpoint A4, and each arrives with the state change it describes.
  'website_request.received',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Entity types currently written. Matches the `entity_type` format CHECK.
 *
 * These are table names, and deliberately so: an audit row names the row it
 * describes, and `entity_id` has no foreign key to enforce that pairing.
 *
 * `report` IS THE ONE EXCEPTION, and it is stated as one rather than left to be
 * discovered — an export names no row, so that entry carries a null `entity_id`
 * and points at no table. The reasoning is at the entry itself, below, and
 * `catalog-schema.int-spec.ts` pins both halves: every other entity type IS a
 * table, and this one is NOT.
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
  // The two Milestone 5 ledger tables. Both are named, and neither is folded
  // into the other: an adjustment is a record in its own right with its own
  // actor, reason and void, and an audit row that named the charge instead
  // would leave the concession's own history unaddressable.
  'session_charge',
  'charge_adjustment',
  // The two Milestone 6 tables. A promise is named in its own right rather than
  // folded into the payment that fulfilled it: it has its own actor, its own
  // resolution and its own reason, and it exists — and is cancelled — in cases
  // where no payment ever appears.
  'payment',
  'payment_promise',
  // The two Milestone 8 tables that exist. `therapist_share_rule` is the
  // AGREEMENT (checkpoint C2) and `session_settlement` is what one session
  // actually EARNED (checkpoint C3); both are named, and neither is folded into
  // the other, because a rating has its own actor, its own reason, its own
  // withdrawal and a percentage that stays readable after the rule behind it is
  // replaced. An audit row that named the rule instead would leave the
  // session's own settlement history unaddressable.
  //
  // `settlement_period` ARRIVES WITH ITS TABLE IN C6, and it is the only one of
  // the checkpoint's two tables named here. `settlement_line` is deliberately
  // absent: a line is not independently decided — it exists because a close
  // materialised it, it can never be edited or withdrawn, and it is permanent in
  // a table with its own no-delete trigger — so no audit row ever names one, and
  // an entity type nothing writes would advertise an act that does not exist.
  // The close is recorded once, against the period, as `settlement_period.closed`.
  'therapist_share_rule',
  'session_settlement',
  'settlement_period',
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
  //
  // `report` IS THE ONE ENTRY THAT NAMES NO TABLE, AND IT NAMES NONE BECAUSE AN
  // EXPORT NAMES NO ROW (Milestone 7, checkpoint C5). Every other entity type
  // here is a table because every other audited fact is a change to a row in it;
  // an export changes nothing anywhere and is about a REPORT — a question asked
  // of many tables — so `entity_id` is null on every one of these rows and there
  // is deliberately no id to put there. Inventing an `export` table to have
  // something to point at would be exactly the stored-export this checkpoint is
  // forbidden to create; naming the surface in the payload instead keeps the
  // audit a record of an act rather than a copy of its result.
  'report',
  // Milestone 9. `clinic_public_profile` arrived as a table in checkpoint A1 and
  // gains its writer in A2; the two content tables arrive with their writer in
  // A2. All three ARE tables, so all three satisfy the assertion above.
  //
  // A `clinic_public_profile` row carries a NULL `entity_id`, and it is the
  // second entry to do so after `report` — but for the opposite reason. An
  // export names no row; this names THE row, and there is only ever one of it.
  // Its primary key is the integer 1, and `entity_id` is a UUID column, so
  // there is no id to write even in principle. A synthetic UUID invented to
  // fill the column would be a foreign key to nothing.
  'clinic_public_profile',
  'public_article',
  'public_testimonial',
  // Milestone 9, checkpoint A3. It IS a table, so it satisfies the assertion
  // above — but it is the only entity type here whose row is emptied rather than
  // only ever added to. The ninety-day retention rule clears its intake columns
  // in place; the row, and therefore this audit row's subject, remains. See
  // `website_request.received`.
  'website_request',
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];
