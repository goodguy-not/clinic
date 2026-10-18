import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateFamilyRequest,
  DuplicateCandidate,
  FamilyBalance,
  FamilyDetailResponse,
  FamilyListResponse,
  FamilySearchRequest,
  FamilyWriteResponse,
  NoticeCode,
  UpdateFamilyRequest,
  UpdateFamilyStatusRequest,
} from '@clinic/contracts';
import { AuditService } from '../../audit/audit.service';
import { AppError } from '../../common/app-error';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { uuidv7 } from '../../common/uuid';
import { readFamilyPosition } from '../../ledger/family-position';
import { PrismaService } from '../../prisma/prisma.service';
import { actorContext } from '../../catalog/catalog-support';
import { auditSafeDuplicateOverride, auditSafeFamily } from '../audit-safe';
import { RegistrationDraftsService } from '../drafts/registration-drafts.service';
import {
  acquireFamilyMobileLocks,
  blockingCandidateIds,
  blockingCandidates,
  findFamilyDuplicateCandidates,
  nonBlockingNotices,
} from '../duplicate-detection';
import {
  groupByFamily,
  presentValues,
  toChildSummary,
  toFamily,
  toFamilySummary,
  toGuardian,
  orderChildren,
  orderGuardians,
  unique,
  type ChildRow,
  type FamilyRow,
  type GuardianRow,
} from '../family-support';

/**
 * Families: search, detail, registration, editing and deactivation.
 *
 * Every write follows the same shape — take the locks, recompute duplicates,
 * decide, then write and audit inside the one transaction — and the plain route
 * and its confirmation route share the writer, so the two can never drift apart
 * in what they check or what they record.
 */

/**
 * A confirmation that must roll back rather than return.
 *
 * The draft is deleted early in the confirmation transaction, so refusing has
 * to undo that delete — and only a rollback does. Throwing is the mechanism;
 * this type is what tells the caller the throw was expected.
 */
class ConfirmationBlocked extends Error {
  constructor(readonly candidates: DuplicateCandidate[]) {
    super('Confirmation refused: a blocking duplicate was not acknowledged');
    this.name = 'ConfirmationBlocked';
  }
}

type ConfirmationOutcome = {
  kind: 'created';
  family: FamilyRow;
  guardians: GuardianRow[];
  warnings: NoticeCode[];
};

/** Enough matches to know there are more, without paging. */
const SEARCH_LIMIT = 50;
const SEARCH_FETCH = SEARCH_LIMIT + 1;

/** What an empty query returns: the "I just registered them" path. */
const RECENT_LIMIT = 25;

/**
 * A digit query shorter than this is not a phone number, it is a typo.
 *
 * The contract already enforces two characters. Four is the point at which a
 * suffix match stops returning most of the clinic.
 */
const MIN_DIGIT_SUFFIX_LENGTH = 4;

const GUARDIAN_COLUMNS = Prisma.sql`
  g.id, g.family_id, g.full_name, g.relationship::text AS relationship,
  g.relationship_note, g.mobile, g.landline, g.is_primary_contact
`;

/**
 * `birth_date` is cast to text in SQL rather than returned as a `Date`.
 *
 * A `DATE` has no time and no offset; building a JavaScript `Date` from one
 * gives it both, and the calendar day then shifts either side of midnight
 * depending on where the process runs. The contract carries `YYYY-MM-DD`, so
 * the string never becomes an instant at all.
 */
const CHILD_COLUMNS = Prisma.sql`
  c.id, c.family_id, c.first_name, c.last_name, c.file_number,
  c.birth_date::text AS birth_date, c.status::text AS status
`;

const FAMILY_COLUMNS = Prisma.sql`
  f.id, f.family_name, f.address, f.note, f.status::text AS status,
  f.deactivated_at, f.created_at
`;

@Injectable()
export class FamiliesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly drafts: RegistrationDraftsService,
  ) {}

  /**
   * Search.
   *
   * A POST that reads, which is unusual enough to be worth stating: the term is
   * a guardian's name, a child's name, a mobile number or a file number, and a
   * query string reaches the address bar, browser history, the `Referer` header
   * and every access log between the clinic and the server. There is no
   * `GET /families?q=`, and a test asserts so.
   *
   * The term is never logged.
   *
   * Ranking, best first:
   *   0  exact file number, exact legacy paper number, or a full phone number
   *   1  a phone number by its last four or more digits
   *   2  a normalised name prefix
   *   3  a normalised name substring
   *
   * Normalisation is `fa_normalize`, the same function that produced the stored
   * `search_*` columns — one implementation, so search cannot disagree with
   * storage. Every LIKE pattern goes through `search_like_escape`, so a query of
   * `%` searches for a literal percent sign rather than returning the clinic.
   */
  async search(query: FamilySearchRequest): Promise<FamilyListResponse> {
    const term = query.q?.trim() ?? '';
    // Defaults to false. An inactive family is one somebody deliberately took
    // out of the daily list, so it reappears only when asked for.
    const includeInactive = query.includeInactive === true;

    const families =
      term === ''
        ? await this.recentFamilies(includeInactive)
        : await this.rankedFamilies(term, includeInactive);

    const truncated = families.length > SEARCH_LIMIT;
    const page = truncated ? families.slice(0, SEARCH_LIMIT) : families;

    return { families: await this.summarise(page), truncated };
  }

  async get(id: string): Promise<FamilyDetailResponse> {
    const families = await this.prisma.$queryRaw<FamilyRow[]>`
      SELECT ${FAMILY_COLUMNS} FROM family f WHERE f.id = ${id}::uuid
    `;

    const family = families[0];
    if (family === undefined) throw new AppError('FAMILY_NOT_FOUND');

    const [guardians, children] = await Promise.all([
      this.prisma.$queryRaw<GuardianRow[]>`
        SELECT ${GUARDIAN_COLUMNS} FROM guardian g WHERE g.family_id = ${id}::uuid
      `,
      this.prisma.$queryRaw<ChildRow[]>`
        SELECT ${CHILD_COLUMNS} FROM child c WHERE c.family_id = ${id}::uuid
      `,
    ]);

    return {
      family: toFamily(family),
      guardians: orderGuardians(guardians).map(toGuardian),
      children: orderChildren(children).map(toChildSummary),
    };
  }

  /**
   * Registers a family and its guardians.
   *
   * One transaction covers the locks, the duplicate recomputation and both
   * inserts. That is deliberately tighter than detecting in one transaction and
   * inserting in another: with two, the locks release at the first commit and a
   * competing registration can land in the gap. With one, the decision and the
   * write are the same atomic act.
   *
   * A blocking duplicate returns from the transaction having written nothing,
   * and the draft is created afterwards in its own transaction — a draft must
   * never share a transaction with a domain insert, because its whole purpose is
   * to survive a write that did not happen.
   */
  async create(
    input: CreateFamilyRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<FamilyWriteResponse> {
    const mobiles = presentValues(input.guardians.map((guardian) => guardian.mobile));
    const landlines = presentValues(input.guardians.map((guardian) => guardian.landline));
    const guardianNames = unique(input.guardians.map((guardian) => guardian.fullName));

    const outcome = await this.prisma.$transaction(async (tx) => {
      await acquireFamilyMobileLocks(tx, mobiles);

      const candidates = await findFamilyDuplicateCandidates(tx, {
        familyName: input.familyName,
        guardianNames,
        mobiles,
        landlines,
      });

      const blocking = blockingCandidates(candidates);
      if (blocking.length > 0) {
        // Nothing has been written. The transaction commits having taken locks
        // and read rows, which is exactly what it was for.
        return { kind: 'blocked' as const, candidates };
      }

      const written = await this.insertFamily(tx, input, actor, context);

      return {
        kind: 'created' as const,
        ...written,
        warnings: nonBlockingNotices(candidates) as NoticeCode[],
      };
    });

    if (outcome.kind === 'blocked') return this.refuse(outcome.candidates, input, actor);

    return {
      family: toFamily(outcome.family),
      guardians: orderGuardians(outcome.guardians).map(toGuardian),
      // A family may legitimately have no children: registration is two
      // requests, and this is the first.
      children: [],
      nonBlockingWarnings: outcome.warnings,
    };
  }

  /**
   * Confirms a registration that was blocked as a possible duplicate.
   *
   * The browser sends the acknowledgement and nothing else. The family and its
   * guardians come back out of the draft, so the personal data somebody typed is
   * never asked for a second time and never has to survive a round trip through
   * the browser.
   *
   * ONE TRANSACTION, in the canonical lock order:
   *
   *   registration_draft FOR UPDATE
   *     -> validate token, user, session, purpose, expiry
   *     -> DELETE the draft
   *     -> advisory mobile locks, ascending numeric key order
   *     -> recompute blocking duplicates AUTHORITATIVELY
   *     -> compare against the acknowledgement
   *     -> insert family, insert guardians, audit
   *
   * The draft lock is taken first and the domain rows are written last, which is
   * the global order every path in this module follows.
   *
   * THE STORED CANDIDATE IDS ARE NOT CONSULTED. They record what somebody was
   * shown when they were blocked; between then and now a family may have been
   * deactivated, or — the case that matters — a new one may have been
   * registered. Only a fresh recomputation under the locks can decide.
   */
  async confirmRegistration(
    token: string,
    acknowledgedDuplicateIds: readonly string[],
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<FamilyWriteResponse> {
    const acknowledged = new Set(acknowledgedDuplicateIds);

    let outcome: ConfirmationOutcome;

    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        const draft = await this.drafts.lockForConsumption(tx, token, actor, 'FAMILY_CREATE');
        const input = this.drafts.parseFamilyPayload(draft, 'FAMILY_CREATE');

        // Consumed here, inside the transaction. If anything below refuses, the
        // rollback un-deletes it and the typed values survive.
        await this.drafts.consume(tx, draft.id);

        const mobiles = presentValues(input.guardians.map((guardian) => guardian.mobile));

        await acquireFamilyMobileLocks(tx, mobiles);

        const candidates = await findFamilyDuplicateCandidates(tx, {
          familyName: input.familyName,
          guardianNames: unique(input.guardians.map((guardian) => guardian.fullName)),
          mobiles,
          landlines: presentValues(input.guardians.map((guardian) => guardian.landline)),
        });

        const blocking = blockingCandidates(candidates);
        const unacknowledged = blocking.filter(
          (candidate) => !acknowledged.has(candidate.familyId),
        );

        if (unacknowledged.length > 0) {
          // Thrown rather than returned, because the DELETE above must be undone
          // and only a rollback does that. Caught immediately outside.
          throw new ConfirmationBlocked(candidates);
        }

        const written = await this.insertFamily(tx, input, actor, context);

        // Only when something was actually overridden. If every candidate had
        // vanished by now, nothing was overridden and claiming otherwise would
        // put a decision in the permanent record that nobody made.
        if (blocking.length > 0) {
          await this.audit.record(tx, actorContext(actor, context), {
            action: 'family.duplicate_override',
            entityType: 'family',
            entityId: written.family.id,
            // Ids and rule names only, and both recomputed server-side. The
            // request's acknowledgement list is a permission, not a fact: a
            // stale or padded list must not be what the audit trail records.
            metadata: auditSafeDuplicateOverride({
              acknowledgedIds: blocking.map((candidate) => candidate.familyId),
              rules: blocking.map((candidate) => candidate.rule),
            }),
          });
        }

        return {
          kind: 'created' as const,
          ...written,
          warnings: nonBlockingNotices(candidates) as NoticeCode[],
        };
      });
    } catch (error) {
      if (error instanceof ConfirmationBlocked) {
        return this.refuseConfirmation(error.candidates, token, actor);
      }
      throw error;
    }

    return {
      family: toFamily(outcome.family),
      guardians: orderGuardians(outcome.guardians).map(toGuardian),
      children: [],
      nonBlockingWarnings: outcome.warnings,
    };
  }

  /**
   * Edits a family and replaces its guardian set.
   *
   * Guardians are replaced wholesale rather than diffed. They carry no history
   * of their own — the change is recorded in `audit_log` under `family.updated`
   * as an ordered list of values — and nothing references a guardian id, so
   * there is no RESTRICT to work around. Both statements are in one transaction,
   * so a rejected guardian leaves the previous set intact rather than a
   * half-applied one.
   *
   * An INACTIVE family may still be edited. Deactivation takes a record out of
   * the daily list; it does not make it uncorrectable, and refusing to fix a
   * misspelled name on a discharged family would be a rule with no purpose.
   */
  async update(
    id: string,
    input: UpdateFamilyRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<FamilyWriteResponse> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const before = await this.lockFamily(tx, id);
      const mobiles = presentValues(input.guardians.map((guardian) => guardian.mobile));

      await acquireFamilyMobileLocks(tx, mobiles);

      const candidates = await findFamilyDuplicateCandidates(tx, {
        familyName: input.familyName,
        guardianNames: unique(input.guardians.map((guardian) => guardian.fullName)),
        mobiles,
        landlines: presentValues(input.guardians.map((guardian) => guardian.landline)),
        // A family is never its own duplicate.
        excludeFamilyId: id,
      });

      if (blockingCandidates(candidates).length > 0) {
        return { kind: 'blocked' as const, candidates };
      }

      const written = await this.writeFamilyUpdate(tx, id, input, actor, context, before);

      return {
        kind: 'updated' as const,
        ...written,
        warnings: nonBlockingNotices(candidates),
      };
    });

    if (outcome.kind === 'blocked') {
      const draft = await this.drafts.createDraft({
        purpose: 'FAMILY_UPDATE',
        payload: input,
        shownCandidateIds: blockingCandidateIds(outcome.candidates),
        actor,
        targetFamilyId: id,
      });

      throw new AppError('FAMILY_POSSIBLE_DUPLICATE', {
        candidates: outcome.candidates,
        draftToken: draft.token,
        draftExpiresAt: draft.expiresAt,
      });
    }

    return this.respondWithChildren(outcome.family, outcome.guardians, outcome.warnings);
  }

  /** Consumes a `FAMILY_UPDATE` draft and applies the edit it was holding. */
  async confirmUpdate(
    token: string,
    acknowledgedDuplicateIds: readonly string[],
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<FamilyWriteResponse> {
    const acknowledged = new Set(acknowledgedDuplicateIds);

    let outcome: { family: FamilyRow; guardians: GuardianRow[]; warnings: NoticeCode[] };

    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        const draft = await this.drafts.lockForConsumption(tx, token, actor, 'FAMILY_UPDATE');
        const input = this.drafts.parseFamilyPayload(draft, 'FAMILY_UPDATE');

        const familyId = draft.target_family_id;
        if (familyId === null) throw new AppError('DRAFT_NOT_FOUND');

        await this.drafts.consume(tx, draft.id);

        // Draft, then family, then advisory keys — the global order.
        const before = await this.lockFamily(tx, familyId);
        const mobiles = presentValues(input.guardians.map((guardian) => guardian.mobile));

        await acquireFamilyMobileLocks(tx, mobiles);

        const candidates = await findFamilyDuplicateCandidates(tx, {
          familyName: input.familyName,
          guardianNames: unique(input.guardians.map((guardian) => guardian.fullName)),
          mobiles,
          landlines: presentValues(input.guardians.map((guardian) => guardian.landline)),
          excludeFamilyId: familyId,
        });

        const blocking = blockingCandidates(candidates);
        if (blocking.some((candidate) => !acknowledged.has(candidate.familyId))) {
          throw new ConfirmationBlocked(candidates);
        }

        const written = await this.writeFamilyUpdate(tx, familyId, input, actor, context, before);

        if (blocking.length > 0) {
          await this.audit.record(tx, actorContext(actor, context), {
            action: 'family.duplicate_override',
            entityType: 'family',
            entityId: familyId,
            metadata: auditSafeDuplicateOverride({
              acknowledgedIds: blocking.map((candidate) => candidate.familyId),
              rules: blocking.map((candidate) => candidate.rule),
            }),
          });
        }

        return { ...written, warnings: nonBlockingNotices(candidates) };
      });
    } catch (error) {
      if (error instanceof ConfirmationBlocked) {
        return this.refuseConfirmation(error.candidates, token, actor);
      }
      throw error;
    }

    return this.respondWithChildren(outcome.family, outcome.guardians, outcome.warnings);
  }

  /**
   * Activates or deactivates a family.
   *
   * Deliberately does NOT cascade to children. A child of an inactive family
   * keeps its own status, so reactivating the family restores exactly the state
   * it had rather than a state this method invented; the appointment milestone
   * refuses to book against an inactive family regardless.
   *
   * NOT SILENTLY WHILE IT HOLDS MONEY (DECISION_LOG, 2026-10-01). Deactivating a
   * family that owes money or holds credit needs `acknowledgedBalance` equal to
   * the balance derived here, inside the transaction, after the family row is
   * locked; otherwise nothing is written and the refusal carries the balance to
   * show. The position is `readFamilyPosition` — the account's own derivation —
   * so the warning quotes the figure the family's account shows.
   *
   * The `FOR UPDATE` on the family conflicts with the key-share lock a new
   * payment or charge takes on it, so neither can land between this read and the
   * commit. A void or a concession touches no family row and can; it is audited
   * on its own, and the reports list the family whatever its status, which is the
   * guarantee — this acknowledgement is the warning in front of it.
   */
  async changeStatus(
    id: string,
    request: UpdateFamilyStatusRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<FamilyDetailResponse> {
    const { status } = request;

    await this.prisma.$transaction(async (tx) => {
      const before = await this.lockFamily(tx, id);

      // Already in the requested state: return it unchanged rather than writing
      // an audit row whose before and after are identical.
      if (before.status === status) return;

      const held = status === 'INACTIVE' ? await heldBalance(tx, id) : null;
      if (held !== null && !sameBalance(request.acknowledgedBalance, held)) {
        throw new AppError('FAMILY_BALANCE_UNACKNOWLEDGED', held);
      }

      await tx.$executeRaw`
        UPDATE family SET
          status = ${status}::record_status,
          deactivated_at = ${
            status === 'INACTIVE' ? Prisma.sql`transaction_timestamp()` : Prisma.sql`NULL`
          }
        WHERE id = ${id}::uuid
      `;

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'family.status_changed',
        entityType: 'family',
        entityId: id,
        before: { status: before.status },
        after: { status },
      });

      if (held !== null) {
        await this.audit.record(tx, actorContext(actor, context), {
          action: 'family.deactivated_with_balance',
          entityType: 'family',
          entityId: id,
          metadata: { amountDueToman: held.amountDueToman, creditToman: held.creditToman },
        });
      }
    });

    return this.get(id);
  }

  /**
   * The one place a family edit is written.
   *
   * Shared by the plain route and the confirmation route, for the same reason
   * `insertFamily` is: two implementations would eventually disagree about a
   * column or an audit payload, and the confirmation path is the one nobody
   * exercises by hand.
   */
  private async writeFamilyUpdate(
    tx: Prisma.TransactionClient,
    id: string,
    input: UpdateFamilyRequest,
    actor: ResolvedSession,
    context: RequestContext,
    before: FamilyRow,
  ): Promise<{ family: FamilyRow; guardians: GuardianRow[] }> {
    const beforeGuardians = await this.readGuardians(tx, id);

    await tx.$executeRaw`
      UPDATE family SET
        family_name = ${input.familyName},
        search_family_name = fa_normalize(${input.familyName}),
        address = ${input.address},
        note = ${input.note}
      WHERE id = ${id}::uuid
    `;

    await tx.$executeRaw`DELETE FROM guardian WHERE family_id = ${id}::uuid`;

    for (const guardian of input.guardians) {
      await tx.$executeRaw`
        INSERT INTO guardian (
          id, family_id, full_name, search_full_name, relationship,
          relationship_note, mobile, landline, is_primary_contact
        ) VALUES (
          ${uuidv7()}::uuid, ${id}::uuid, ${guardian.fullName},
          fa_normalize(${guardian.fullName}),
          ${guardian.relationship}::guardian_relationship,
          ${guardian.relationshipNote}, ${guardian.mobile}, ${guardian.landline},
          ${guardian.isPrimaryContact}
        )
      `;
    }

    const [family, guardians] = await Promise.all([
      this.readFamily(tx, id),
      this.readGuardians(tx, id),
    ]);

    await this.audit.record(tx, actorContext(actor, context), {
      action: 'family.updated',
      entityType: 'family',
      entityId: id,
      before: auditSafeFamily({
        familyName: before.family_name,
        address: before.address,
        note: before.note,
        guardians: beforeGuardians.map(toGuardian),
      }),
      after: auditSafeFamily({
        familyName: family.family_name,
        address: family.address,
        note: family.note,
        guardians: guardians.map(toGuardian),
      }),
    });

    return { family, guardians };
  }

  /** Locks a family row for the rest of the transaction. */
  private async lockFamily(tx: Prisma.TransactionClient, id: string): Promise<FamilyRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM family WHERE id = ${id}::uuid FOR UPDATE
    `;

    if (locked[0] === undefined) throw new AppError('FAMILY_NOT_FOUND');

    return this.readFamily(tx, id);
  }

  /** An update response carries the family's children; a registration has none. */
  private async respondWithChildren(
    family: FamilyRow,
    guardians: GuardianRow[],
    warnings: NoticeCode[],
  ): Promise<FamilyWriteResponse> {
    const children = await this.prisma.$queryRaw<ChildRow[]>`
      SELECT ${CHILD_COLUMNS} FROM child c WHERE c.family_id = ${family.id}::uuid
    `;

    return {
      family: toFamily(family),
      guardians: orderGuardians(guardians).map(toGuardian),
      children: orderChildren(children).map(toChildSummary),
      nonBlockingWarnings: warnings,
    };
  }

  /**
   * Writes the family and its guardians, and records the creation.
   *
   * Shared by first submission and confirmation so there is exactly one place
   * that knows how a family is written. Two implementations would eventually
   * disagree about a column, an audit payload or the normalisation — and the
   * confirmation path is the one nobody exercises by hand.
   *
   * The caller supplies the transaction, holds the advisory locks and has
   * already decided that the write may proceed.
   */
  private async insertFamily(
    tx: Prisma.TransactionClient,
    input: CreateFamilyRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<{ family: FamilyRow; guardians: GuardianRow[] }> {
    const familyId = uuidv7();

    await tx.$executeRaw`
      INSERT INTO family (
        id, family_name, search_family_name, address, note, status,
        deactivated_at, created_at, created_by_user_id
      ) VALUES (
        ${familyId}::uuid,
        ${input.familyName},
        -- Normalised by PostgreSQL, in the same statement, so the derived key
        -- cannot drift from the value. A CHECK asserts the pair anyway.
        fa_normalize(${input.familyName}),
        ${input.address},
        ${input.note},
        'ACTIVE'::record_status,
        NULL,
        transaction_timestamp(),
        ${actor.userId}::uuid
      )
    `;

    for (const guardian of input.guardians) {
      await tx.$executeRaw`
        INSERT INTO guardian (
          id, family_id, full_name, search_full_name, relationship,
          relationship_note, mobile, landline, is_primary_contact
        ) VALUES (
          ${uuidv7()}::uuid,
          ${familyId}::uuid,
          ${guardian.fullName},
          fa_normalize(${guardian.fullName}),
          ${guardian.relationship}::guardian_relationship,
          ${guardian.relationshipNote},
          ${guardian.mobile},
          ${guardian.landline},
          ${guardian.isPrimaryContact}
        )
      `;
    }

    const [family, guardians] = await Promise.all([
      this.readFamily(tx, familyId),
      this.readGuardians(tx, familyId),
    ]);

    // Built only through the masking mapper. A full mobile or landline never
    // reaches `audit_log`, and `audit_log_masked_identifiers_chk` would refuse
    // the row if this ever stopped being true.
    await this.audit.record(tx, actorContext(actor, context), {
      action: 'family.created',
      entityType: 'family',
      entityId: familyId,
      after: auditSafeFamily({
        familyName: family.family_name,
        address: family.address,
        note: family.note,
        status: family.status,
        guardians: guardians.map(toGuardian),
      }),
    });

    return { family, guardians };
  }

  /**
   * A confirmation refused because the situation changed underneath it.
   *
   * The transaction has already rolled back, so the draft is intact. This
   * re-arms it with the candidates that are true now and a fresh ten minutes,
   * and hands back THE SAME token — the caller already holds it in a cookie, and
   * minting a second would leave two live credentials for one draft.
   */
  private async refuseConfirmation(
    candidates: readonly DuplicateCandidate[],
    token: string,
    actor: ResolvedSession,
  ): Promise<never> {
    const expiresAt = await this.drafts.refreshAfterRepeatBlock(
      token,
      actor,
      blockingCandidateIds(candidates),
    );

    throw new AppError('FAMILY_POSSIBLE_DUPLICATE', {
      candidates,
      draftToken: token,
      draftExpiresAt: expiresAt,
    });
  }

  /**
   * Turns a blocking duplicate into the approved 409.
   *
   * The draft is written in its own transaction, after the detection
   * transaction has committed, and the token crosses to the caller exactly once
   * so a Route Handler can put it in an HttpOnly cookie. It appears in no log —
   * `ErrorEnvelopeFilter` logs only `message` and `stack`, and only above 500 —
   * in no audit row, and in no URL.
   */
  private async refuse(
    candidates: readonly DuplicateCandidate[],
    input: CreateFamilyRequest,
    actor: ResolvedSession,
  ): Promise<never> {
    const draft = await this.drafts.createDraft({
      purpose: 'FAMILY_CREATE',
      payload: input,
      shownCandidateIds: blockingCandidateIds(candidates),
      actor,
    });

    throw new AppError('FAMILY_POSSIBLE_DUPLICATE', {
      candidates,
      draftToken: draft.token,
      draftExpiresAt: draft.expiresAt,
    });
  }

  private async readFamily(tx: Prisma.TransactionClient, id: string): Promise<FamilyRow> {
    const rows = await tx.$queryRaw<FamilyRow[]>`
      SELECT ${FAMILY_COLUMNS} FROM family f WHERE f.id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('FAMILY_NOT_FOUND');
    return row;
  }

  private readGuardians(tx: Prisma.TransactionClient, familyId: string): Promise<GuardianRow[]> {
    return tx.$queryRaw<GuardianRow[]>`
      SELECT ${GUARDIAN_COLUMNS} FROM guardian g WHERE g.family_id = ${familyId}::uuid
    `;
  }

  /** The most recently registered families, for an empty query. */
  private recentFamilies(includeInactive: boolean): Promise<FamilyRow[]> {
    return this.prisma.$queryRaw<FamilyRow[]>`
      SELECT ${FAMILY_COLUMNS} FROM family f
      WHERE ${includeInactive ? Prisma.sql`true` : Prisma.sql`f.status = 'ACTIVE'`}
      ORDER BY f.created_at DESC, f.id DESC
      LIMIT ${RECENT_LIMIT}
    `;
  }

  /**
   * The ranked search.
   *
   * One statement, so a family that matches on several rules is returned once at
   * its best rank rather than once per match. `min(rank)` is what does that.
   *
   * NOTE THE ESCAPE CLAUSE: `ESCAPE '\\'` and not `ESCAPE '\'`. Inside a
   * JavaScript template literal `\'` is an escaped quote, so the second spelling
   * reaches PostgreSQL as `ESCAPE ''` — an empty escape character, which turns
   * escaping off entirely. The mistake hides itself, because a query of `%` then
   * searches for a name beginning with a literal backslash and still returns
   * nothing; what breaks is finding the family whose name genuinely contains a
   * `%`. An integration test pins both halves.
   */
  private rankedFamilies(term: string, includeInactive: boolean): Promise<FamilyRow[]> {
    return this.prisma.$queryRaw<FamilyRow[]>`
      WITH q AS (
        SELECT
          fa_normalize(${term})                                    AS norm,
          search_like_escape(fa_normalize(${term}))                AS esc,
          regexp_replace(fa_normalize(${term}), '[^0-9]', '', 'g') AS digits
      ),
      hits AS (
        -- Rank 0: an exact identifier. Somebody quoted a number off a file or a
        -- phone screen and it is unambiguous.
        SELECT c.family_id, 0 AS rank FROM child c, q
          WHERE q.digits <> '' AND c.file_number = q.digits
        UNION ALL
        SELECT c.family_id, 0 FROM child c, q
          WHERE c.legacy_paper_file_number IS NOT NULL
            AND fa_normalize(c.legacy_paper_file_number) = q.norm
        UNION ALL
        SELECT g.family_id, 0 FROM guardian g, q
          WHERE q.digits <> '' AND (g.mobile = q.digits OR g.landline = q.digits)

        UNION ALL

        -- Rank 1: the last digits of a number, which is how somebody reads one
        -- back over the phone.
        SELECT g.family_id, 1 FROM guardian g, q
          WHERE length(q.digits) >= ${MIN_DIGIT_SUFFIX_LENGTH}
            AND (
              g.mobile   LIKE '%' || search_like_escape(q.digits) ESCAPE '\\'
              OR g.landline LIKE '%' || search_like_escape(q.digits) ESCAPE '\\'
            )

        UNION ALL

        -- Rank 2: a normalised name prefix, across all four name columns.
        SELECT f.id, 2 FROM family f, q
          WHERE q.norm <> '' AND f.search_family_name LIKE q.esc || '%' ESCAPE '\\'
        UNION ALL
        SELECT g.family_id, 2 FROM guardian g, q
          WHERE q.norm <> '' AND g.search_full_name LIKE q.esc || '%' ESCAPE '\\'
        UNION ALL
        SELECT c.family_id, 2 FROM child c, q
          WHERE q.norm <> '' AND (
            c.search_first_name LIKE q.esc || '%' ESCAPE '\\'
            OR c.search_last_name LIKE q.esc || '%' ESCAPE '\\'
          )

        UNION ALL

        -- Rank 3: a normalised substring.
        SELECT f.id, 3 FROM family f, q
          WHERE q.norm <> '' AND f.search_family_name LIKE '%' || q.esc || '%' ESCAPE '\\'
        UNION ALL
        SELECT g.family_id, 3 FROM guardian g, q
          WHERE q.norm <> '' AND g.search_full_name LIKE '%' || q.esc || '%' ESCAPE '\\'
        UNION ALL
        SELECT c.family_id, 3 FROM child c, q
          WHERE q.norm <> '' AND (
            c.search_first_name LIKE '%' || q.esc || '%' ESCAPE '\\'
            OR c.search_last_name LIKE '%' || q.esc || '%' ESCAPE '\\'
          )
      ),
      ranked AS (
        SELECT family_id, min(rank) AS rank FROM hits GROUP BY family_id
      )
      SELECT ${FAMILY_COLUMNS}
      FROM ranked r
      JOIN family f ON f.id = r.family_id
      WHERE ${includeInactive ? Prisma.sql`true` : Prisma.sql`f.status = 'ACTIVE'`}
      -- The id comes last so the order is total: two families can share a rank,
      -- a normalised name and a creation instant, and a list that reshuffles
      -- between identical requests is a list nobody can test.
      ORDER BY r.rank ASC, f.search_family_name ASC, f.created_at ASC, f.id ASC
      LIMIT ${SEARCH_FETCH}
    `;
  }

  /**
   * Attaches guardians and children to a page of families.
   *
   * Two extra queries for the whole page rather than two per row: an N+1 here
   * would be a round trip per family on the screen a receptionist uses most.
   */
  private async summarise(families: readonly FamilyRow[]): Promise<FamilyListResponse['families']> {
    if (families.length === 0) return [];

    const ids = families.map((family) => family.id);

    const [guardians, children] = await Promise.all([
      this.prisma.$queryRaw<GuardianRow[]>`
        SELECT ${GUARDIAN_COLUMNS} FROM guardian g WHERE g.family_id = ANY (${ids}::uuid[])
      `,
      this.prisma.$queryRaw<ChildRow[]>`
        SELECT ${CHILD_COLUMNS} FROM child c WHERE c.family_id = ANY (${ids}::uuid[])
      `,
    ]);

    const guardiansByFamily = groupByFamily(guardians);
    const childrenByFamily = groupByFamily(children);

    return families.map((family) =>
      toFamilySummary(
        family,
        guardiansByFamily.get(family.id) ?? [],
        childrenByFamily.get(family.id) ?? [],
      ),
    );
  }
}

/**
 * What the family owes or holds, or `null` when it is settled — the account's
 * own position, never a second derivation.
 */
async function heldBalance(
  tx: Prisma.TransactionClient,
  familyId: string,
): Promise<FamilyBalance | null> {
  const { amountDueToman, creditToman } = await readFamilyPosition(tx, familyId);
  if (amountDueToman === '0' && creditToman === '0') return null;
  return { amountDueToman, creditToman };
}

/** Canonical decimal strings, so equal amounts are equal strings. */
function sameBalance(acknowledged: FamilyBalance | undefined, held: FamilyBalance): boolean {
  return (
    acknowledged !== undefined &&
    acknowledged.amountDueToman === held.amountDueToman &&
    acknowledged.creditToman === held.creditToman
  );
}
