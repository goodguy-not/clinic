import { z } from 'zod';

/**
 * Server-side environment for the web application.
 *
 * This schema deliberately declares no database connection string. The web
 * application has no database access at all — NestJS owns PostgreSQL
 * (CLAUDE.md, Architecture boundary). Because the variable is never declared
 * here, a stray query in this app cannot even find something to connect with.
 *
 * Nothing here is exposed through `NEXT_PUBLIC_*`. Every value below is a
 * secret or a security decision, and a `NEXT_PUBLIC_` prefix would inline it
 * into the browser bundle; `scripts/check-web-boundary.mjs` fails the build if
 * one ever appears.
 */

const httpUrl = (value: string): boolean =>
  value.startsWith('http://') || value.startsWith('https://');

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    /**
     * Whether this deployment is the real one. Required, with no default.
     *
     * Deliberately independent of `NODE_ENV`. A production *build* run over
     * plain HTTP on a LAN for testing is still a non-production *deployment*,
     * and `next start` forces `NODE_ENV=production` regardless. Tying cookie
     * security to `NODE_ENV` would either break that case or, worse, invite an
     * override flag that eventually gets set on a real server. Having no
     * default means forgetting it stops the process instead of silently
     * choosing the weaker option.
     */
    DEPLOYMENT_MODE: z.enum(['production', 'non-production']),

    API_BASE_URL: z
      .string()
      .min(1, 'is required')
      .refine(httpUrl, 'must be an http:// or https:// URL'),

    /** Shared secret proving a request reached NestJS through this server. */
    INTERNAL_API_KEY: z.string().min(32, 'must be at least 32 characters'),

    /** HMAC key for the session and CSRF cookie signatures. */
    SESSION_COOKIE_SECRET: z.string().min(32, 'must be at least 32 characters'),

    /**
     * Exact origins accepted on state-changing requests. Comma-separated.
     * Matching is exact — no suffix rules, no wildcards.
     */
    WEB_ALLOWED_ORIGINS: z.string().min(1, 'is required'),
  })
  .superRefine((env, ctx) => {
    const origins = parseAllowedOrigins(env.WEB_ALLOWED_ORIGINS);

    if (origins.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_ALLOWED_ORIGINS'],
        message: 'must list at least one origin',
      });
      return;
    }

    for (const origin of origins) {
      let parsed: URL;

      try {
        parsed = new URL(origin);
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['WEB_ALLOWED_ORIGINS'],
          message: `contains a value that is not a valid origin: ${origin}`,
        });
        continue;
      }

      // An origin is scheme + host + port and nothing else; a path or query
      // would never match a browser's Origin header and is a sign of a
      // misconfiguration worth failing on.
      if (parsed.origin !== origin) {
        ctx.addIssue({
          code: 'custom',
          path: ['WEB_ALLOWED_ORIGINS'],
          message: `must contain bare origins only, received: ${origin}`,
        });
        continue;
      }

      if (env.DEPLOYMENT_MODE === 'production' && parsed.protocol !== 'https:') {
        ctx.addIssue({
          code: 'custom',
          path: ['WEB_ALLOWED_ORIGINS'],
          message: `must use https in a production deployment, received: ${origin}`,
        });
      }
    }
  });

export type WebServerEnv = z.infer<typeof serverEnvSchema>;

export function parseAllowedOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/**
 * Validates the environment and fails fast with a readable report.
 * Names the offending variables but never echoes their values, so a malformed
 * secret cannot leak into a build log.
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

/** Convenience for code that only needs the origin allowlist. */
export function allowedOrigins(env: WebServerEnv): readonly string[] {
  return parseAllowedOrigins(env.WEB_ALLOWED_ORIGINS);
}
