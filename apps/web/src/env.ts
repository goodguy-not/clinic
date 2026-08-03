import { z } from 'zod';

/**
 * Server-side environment for the web application.
 *
 * This schema deliberately declares no database connection string. The web
 * application has no database access at all — NestJS owns PostgreSQL
 * (CLAUDE.md, Architecture boundary). Because the variable is never declared
 * here, a stray query in this app cannot even find something to connect with.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_BASE_URL: z
    .string()
    .min(1, 'is required')
    .refine(
      (value) => value.startsWith('http://') || value.startsWith('https://'),
      'must be an http:// or https:// URL',
    ),
});

export type WebServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Validates the environment and fails fast with a readable report.
 * Names the offending variables but never echoes their values.
 */
export function loadServerEnv(
  source: Record<string, string | undefined> = process.env,
): WebServerEnv {
  const result = serverEnvSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid web environment configuration:\n${issues}`);
  }

  return result.data;
}
