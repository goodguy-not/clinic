import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Loads the repository-root `.env` when present. Development convenience only —
 * production supplies real environment variables and never reads a committed file.
 *
 * Tries the current working directory first (running from the repository root),
 * then two levels up (running from `apps/api`).
 */
export function loadDotEnvIfPresent(cwd: string = process.cwd()): void {
  for (const candidate of [resolve(cwd, '.env'), resolve(cwd, '..', '..', '.env')]) {
    try {
      process.loadEnvFile(candidate);
      return;
    } catch {
      // Not present or unreadable; fall through to the real environment.
    }
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z
    .string()
    .min(1, 'is required')
    .refine(
      (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
      'must be a postgresql:// connection string',
    ),
  /**
   * The shared secret proving a request came from the Next.js server.
   *
   * Required with no default: a default would be a published credential, and an
   * absent one must stop the process rather than silently disable the check.
   * 32 characters is the floor for a value that is compared, not guessed.
   */
  INTERNAL_API_KEY: z.string().min(32, 'must be at least 32 characters'),
  /**
   * Owner-supplied clinic terms a password may not contain — clinic name, brand
   * words, domain. Environmental rather than committed, because these are
   * clinic-identifying strings that must not enter the repository. Unset means
   * an empty list, which is the correct state before the owner supplies them.
   */
  PASSWORD_BLOCKED_TERMS: z.string().optional(),
  /**
   * The directory the API owns and stores uploaded media under.
   *
   * Milestone 9.5, checkpoint A5. REQUIRED, WITH NO DEFAULT, and the reason is
   * not the reason `INTERNAL_API_KEY` has none. A default here would not be a
   * published credential — it would be a plausible-looking relative path, which
   * is worse in a different way: a misconfigured deployment would start
   * successfully and quietly write families' and colleagues' photographs into
   * whatever directory the process happened to be launched from, most likely
   * inside a git working tree, and nobody would find out until somebody
   * committed them. An absent value must stop the process.
   *
   * It is a PERSISTENT DISK PATH, and this is the frozen owner decision for the
   * pilot: NestJS owns the bytes. Not PostgreSQL — image data in a relational
   * database bloats every backup and every replica for no query anybody makes —
   * and not object storage, which is a dependency, a credential and a second
   * failure domain the clinic does not have yet.
   */
  MEDIA_STORAGE_DIR: z.string().min(1, 'is required'),
});

export type ApiEnv = z.infer<typeof envSchema>;

/**
 * Validates the environment and fails fast with a readable report.
 *
 * The error names the offending variables but never echoes their values, so an
 * invalid DATABASE_URL cannot leak credentials into logs or CI output.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid API environment configuration:\n${issues}`);
  }

  return result.data;
}
