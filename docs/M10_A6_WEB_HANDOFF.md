# M10 A6 — money never disappears from reports: what the Web tier needs (for Agent B)

Agent A, Milestone 10, checkpoint A6 (owner decision on A5 finding 1; DECISION_LOG,
2026-10-01). The API half is done. In `apps/web` Agent A changed one thing, mechanically: a
Persian message for the new error code in `src/server/errors-fa.ts` (the coverage test fails
the build without one). The Web typecheck and its 1156 tests pass.

**What the Web does today, unchanged:** deactivating a family that owes money or holds credit
is refused and the family page shows the generic message for `FAMILY_BALANCE_UNACKNOWLEDGED`.
Nothing is lost, but the desk cannot finish the deactivation until item 1 is built. A family
with a zero balance deactivates exactly as before.

## 1. The deactivation warning (family page)

Route unchanged: `PATCH /families/:id/status`, permission `family.update_status`, manager and
receptionist. Body: `updateFamilyStatusRequestSchema` (`packages/contracts/src/families/families.ts`):

| Field                 | Meaning                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`              | `ACTIVE` or `INACTIVE`, as before                                                                                                           |
| `acknowledgedBalance` | optional `{ amountDueToman, creditToman }` (`familyBalanceSchema`); only with `INACTIVE` — sent with `ACTIVE` it is `400 VALIDATION_FAILED` |

The flow:

1. Send `{ status: 'INACTIVE' }` as today.
2. If the family holds money: **`409 FAMILY_BALANCE_UNACKNOWLEDGED`**, `error.details` =
   `{ amountDueToman, creditToman }` — canonical toman strings, at most one non-zero. Parse it
   with `familyBalanceSchema`. `api-client.ts` already passes `details` through for any code
   (its comment says "only the two duplicate codes" — that comment is now stale).
3. Show a warning that names the amount — one of:
   - the family **owes** `amountDueToman` toman (when it is not `'0'`);
   - the family **holds credit** of `creditToman` toman (when it is not `'0'`);
   - and that it will stay in the family-balances report, marked inactive.
     Wording is the coordinator's to translate. Do not add, subtract or compare amounts; show the
     strings formatted as every other toman amount is.
4. On confirmation, resend `{ status: 'INACTIVE', acknowledgedBalance: <details verbatim> }`.
   Carry the two strings through the form (hidden fields) and re-validate them in the BFF route
   with `familyBalanceSchema` — never recompute them.
5. If the balance moved in between (a payment arrived), the answer is **409 again with the new
   figures**: show the warning again with the new amount. `200` returns the family as before.

Where: `src/app/(internal)/families/[id]/page.tsx` (the status form, ~line 105) and the BFF
route `src/app/api/families/status/route.ts`, which today parses only `status` and redirects
with the code on failure; it needs to carry the details back to the page (e.g. a short-lived
redirect parameter carrying only the two digit strings, or a confirmation step), and to forward
`acknowledgedBalance`. Reactivation is unchanged.

## 2. The family-accounts report and its file

`GET /reports/family-accounts` and `/export`, permission and query unchanged.

- **Default changed:** without `includeInactive`, the report lists every active family **and
  every inactive family that owes money or holds credit**. `includeInactive=true` adds only
  inactive families standing at zero. The totals are therefore the same with and without the
  flag (only `familyCount` and the rows differ).
- **New field:** each row's `family` now has `status: 'ACTIVE' | 'INACTIVE'`
  (`familyAccountReportRowSchema`). Mark inactive rows clearly (a badge such as "غیرفعال" beside
  the name, and on the printed page).
- **Copy that is now wrong** in `src/app/(internal)/reports/family-accounts/page.tsx`:
  - the print context line `خانواده‌های غیرفعال: … 'نمایش داده نمی‌شوند'` (~line 83) — inactive
    families holding money ARE shown by default;
  - the filter labelled `خانواده‌های غیرفعال` with options `نمایش داده نشود` / `نمایش داده شود`
    (~lines 113–121) — it now means "also show inactive families with no balance".
- **The CSV** gains a column `وضعیت پروندهٔ خانواده` (`ACTIVE`/`INACTIVE`) right after
  `خانواده`. The Web passes the file through and needs no change unless something pins columns.

## 3. Nothing else changes for the Web

Every other money summary already ignored family status and is unchanged (checked list below).
No route, permission or page permission changed; `docs/PERMISSION_MATRIX.md` is unchanged.

## Places checked for status-based hiding (API)

| Place                                                                      | Finding                                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /reports/family-accounts` (family balances)                           | **hid inactive families by default — fixed**                                                |
| `GET /reports/family-accounts/export`                                      | **same — fixed; status column added**                                                       |
| `GET /dashboard` (charges, payments, reconciliation, due/overdue promises) | no family-status predicate                                                                  |
| `GET /reports/payments` and `/export`                                      | no family-status predicate                                                                  |
| `GET /reports/promises` and `/export` (incl. overdue/missed)               | no family-status predicate                                                                  |
| `GET /reports/sessions` and `/export`                                      | no family-status predicate (no money)                                                       |
| `GET /reports/therapist-activity` and `/export`                            | no family; inactive therapists with activity already listed                                 |
| `GET /families/:id/account`, payment and promise history                   | no status check; readable for an inactive family                                            |
| `GET /settlement/statement` and export, period close and detail            | no family- or therapist-status predicate                                                    |
| Recording a payment or promise for an inactive family                      | allowed (no `FAMILY_INACTIVE` check), so money can still arrive                             |
| Family search / recent list                                                | hides inactive by default, but carries no money (lookup only; `includeInactive` finds them) |
