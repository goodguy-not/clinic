import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { CreateFamilyRequest } from '@clinic/contracts';
import type { ResolvedSession } from '../../common/request-context';
import { uuidv7 } from '../../common/uuid';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Registration drafts: what somebody typed, held while they decide whether the
 * family they are registering already exists.
 *
 * CHECKPOINT C SCOPE. Only creation is implemented, and only for
 * `FAMILY_CREATE`. Resolving, confirming, consuming and discarding a draft are
 * Checkpoint D, and there is deliberately no controller here yet — a draft is
 * currently reachable only as a side effect of a blocked family creation, which
 * is the one path that needs it.
 *
 * A draft is TRANSIENT WORKFLOW STATE, not a domain record:
 *
 *  - it is never audited. Auditing one would create a permanent record of a
 *    submission that was never made;
 *  - it carries no no-delete or no-truncate trigger, because deletion is how it
 *    is meant to end;
 *  - its payload and its token are never logged.
 *
 * The browser receives the token once, so a Route Handler can put it in an
 * HttpOnly cookie. Only the SHA-256 hash is stored, exactly as `user_session`
 * does, so a leaked backup or query log yields nothing replayable.
 */
@Injectable()
export class RegistrationDraftsService {
  constructor(private readonly prisma: PrismaService) {}

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
    const tokenHash = createHash('sha256').update(token).digest();

    const rows = await this.prisma.$transaction(async (tx) => {
      // Opportunistic sweep. Expiry is bounded work done by whoever happens to
      // be creating a draft, which keeps the table small without a scheduled
      // job to deploy, monitor and forget about.
      await tx.$executeRaw`
        DELETE FROM registration_draft WHERE expires_at < clock_timestamp()
      `;

      return tx.$queryRaw<{ expires_at: Date }[]>`
        INSERT INTO registration_draft (
          id, token_hash, purpose, created_by_user_id, session_id, payload,
          shown_candidate_ids, target_family_id, target_child_id, created_at, expires_at
        ) VALUES (
          ${uuidv7()}::uuid,
          ${tokenHash},
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
          transaction_timestamp() + interval '10 minutes'
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
}
