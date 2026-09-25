-- Milestone 10, checkpoint A2 — THE AUDIT-MASKING CHECK MUST SURVIVE A RESTORE.
--
-- Found by the first backup-and-restore drill. `audit_log_identifiers_masked_chk`
-- calls `audit_identifiers_masked(jsonb)`, and the function calls ITSELF by an
-- unqualified name to walk nested objects and arrays. pg_restore loads every
-- row with `search_path` set to '' (a guard against object hijacking during a
-- restore), so the recursive call could not be resolved, the CHECK raised on
-- the first nested audit row, and the whole restore rolled back: every backup
-- of this schema was unrestorable.
--
-- Pinning the function's own search_path makes the name resolve however the
-- caller's path is set. `public` cannot be written by anybody but the owner
-- (20260925120000_m10_a1_runtime_role), so naming it here cannot be used to
-- substitute a function. The body, the volatility and the constraint are
-- unchanged; `fa_normalize`, the only other function a CHECK calls, uses
-- pg_catalog builtins alone and needs nothing.

ALTER FUNCTION "audit_identifiers_masked"(jsonb) SET search_path = pg_catalog, public;
