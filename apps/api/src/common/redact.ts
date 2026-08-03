/**
 * Masks credentials in connection strings that appear inside arbitrary text.
 *
 * Driver errors frequently embed the connection URL in their message or stack,
 * so any text derived from an error must be passed through this function before
 * being logged (PROJECT_SPEC.md §13, "no sensitive logs").
 *
 * This is a helper, not an interceptor: it is applied at each call site that
 * logs error text — currently the bootstrap failure path in `main.ts` and the
 * database health check. It does NOT automatically cover every log in the
 * application. A future global logging interceptor should route error output
 * through here so the guarantee becomes structural rather than by convention.
 */
const CONNECTION_STRING_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/[^:@\s/]+:)[^@\s]+(@)/gi;

export function redactSecrets(text: string): string {
  return text.replace(CONNECTION_STRING_CREDENTIALS, '$1***$2');
}
