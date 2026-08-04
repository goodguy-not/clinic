/**
 * Stand-in for the `server-only` package inside the test runner.
 *
 * `server-only` throws on import outside a React Server Component, which is
 * exactly the guarantee it exists to provide: importing a module marked with it
 * from a Client Component is a build error, so the internal key and session
 * token cannot reach the browser.
 *
 * Vitest runs in plain Node, where that guard has nothing to check and only
 * blocks the tests. Aliasing it here keeps the real import in the source — the
 * production build still enforces it — while letting the server modules be
 * unit-tested directly.
 */
export {};
