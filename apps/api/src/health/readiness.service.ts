import { Injectable, Logger } from '@nestjs/common';
import { describeError } from '../common/describe-error';
import { MediaStorageService } from '../media/media-storage.service';
import { PrismaService } from '../prisma/prisma.service';

export type CheckState = 'ok' | 'unavailable';

export type ReadinessResponse = {
  status: 'ok' | 'unavailable';
  checks: { database: CheckState; media: CheckState };
};

/** A database that does not answer within this is unavailable, not slow. */
const DATABASE_TIMEOUT_MS = 2_000;

/**
 * How long one answer is reused. Readiness is anonymous, so the work it does —
 * one query, one small write — must not be something a caller can multiply.
 * Concurrent probes share one check, and a result is reused this long.
 */
const CACHE_MS = 2_000;

/**
 * Milestone 10, checkpoint A3 — can this API serve the clinic right now?
 *
 * Three facts: the process answers (it is answering this), PostgreSQL answers a
 * query, and the media directory exists and takes a write. The deployment and
 * restore runbooks read it; so can a monitor, with no credential.
 *
 * IT REVEALS NOTHING BUT TWO WORDS PER CHECK. No latency, no version, no path,
 * no error text: the failure's KIND goes to the server log (once per change of
 * state, so a monitor polling a broken server does not fill the journal), and
 * the caller learns only which check is down.
 */
@Injectable()
export class ReadinessService {
  private readonly logger = new Logger(ReadinessService.name);
  private cached: { at: number; result: Promise<ReadinessResponse> } | null = null;
  private lastStates: ReadinessResponse['checks'] = { database: 'ok', media: 'ok' };

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorageService,
  ) {}

  check(): Promise<ReadinessResponse> {
    const now = Date.now();
    if (this.cached !== null && now - this.cached.at < CACHE_MS) return this.cached.result;

    const result = this.run();
    this.cached = { at: now, result };
    return result;
  }

  private async run(): Promise<ReadinessResponse> {
    const [database, media] = await Promise.all([
      this.probe('database', () =>
        withTimeout(this.prisma.$queryRaw`SELECT 1`, DATABASE_TIMEOUT_MS),
      ),
      this.probe('media', () => this.storage.probeWritable()),
    ]);

    return {
      status: database === 'ok' && media === 'ok' ? 'ok' : 'unavailable',
      checks: { database, media },
    };
  }

  private async probe(
    name: keyof ReadinessResponse['checks'],
    work: () => Promise<unknown>,
  ): Promise<CheckState> {
    let state: CheckState;
    let failure: unknown;

    try {
      await work();
      state = 'ok';
    } catch (error) {
      state = 'unavailable';
      failure = error;
    }

    if (state !== this.lastStates[name]) {
      if (state === 'unavailable') {
        this.logger.error(`readiness: ${name} unavailable: ${describeError(failure)}`);
      } else {
        this.logger.log(`readiness: ${name} available again`);
      }
      this.lastStates = { ...this.lastStates, [name]: state };
    }

    return state;
  }
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
