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
