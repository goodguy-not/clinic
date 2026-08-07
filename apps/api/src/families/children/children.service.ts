import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ChildDetailResponse,
  ChildWriteResponse,
  CreateChildRequest,
  DuplicateCandidate,
  NoticeCode,
  RecordStatus,
  UpdateChildRequest,
} from '@clinic/contracts';
import { AuditService } from '../../audit/audit.service';
import { AppError } from '../../common/app-error';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { uuidv7 } from '../../common/uuid';
import { isUniqueViolation, violatesConstraint } from '../../common/pg-error';
import { PrismaService } from '../../prisma/prisma.service';
import { actorContext } from '../../catalog/catalog-support';
import { auditSafeChild, auditSafeDuplicateOverride } from '../audit-safe';
import { RegistrationDraftsService } from '../drafts/registration-drafts.service';
import {
  acknowledgementId,
  acquireChildIdentityLock,
  blockingCandidateIds,
  blockingCandidates,
  findChildDuplicateCandidates,
  nonBlockingNotices,
} from '../duplicate-detection';
import {
  orderChildren,
  toChild,
  toChildSummary,
  toFamily,
  type ChildFullRow,
  type ChildRow,
  type FamilyRow,
} from '../family-support';

/**
 * Children: the people the clinic treats.
 *
 * A child belongs permanently to one family. `family_id` is listed in the
 * `child_enforce_identity_immutability` trigger, so there is no move operation
 * here and there could not be one — reassignment rewrites who owes for every
 * session that child has ever had, and belongs to a designed repair operation
 * alongside financial history rather than to an edit form.
 *
 * `file_number` is likewise immutable and never accepted from a request: it
 * comes from `child_file_number_seq`, so nobody types it, nobody collides on it,
 * and two people registering at once cannot choose the same one.
 */

const FAMILY_COLUMNS = Prisma.sql`
  f.id, f.family_name, f.address, f.note, f.status::text AS status,
  f.deactivated_at, f.created_at
`;

/**
 * `birth_date` is cast to text so no JavaScript `Date` is ever built from it.
 * A `DATE` has no time and no offset; giving it both shifts the calendar day
 * either side of midnight depending on where the process runs.
 */
const CHILD_COLUMNS = Prisma.sql`
  c.id, c.family_id, c.first_name, c.last_name, c.file_number,
  c.birth_date::text AS birth_date, c.status::text AS status
`;

const CHILD_FULL_COLUMNS = Prisma.sql`
  ${CHILD_COLUMNS}, c.legacy_paper_file_number, c.national_id, c.sex::text AS sex,
  c.referral_source, c.note, c.deactivated_at, c.created_at
`;

/** What a create or update needs to decide, before it writes anything. */
type ChildWriteOutcome =
  | { kind: 'blocked'; candidates: DuplicateCandidate[] }
  | { kind: 'written'; childId: string; warnings: NoticeCode[] };

@Injectable()
export class ChildrenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly drafts: RegistrationDraftsService,
  ) {}

  async get(id: string): Promise<ChildDetailResponse> {
    const child = await this.readChild(this.prisma, id);
    const family = await this.readFamily(this.prisma, child.family_id);
    const siblings = await this.readSiblings(this.prisma, child.family_id, id);

    return {
      child: toChild(child),
      family: toFamily(family),
      siblings: orderChildren(siblings).map(toChildSummary),
    };
  }

  /**
   * Registers a child under a family.
   *
   * One transaction: the family share lock, the birth-date rule, the identity
   * advisory lock, the duplicate recomputation and the insert. As with family
   * registration, keeping the decision and the write together is what removes
   * the window a competing registration could land in.
   *
   * The family is locked `FOR SHARE` rather than `FOR UPDATE`, mirroring the
   * Milestone 2 tariff pattern: a share lock still conflicts with the `UPDATE` a
   * deactivation performs, which is the requirement, while letting two siblings
   * be registered at the same time.
   */
  async create(
    familyId: string,
    input: CreateChildRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<ChildWriteResponse> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      await this.assertFamilyWritable(tx, familyId);
      await this.assertBirthDateNotFuture(tx, input.birthDate);

      return this.writeChild(tx, { familyId, input, actor, context, mode: 'create' });
    });

    if (outcome.kind === 'blocked') {
      return this.refuse(outcome.candidates, 'CHILD_CREATE', input, actor, {
        targetFamilyId: familyId,
        targetChildId: null,
      });
    }

    return this.respond(outcome.childId, outcome.warnings);
  }

  /**
   * Edits a child.
   *
   * Duplicate detection runs only when the identity actually changed — the
   * name or the birth date. Correcting a referral source cannot make a child a
   * duplicate of anybody, and re-checking would take a lock and refuse an edit
   * for a reason unrelated to it.
   */
  async update(
    id: string,
    input: UpdateChildRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<ChildWriteResponse> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const before = await this.lockChild(tx, id);
      await this.assertBirthDateNotFuture(tx, input.birthDate);

      return this.writeChild(tx, {
        familyId: before.family_id,
        input,
        actor,
        context,
        mode: 'update',
        before,
      });
    });

    if (outcome.kind === 'blocked') {
      const child = await this.readChild(this.prisma, id);

      return this.refuse(outcome.candidates, 'CHILD_UPDATE', input, actor, {
        targetFamilyId: child.family_id,
        targetChildId: id,
      });
    }

    return this.respond(outcome.childId, outcome.warnings);
  }

  async changeStatus(
    id: string,
    status: RecordStatus,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<ChildDetailResponse> {
    await this.prisma.$transaction(async (tx) => {
      const before = await this.lockChild(tx, id);

      // Already in the requested state: return it unchanged rather than writing
      // an audit row whose before and after are identical.
      if (before.status === status) return;

      await tx.$executeRaw`
        UPDATE child SET
          status = ${status}::record_status,
          deactivated_at = ${
            status === 'INACTIVE' ? Prisma.sql`transaction_timestamp()` : Prisma.sql`NULL`
          }
        WHERE id = ${id}::uuid
      `;

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'child.status_changed',
        entityType: 'child',
        entityId: id,
        before: { status: before.status },
        after: { status },
      });
    });

    return this.get(id);
  }

  /**
   * Consumes a draft and performs the write it was holding.
   *
   * The canonical lock order: the draft row first, then the family, then the
   * child, then the advisory key. The draft is deleted inside this transaction,
   * so a rollback — which is what a fresh unacknowledged duplicate causes —
   * takes the deletion with it and the draft survives to be tried again.
   */
  async confirm(
    purpose: 'CHILD_CREATE' | 'CHILD_UPDATE',
    token: string,
    acknowledgedIds: readonly string[],
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<ChildWriteResponse> {
    const acknowledged = new Set(acknowledgedIds);

    const outcome = await this.prisma
      .$transaction(async (tx) => {
        const draft = await this.drafts.lockForConsumption(tx, token, actor, purpose);
        const input = this.drafts.parseChildPayload(draft, purpose);

        const familyId = draft.target_family_id;
        if (familyId === null) throw new AppError('DRAFT_NOT_FOUND');

        await this.drafts.consume(tx, draft.id);

        await this.assertFamilyWritable(tx, familyId);
        await this.assertBirthDateNotFuture(tx, input.birthDate);

        const before =
          purpose === 'CHILD_UPDATE' && draft.target_child_id !== null
            ? await this.lockChild(tx, draft.target_child_id)
            : undefined;

        const written = await this.writeChild(tx, {
          familyId,
          input,
          actor,
          context,
          mode: purpose === 'CHILD_CREATE' ? 'create' : 'update',
          before,
          acknowledged,
        });

        if (written.kind === 'blocked') {
          // Rolls back, including the draft deletion above.
          throw new RepeatBlock(written.candidates);
        }

        return written;
      })
      .catch(async (error: unknown) => {
        if (!(error instanceof RepeatBlock)) throw error;

        const expiresAt = await this.drafts.refreshAfterRepeatBlock(
          token,
          actor,
          blockingCandidateIds(error.candidates),
        );

        throw new AppError('CHILD_POSSIBLE_DUPLICATE', {
          candidates: error.candidates,
          draftToken: token,
          draftExpiresAt: expiresAt,
        });
      });

    return this.respond(outcome.childId, outcome.warnings);
  }

  // --- the one write path ---------------------------------------------------

  /**
   * Detects, then inserts or updates. One implementation, so the plain route and
   * the confirmation route cannot drift apart in what they check or what they
   * record.
   *
   * `acknowledged` is supplied only by a confirmation. Without it any blocking
   * candidate refuses; with it, every CURRENT blocking candidate must appear in
   * the set — a stale id is not a substitute for a missing one, and an extra
   * irrelevant id grants nothing.
   */
  private async writeChild(
    tx: Prisma.TransactionClient,
    args: {
      familyId: string;
      input: CreateChildRequest | UpdateChildRequest;
      actor: ResolvedSession;
      context: RequestContext;
      mode: 'create' | 'update';
      before?: ChildFullRow;
      acknowledged?: Set<string>;
    },
  ): Promise<ChildWriteOutcome> {
    const { familyId, input, actor, context, mode, before, acknowledged } = args;

    const identityChanged =
      before === undefined ||
      before.first_name !== input.firstName ||
      before.last_name !== input.lastName ||
      before.birth_date !== input.birthDate;

    let candidates: DuplicateCandidate[] = [];

    if (identityChanged) {
      await acquireChildIdentityLock(tx, {
        familyId,
        firstName: input.firstName,
        lastName: input.lastName,
        birthDate: input.birthDate,
        excludeChildId: before?.id ?? null,
      });

      candidates = await findChildDuplicateCandidates(tx, {
        familyId,
        firstName: input.firstName,
        lastName: input.lastName,
        birthDate: input.birthDate,
        excludeChildId: before?.id ?? null,
      });

      const blocking = blockingCandidates(candidates);
      const unacknowledged =
        acknowledged === undefined
          ? blocking
          : blocking.filter((candidate) => !acknowledged.has(acknowledgementId(candidate)));

      if (unacknowledged.length > 0) return { kind: 'blocked', candidates };
    }

    const childId = before?.id ?? uuidv7();

    try {
      await this.persist(tx, childId, familyId, input, actor, mode);
    } catch (error) {
      // Matched rather than pre-checked. A SELECT-then-INSERT would let two
      // concurrent requests both pass the check and both proceed; the partial
      // unique index is the authority, and catching its error is what makes the
      // rule hold under concurrency.
      //
      // Both are hard uniqueness with no override: a national identifier names
      // exactly one person, and one paper file belongs to one child.
      //
      // Both the index name and the `Key (column)=` form are matched. A
      // violation raised through the query builder names the index; one raised
      // from raw SQL arrives as SQLSTATE 23505 with PostgreSQL's own detail
      // message, which names the column instead. Checking one form only works
      // until somebody changes how the statement is issued.
      if (isUniqueViolation(error)) {
        if (
          violatesConstraint(error, 'child_national_id_uq') ||
          violatesConstraint(error, '(national_id)')
        ) {
          throw new AppError('CHILD_NATIONAL_ID_TAKEN');
        }
        if (
          violatesConstraint(error, 'child_legacy_paper_file_number_uq') ||
          violatesConstraint(error, '(legacy_paper_file_number)')
        ) {
          throw new AppError('CHILD_LEGACY_FILE_NUMBER_TAKEN');
        }
      }
      throw error;
    }

    const after = await this.readChild(tx, childId);

    await this.audit.record(tx, actorContext(actor, context), {
      action: mode === 'create' ? 'child.created' : 'child.updated',
      entityType: 'child',
      entityId: childId,
      ...(before === undefined ? {} : { before: auditSafeChild(toAuditInput(before)) }),
      after: auditSafeChild(toAuditInput(after)),
    });

    const overridden = blockingCandidates(candidates);
    if (acknowledged !== undefined && overridden.length > 0) {
      await this.audit.record(tx, actorContext(actor, context), {
        action: 'child.duplicate_override',
        entityType: 'child',
        entityId: childId,
        metadata: auditSafeDuplicateOverride({
          acknowledgedIds: overridden.map(acknowledgementId),
          rules: overridden.map((candidate) => candidate.rule),
        }),
      });
    }

    return {
      kind: 'written',
      childId,
      warnings: nonBlockingNotices(candidates, 'SIMILAR_CHILD_EXISTS'),
    };
  }

  /** The INSERT and the UPDATE, kept together so their column lists cannot drift. */
  private async persist(
    tx: Prisma.TransactionClient,
    childId: string,
    familyId: string,
    input: CreateChildRequest | UpdateChildRequest,
    actor: ResolvedSession,
    mode: 'create' | 'update',
  ): Promise<void> {
    if (mode === 'create') {
      await tx.$executeRaw`
        INSERT INTO child (
          id, family_id, first_name, last_name, search_first_name, search_last_name,
          birth_date, file_number, legacy_paper_file_number, national_id, sex,
          referral_source, note, status, deactivated_at, created_at, created_by_user_id
        ) VALUES (
          ${childId}::uuid, ${familyId}::uuid,
          ${input.firstName}, ${input.lastName},
          fa_normalize(${input.firstName}), fa_normalize(${input.lastName}),
          ${input.birthDate}::date,
          -- Never typed, never chosen. Zero-padded so a number read aloud over
          -- the phone has a stable shape.
          lpad(nextval('child_file_number_seq')::text, 5, '0'),
          ${input.legacyPaperFileNumber}, ${input.nationalId},
          ${input.sex}::child_sex, ${input.referralSource}, ${input.note},
          'ACTIVE'::record_status, NULL, transaction_timestamp(), ${actor.userId}::uuid
        )
      `;
    } else {
      await tx.$executeRaw`
        UPDATE child SET
          first_name = ${input.firstName},
          last_name = ${input.lastName},
          search_first_name = fa_normalize(${input.firstName}),
          search_last_name = fa_normalize(${input.lastName}),
          birth_date = ${input.birthDate}::date,
          legacy_paper_file_number = ${input.legacyPaperFileNumber},
          national_id = ${input.nationalId},
          sex = ${input.sex}::child_sex,
          referral_source = ${input.referralSource},
          note = ${input.note}
        WHERE id = ${childId}::uuid
      `;
    }
  }

  // --- guards ---------------------------------------------------------------

  /**
   * A child may only be registered under a family that is still active.
   *
   * `FOR SHARE` conflicts with the `UPDATE` a deactivation performs, so a
   * registration racing a deactivation resolves one way or the other rather than
   * both appearing to succeed.
   */
  private async assertFamilyWritable(
    tx: Prisma.TransactionClient,
    familyId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ status: RecordStatus }[]>`
      SELECT status::text AS status FROM family WHERE id = ${familyId}::uuid FOR SHARE
    `;

    const status = rows[0]?.status;
    if (status === undefined) throw new AppError('FAMILY_NOT_FOUND');
    if (status !== 'ACTIVE') throw new AppError('FAMILY_INACTIVE');
  }

  /**
   * "Not after today" measured in the clinic's own calendar day.
   *
   * `clinic_date()` is Asia/Tehran and lives in PostgreSQL, so the answer does
   * not depend on the session timezone, the Node process timezone or UTC. Tehran
   * rolls over at 20:30 UTC, which is long enough for a date entered in the
   * evening to be wrongly refused by any of the other three.
   */
  private async assertBirthDateNotFuture(
    tx: Prisma.TransactionClient,
    birthDate: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ future: boolean }[]>`
      SELECT ${birthDate}::date > clinic_date() AS future
    `;

    if (rows[0]?.future === true) throw new AppError('CHILD_BIRTH_DATE_IN_FUTURE');
  }

  // --- reads ----------------------------------------------------------------

  private async readChild(
    client: Prisma.TransactionClient | PrismaService,
    id: string,
  ): Promise<ChildFullRow> {
    const rows = await client.$queryRaw<ChildFullRow[]>`
      SELECT ${CHILD_FULL_COLUMNS} FROM child c WHERE c.id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('CHILD_NOT_FOUND');
    return row;
  }

  private async lockChild(tx: Prisma.TransactionClient, id: string): Promise<ChildFullRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM child WHERE id = ${id}::uuid FOR UPDATE
    `;

    if (locked[0] === undefined) throw new AppError('CHILD_NOT_FOUND');

    return this.readChild(tx, id);
  }

  private async readFamily(
    client: Prisma.TransactionClient | PrismaService,
    id: string,
  ): Promise<FamilyRow> {
    const rows = await client.$queryRaw<FamilyRow[]>`
      SELECT ${FAMILY_COLUMNS} FROM family f WHERE f.id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('FAMILY_NOT_FOUND');
    return row;
  }

  private readSiblings(
    client: Prisma.TransactionClient | PrismaService,
    familyId: string,
    excludeChildId: string,
  ): Promise<ChildRow[]> {
    return client.$queryRaw<ChildRow[]>`
      SELECT ${CHILD_COLUMNS} FROM child c
      WHERE c.family_id = ${familyId}::uuid AND c.id <> ${excludeChildId}::uuid
    `;
  }

  private async respond(childId: string, warnings: NoticeCode[]): Promise<ChildWriteResponse> {
    return { ...(await this.get(childId)), nonBlockingWarnings: warnings };
  }

  /**
   * Turns a blocking duplicate into the approved 409, holding the payload in a
   * draft so nobody has to type it again.
   */
  private async refuse(
    candidates: readonly DuplicateCandidate[],
    purpose: 'CHILD_CREATE' | 'CHILD_UPDATE',
    payload: CreateChildRequest | UpdateChildRequest,
    actor: ResolvedSession,
    target: { targetFamilyId: string; targetChildId: string | null },
  ): Promise<never> {
    const draft = await this.drafts.createDraft({
      purpose,
      payload,
      shownCandidateIds: blockingCandidateIds(candidates),
      actor,
      ...target,
    });

    throw new AppError('CHILD_POSSIBLE_DUPLICATE', {
      candidates,
      draftToken: draft.token,
      draftExpiresAt: draft.expiresAt,
    });
  }
}

/** Signals a rollback from inside the confirmation transaction. */
class RepeatBlock extends Error {
  constructor(readonly candidates: DuplicateCandidate[]) {
    super('A fresh blocking duplicate appeared during confirmation');
    this.name = 'RepeatBlock';
  }
}

function toAuditInput(row: ChildFullRow) {
  return {
    familyId: row.family_id,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date,
    fileNumber: row.file_number,
    legacyPaperFileNumber: row.legacy_paper_file_number,
    nationalId: row.national_id,
    sex: row.sex,
    referralSource: row.referral_source,
    note: row.note,
    status: row.status,
  };
}
