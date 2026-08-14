import 'server-only';
import type { CallerContext } from '@/server/api-client';
import { api } from '@/server/api-client';
import type { ParticipantChargeLookup } from '@/ledger/appointment-charge';

/**
 * Adapts the frozen participant-scoped read into an explicit three-way value:
 * detail, confirmed absence, or unavailable read. The Nest URL remains isolated
 * in api-client.ts.
 */
export async function loadParticipantCharges(
  participantIds: readonly string[],
  context: CallerContext,
): Promise<ParticipantChargeLookup> {
  const uniqueIds = [...new Set(participantIds)];
  const reads = await Promise.all(
    uniqueIds.map(async (participantId) => {
      const result = await api.getParticipantSessionCharge(participantId, context);
      if (result.ok) return [participantId, result.data] as const;
      if (result.code === 'CHARGE_NOT_FOUND') return [participantId, null] as const;
      return [participantId, undefined] as const;
    }),
  );

  return Object.fromEntries(reads);
}
