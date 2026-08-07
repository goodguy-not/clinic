import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  createFamilyRequestSchema,
  type CreateFamilyRequest,
  type DraftPurpose,
  type RegistrationDraftResponse,
} from '@clinic/contracts';
import { AppError } from '../../common/app-error';
import type { ResolvedSession } from '../../common/request-context';
import { uuidv7 } from '../../common/uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { blockingRuleFor, describeShownCandidates } from '../duplicate-detection';

/**
 * Registration drafts: what somebody typed, held while they decide whether the
 * family they are registering already exists.
 *
 * A duplicate is only detectable after a submission, and a Route Handler cannot
 * render a page, so something has to hold the typed values across the
 * confirmation step. That something is a row here rather than a cookie: a signed
 * cookie gives integrity, not confidentiality, and a family with an address, a
 * note and several guardians can exceed practical cookie size limits — failing
 * intermittently, and only for the largest records.
 *
 * A draft is TRANSIENT WORKFLOW STATE, not a domain record:
 *
 *  - it is never audited. Auditing one would create a permanent record of a
 *    submission that was never made;
 *  - it carries no no-delete or no-truncate trigger, because deletion is how it
 *    is meant to end;
 *  - its payload and its token are never logged.
 *
 * ONE ANSWER FOR EVERY FAILURE. Missing, expired, already consumed, wrong user,
 * wrong session and wrong purpose all produce `DRAFT_NOT_FOUND`. A draft token
 * is a bearer credential, and distinguishing those conditions would tell its
 * holder which one they tripped — the same reasoning that makes
 * `AUTH_INVALID_CREDENTIALS` cover four different login failures.
 *
 * CHECKPOINT D SCOPE. The lifecycle below is generic across every
 * `DraftPurpose`, but only `FAMILY_CREATE` has a confirmation route, because
 * only family creation has a domain operation to confirm. The update and child
 * routes arrive with the mutations they would perform.
 */

/** How long somebody has to decide. Measured by PostgreSQL, never by Node. */
const DRAFT_TTL = Prisma.sql`interval '10 minutes'`;

type DraftRow = {
  id: string;
  purpose: DraftPurpose;
  created_by_user_id: string;
  session_id: string;
  payload: unknown;
  shown_candidate_ids: string[];
  target_family_id: string | null;
  target_child_id: string | null;
  expires_at: Date;
};

const DRAFT_COLUMNS = Prisma.sql`
  d.id, d.purpose::text AS purpose, d.created_by_user_id, d.session_id, d.payload,
  d.shown_candidate_ids, d.target_family_id, d.target_child_id, d.expires_at
`;

@Injectable()
export class RegistrationDraftsService {
  constructor(private readonly prisma: PrismaService) {}

  // --- creation -------------------------------------------------------------

  /**
   * Creates the draft for a blocked family creation, replacing any the same
   * person already holds in the same session for the same purpose.
   *
   * Called only AFTER the detection transaction has committed. A draft is never
   * written in the same transaction as a domain insert: the whole point is that
   * it survives a write that did not happen.
   *
   * Replacement is one `INSERT … ON CONFLICT DO UPDATE`, not a delete followed
   * by an insert. Atomic, so two submissions racing each other cannot leave the
   * row missing in between, and the previous token stops working the instant
   * this commits because its hash is gone.
   *
   * The uniqueness key is (user, SESSION, purpose) rather than (user, purpose):
   * somebody working in two browsers holds two independent drafts, and starting
   * one must not silently destroy the other.
   */
  async createFamilyCreateDraft(input: {
    payload: CreateFamilyRequest;
    shownCandidateIds: readonly string[];
    actor: ResolvedSession;
  }): Promise<{ token: string; expiresAt: string }> {
    // 32 bytes from the system CSPRNG, base64url so it survives a cookie and a
    // header without encoding. The value exists in memory and in the response
    // exactly once.
    const token = randomBytes(32).toString('base64url');

    const rows = await this.prisma.$transaction(async (tx) => {
      await this.sweepExpired(tx);

      return tx.$queryRaw<{ expires_at: Date }[]>`
        INSERT INTO registration_draft (
          id, token_hash, purpose, created_by_user_id, session_id, payload,
          shown_candidate_ids, target_family_id, target_child_id, created_at, expires_at
        ) VALUES (
          ${uuidv7()}::uuid,
          ${hashToken(token)},
          'FAMILY_CREATE'::draft_purpose,
          ${input.actor.userId}::uuid,
          ${input.actor.sessionId}::uuid,
          ${JSON.stringify(input.payload)}::jsonb,
          ${[...input.shownCandidateIds]}::uuid[],
          NULL,
          NULL,
          transaction_timestamp(),
          -- Both timestamps from the same PostgreSQL transaction clock, so they
          -- can never disagree and no JavaScript clock is involved.
          transaction_timestamp() + ${DRAFT_TTL}
        )
        ON CONFLICT (created_by_user_id, session_id, purpose) DO UPDATE SET
          token_hash          = EXCLUDED.token_hash,
          payload             = EXCLUDED.payload,
          shown_candidate_ids = EXCLUDED.shown_candidate_ids,
          target_family_id    = EXCLUDED.target_family_id,
          target_child_id     = EXCLUDED.target_child_id,
          created_at          = EXCLUDED.created_at,
          expires_at          = EXCLUDED.expires_at
        RETURNING expires_at
      `;
    });

    const expiresAt = rows[0]?.expires_at;
    if (expiresAt === undefined) {
      // Unreachable: the upsert always returns its row. Stated so a future
      // change to the statement cannot silently produce a draft with no expiry.
      throw new Error('Registration draft upsert returned no row');
    }

    return { token, expiresAt: expiresAt.toISOString() };
  }

  // --- reading --------------------------------------------------------------

  /**
   * Resolves a draft for the confirmation screen WITHOUT consuming it.
   *
   * The candidates come from the STORED `shown_candidate_ids` — the set the
   * blocking flow last presented — and not from a fresh detection pass.
   *
   * That distinction is the whole point. Authoritative duplicate detection
   * belongs to the confirm transaction, where it runs under the advisory locks
   * and its answer is acted upon. Re-running it here, merely because somebody
   * opened or refreshed the confirmation page, would mean the list changes
   * underneath them between one look and the next, and the acknowledgement they
   * eventually send would describe a list that no longer exists.
   *
   * So this method is deliberately not a detector. A family registered since the
   * block does not appear here; it is discovered by the confirm transaction,
   * which refuses, re-arms the draft with the fresh set, and returns the same
   * token. A subsequent call to this method then shows that refreshed set,
   * because it too comes from the stored ids.
   */
  async resolve(token: string, actor: ResolvedSession): Promise<RegistrationDraftResponse> {
    await this.sweepExpired();

    const draft = await this.findValid(this.prisma, token, actor);
    const payload = parseFamilyCreatePayload(draft);

    // The stored ids are the blocking candidates and nothing else, so the rule
    // follows from the draft's purpose. Nothing about a candidate's current data
    // can relabel it: a family whose mobile was edited after the block is still
    // presented as the blocking duplicate somebody was shown.
    const candidates = await describeShownCandidates(
      this.prisma,
      draft.shown_candidate_ids,
      blockingRuleFor(draft.purpose),
    );

    return {
      purpose: draft.purpose,
      expiresAt: draft.expires_at.toISOString(),
      targetFamilyId: draft.target_family_id,
      targetChildId: draft.target_child_id,
      family: payload,
      child: null,
      candidates,
    };
  }

  // --- terminal actions -----------------------------------------------------

  /**
   * Throws the draft away.
   *
   * Locks the row before deleting it, so a discard and a confirmation racing
   * each other serialise on the same row and exactly one of them is the terminal
   * action. The loser re-reads, finds nothing, and answers `DRAFT_NOT_FOUND`.
   *
   * Not audited. A draft is a submission that was never made, and recording that
   * somebody abandoned one would be a permanent trace of something that did not
   * happen.
   */
  async discard(token: string, actor: ResolvedSession): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const draft = await this.lockForConsumption(tx, token, actor);
      await this.consume(tx, draft.id);
    });
  }

  /**
   * Takes the row lock and validates every binding, for a caller that is about
   * to consume the draft inside its own transaction.
   *
   * `FOR UPDATE` is what makes one-time consumption real: two confirmations of
   * the same token both reach this statement, the second waits, and when it
   * proceeds the row is gone.
   *
   * This is the FIRST lock in the canonical order — `registration_draft` →
   * `family` → `child` → advisory keys — so a caller must not have taken a
   * domain row lock before calling it.
   */
  async lockForConsumption(
    tx: Prisma.TransactionClient,
    token: string,
    actor: ResolvedSession,
    purpose?: DraftPurpose,
  ): Promise<DraftRow> {
    const hash = hashToken(token);
    if (hash === null) throw new AppError('DRAFT_NOT_FOUND');

    const rows = await tx.$queryRaw<DraftRow[]>`
      SELECT ${DRAFT_COLUMNS} FROM registration_draft d
      WHERE d.token_hash = ${hash}
        AND d.expires_at > clock_timestamp()
      FOR UPDATE
    `;

    return this.assertUsable(rows[0], actor, purpose);
  }

  /** Deletes the row. Physical removal is how a draft ends. */
  async consume(tx: Prisma.TransactionClient, draftId: string): Promise<void> {
    await tx.$executeRaw`DELETE FROM registration_draft WHERE id = ${draftId}::uuid`;
  }

  /**
   * Re-arms a draft whose confirmation was refused because a NEW duplicate
   * appeared.
   *
   * The confirmation transaction rolled back, which un-deleted the row, so this
   * runs afterwards in its own transaction and only updates the two fields that
   * describe the current situation. The token hash is deliberately untouched:
   * the caller already holds a valid token, and minting a second one would mean
   * two live credentials for one draft and a cookie somewhere holding the wrong
   * one.
   */
  async refreshAfterRepeatBlock(
    token: string,
    actor: ResolvedSession,
    candidateIds: readonly string[],
  ): Promise<string> {
    const hash = hashToken(token);
    if (hash === null) throw new AppError('DRAFT_NOT_FOUND');

    const rows = await this.prisma.$queryRaw<{ expires_at: Date }[]>`
      UPDATE registration_draft SET
        shown_candidate_ids = ${[...candidateIds]}::uuid[],
        expires_at          = transaction_timestamp() + ${DRAFT_TTL}
      WHERE token_hash = ${hash}
        AND created_by_user_id = ${actor.userId}::uuid
        AND session_id = ${actor.sessionId}::uuid
      RETURNING expires_at
    `;

    const expiresAt = rows[0]?.expires_at;
    if (expiresAt === undefined) throw new AppError('DRAFT_NOT_FOUND');

    return expiresAt.toISOString();
  }

  // --- internals ------------------------------------------------------------

  /**
   * Removes drafts that are past their expiry.
   *
   * Bounded work, done by whoever happens to be creating or resolving one,
   * which keeps the table small without a scheduled job to deploy, monitor and
   * forget about. `clock_timestamp()` rather than `transaction_timestamp()`
   * because this is a liveness question, not a question about the instant this
   * transaction represents.
   */
  private async sweepExpired(tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;

    await client.$executeRaw`
      DELETE FROM registration_draft WHERE expires_at < clock_timestamp()
    `;
  }

  private async findValid(
    client: Prisma.TransactionClient | PrismaService,
    token: string,
    actor: ResolvedSession,
    purpose?: DraftPurpose,
  ): Promise<DraftRow> {
    const hash = hashToken(token);
    if (hash === null) throw new AppError('DRAFT_NOT_FOUND');

    const rows = await client.$queryRaw<DraftRow[]>`
      SELECT ${DRAFT_COLUMNS} FROM registration_draft d
      WHERE d.token_hash = ${hash}
        AND d.expires_at > clock_timestamp()
    `;

    return this.assertUsable(rows[0], actor, purpose);
  }

  /**
   * Every reason a draft cannot be used, answered identically.
   *
   * EXPIRY IS NOT CHECKED HERE. Both lookups filter on
   * `expires_at > clock_timestamp()`, so a lapsed draft simply does not come
   * back and arrives at this method as `undefined`. That keeps PostgreSQL the
   * only clock in the decision: `expires_at` was written by the transaction
   * clock, and comparing it against `Date.now()` would introduce a second clock
   * and with it whatever skew exists between the Node host and the database.
   *
   * The user and session comparisons are constant-time for the same reason the
   * token is looked up by hash: these values decide who may act on a credential.
   */
  private assertUsable(
    row: DraftRow | undefined,
    actor: ResolvedSession,
    purpose?: DraftPurpose,
  ): DraftRow {
    if (row === undefined) throw new AppError('DRAFT_NOT_FOUND');

    if (!equalIds(row.created_by_user_id, actor.userId)) throw new AppError('DRAFT_NOT_FOUND');
    if (!equalIds(row.session_id, actor.sessionId)) throw new AppError('DRAFT_NOT_FOUND');
    if (purpose !== undefined && row.purpose !== purpose) throw new AppError('DRAFT_NOT_FOUND');

    return row;
  }
}

/** SHA-256, exactly as `user_session` hashes its own bearer token. */
function hashToken(token: string): Buffer | null {
  if (token === '') return null;

  return createHash('sha256').update(token).digest();
}

/** Constant-time comparison of two identifiers of equal expected length. */
function equalIds(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);

  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/**
 * Re-validates the stored payload against the CURRENT shared contract.
 *
 * A draft can outlive a deployment. If the contract has tightened since the row
 * was written — a new required field, a stricter phone shape — the stored
 * payload is no longer something this system is willing to insert, and the
 * honest answer is that the draft is unusable. `DRAFT_NOT_FOUND` rather than a
 * validation error, because from the caller's point of view it is the same
 * situation as an expired one: type it again.
 */
function parseFamilyCreatePayload(draft: DraftRow): CreateFamilyRequest {
  if (draft.purpose !== 'FAMILY_CREATE') throw new AppError('DRAFT_NOT_FOUND');

  const parsed = createFamilyRequestSchema.safeParse(draft.payload);
  if (!parsed.success) throw new AppError('DRAFT_NOT_FOUND');

  return parsed.data;
}

export { parseFamilyCreatePayload };
