-- ============================================================
--  PHASE 11 — remove testing-only artifacts and tighten grants
--
--  Run this LAST, after every test that needs debug_session_auth() is done.
--  Nothing here changes authentication behaviour; it only reduces surface.
-- ============================================================


-- ── 1. Drop the testing diagnostic ──────────────────────────
--
-- debug_session_auth() was created by VERIFY_AMR.sql to prove the JWT carried
-- an `amr` claim. It only ever showed the caller their own claims, so it was
-- never a leak — but it has no purpose now that the design is settled.

DROP FUNCTION IF EXISTS public.debug_session_auth();


-- ── 2. Take two helpers off the anonymous role ──────────────
--
-- Both were granted to `authenticated` but never revoked from PUBLIC, so the
-- anon role inherited EXECUTE by default. Neither leaks anything — without a
-- session they return false and an empty array — so this is tidiness rather
-- than a fix. Revoking keeps the reachable surface honest.

REVOKE EXECUTE ON FUNCTION public.session_second_factor_ok() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.session_second_factor_ok() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.session_auth_methods() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.session_auth_methods() TO authenticated;


-- ── 3. Clear test verification rows ─────────────────────────
--
-- Removes rows from the testing sessions. Live sessions re-create theirs on
-- the next sign-in, so the only effect is that anyone signed in right now is
-- asked for a code again — which is the correct behaviour, not a bug.
--
-- Skip this if you would rather not interrupt your own session.

-- DELETE FROM login_verifications;
-- DELETE FROM login_code_sends;


-- ── 4. Confirm the result ───────────────────────────────────

SELECT 'CLEANUP RESULT' AS check,
       NOT EXISTS (SELECT 1 FROM pg_proc
                    WHERE pronamespace = 'public'::regnamespace
                      AND proname = 'debug_session_auth')          AS debug_fn_gone,
       (SELECT COALESCE(array_to_string(proacl, ' | '), 'PUBLIC (default)')
          FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'session_second_factor_ok')               AS second_factor_acl,
       (SELECT COALESCE(array_to_string(proacl, ' | '), 'PUBLIC (default)')
          FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'session_auth_methods')                   AS auth_methods_acl;
-- EXPECT debug_fn_gone = true, and neither ACL listing anon.
