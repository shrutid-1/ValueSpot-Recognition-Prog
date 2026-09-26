-- ============================================================
-- Migration 036: Make purge_employee() reachable by the service role
--
-- 035 created the function and revoked the implicit PUBLIC execute, but the
-- matching GRANT to service_role was added to that file only AFTER it had
-- already been applied to at least one project. A migration is applied once;
-- editing it afterwards changes nothing that is already in the ledger. This
-- is the corrective, and it is written to be safe to run whether or not the
-- grant is already in place.
--
-- WHY THE SYMPTOM LOOKED LIKE A MISSING MIGRATION
-- -----------------------------------------------
-- PostgREST does not expose a function the caller has no EXECUTE privilege
-- on. It reports it as PGRST202 -- "could not find the function in the schema
-- cache" -- which is the same code it returns when the function genuinely does
-- not exist. So a function that is present but unreachable is indistinguishable
-- from one that was never created, from the client's side.
--
-- delete-employee mapped PGRST202 to "migration 035 has not been applied",
-- which was true of the case it was written for and misleading here. That
-- mapping is corrected alongside this migration.
--
-- Both statements are idempotent. GRANT on an existing privilege is a no-op,
-- and the schema reload is a notification with no persistent effect.
-- ============================================================


-- ── 1. The grant ────────────────────────────────────────────
--
-- Same shape as session_second_factor_ok_for() in 021: the one role that may
-- call it, named explicitly rather than left to default privileges.
--
-- The REVOKE is repeated so that this migration states the whole intended
-- privilege set rather than half of it. Re-revoking is harmless.

REVOKE EXECUTE ON FUNCTION public.purge_employee(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_employee(uuid, uuid) TO service_role;


-- ── 2. Tell PostgREST to look again ─────────────────────────
--
-- A privilege change does not always trigger the schema-cache reload that a
-- DDL change does, and a cache still holding the pre-grant view would keep
-- returning PGRST202 until it happened to refresh on its own.

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- VERIFYING THIS WORKED
--
-- In the SQL editor:
--
--   SELECT has_function_privilege(
--            'service_role',
--            'public.purge_employee(uuid, uuid)',
--            'EXECUTE'
--          );
--
-- Expect true. If it is false after this migration, the function signature
-- differs from the one 035 created and the grant landed on nothing.
--
-- ROLLBACK
--
--   REVOKE EXECUTE ON FUNCTION public.purge_employee(uuid, uuid) FROM service_role;
--
-- Which would restore the broken state, so there is little reason to.
-- ============================================================
