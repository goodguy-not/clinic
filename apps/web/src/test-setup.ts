/**
 * Synthetic, process-scoped environment for the web test suite.
 *
 * Nothing here is a real credential and nothing is read from the developer's
 * `.env.local`, which the tests must neither require nor modify.
 */
process.env['DEPLOYMENT_MODE'] ??= 'non-production';
process.env['API_BASE_URL'] ??= 'http://localhost:3001';
process.env['INTERNAL_API_KEY'] ??= 'synthetic_test_internal_key_0123456789ab';
process.env['SESSION_COOKIE_SECRET'] ??= 'synthetic_test_cookie_secret_0123456789ab';
process.env['WEB_ALLOWED_ORIGINS'] ??= 'http://localhost:3000';
