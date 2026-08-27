/**
 * Shared contracts between the NestJS API and the Next.js web application.
 *
 * This package contains schemas, the types inferred from them, and constants.
 * It contains no functions, no HTTP client, no mapping tables, no Persian text,
 * and no database access of any kind — `scripts/check-web-boundary.mjs`
 * enforces the last two mechanically.
 *
 * Response schemas are strict. An accidental extra field in a NestJS response —
 * a serialised `passwordHash` being the case that matters — fails a test
 * instead of reaching a browser.
 */
export * from './errors';
export * from './permissions';
export * from './roles';
export * from './users';
export * from './auth';
export * from './dates';
export * from './money';
export * from './catalog/common';
export * from './catalog/therapists';
export * from './catalog/services';
export * from './catalog/rooms';
export * from './catalog/tariffs';
export * from './families/common';
export * from './families/families';
export * from './families/children';
export * from './families/drafts';
export * from './appointments/common';
export * from './appointments/appointments';
export * from './appointments/availability';
export * from './appointments/booking';
export * from './appointments/lifecycle';
export * from './appointments/day';
export * from './appointments/recurrence';
export * from './ledger/common';
export * from './ledger/charges';
export * from './ledger/family-account';
export * from './payments/common';
export * from './payments/payments';
export * from './payments/promises';
export * from './reports/common';
export * from './reports/dashboard';
export * from './reports/sessions';
export * from './reports/promises';
export * from './reports/therapist-activity';
export * from './reports/payments';
export * from './reports/family-accounts';
export * from './settlement/common';
export * from './settlement/share-rules';
export * from './settlement/ratings';
export * from './settlement/statement';
export * from './settlement/close';
export * from './website/common';
export * from './website/public-services';
export * from './website/public-team';
export * from './website/public-clinic';
export * from './website/public-articles';
export * from './website/public-testimonials';
export * from './website/public-sitemap';
export * from './website/public-requests';
export * from './website/website-requests';
export * from './website/articles';
export * from './website/testimonials';
export * from './website/therapist-public-profile';
export * from './website/clinic-profile';
