-- ============================================================
--  Migration 023: finalise the session-bound email second factor
--
--  Two narrowly scoped changes, both additive in effect:
--
--    1. NEW  public.revoke_login_verification()  — makes logout take effect at
--            the database immediately instead of waiting out the access token.
--    2. HARDEN  public.custom_access_token_hook() — pins its search_path.
--            Logic byte-for-byte identical to migration 006.
--
--  What is NOT touched:
--    * no table is created, altered or dropped
--    * no RLS policy is touched
--    * migrations 021 and 022 are not modified
--    * no verification, rate-limit or code-handling logic changes
--
--  Safe to run more than once.
--
--
--  WHY THIS EXISTS — logout was not fully effective
--  ------------------------------------------------
--  supabase.auth.signOut() revokes the refresh token, but the access token
--  already in the browser stays cryptographically valid until its `exp`,
--  roughly an hour. PostgREST validates a JWT by signature and expiry; it does
--  not consult a revocation list. Nothing about signing out makes an
--  already-issued token stop being accepted.
--
--  Until now the login_verifications row survived logout, so for that token
--  session_second_factor_ok() still returned true and every policy in 022 still
--  passed. Anyone holding a copy of the access token — from a shared machine,
--  a browser extension, a proxy log — kept full verified access for up to an
--  hour after the user believed they had logged out.
--
--  Deleting the verification row closes that window at the RLS layer
--  immediately. The token remains technically valid, but it is no longer a
--  *verified* session, so 022's policies refuse it. Defence in depth: the
--  application no longer depends on token expiry to make logout meaningful.
-- ============================================================


-- ── Revoke this user's second-factor verification ───────────
--
-- Scope: the caller's OWN rows only. auth.uid() comes from the verified JWT
-- and is never accepted from the browser, so one user cannot revoke another's
-- verification. There is no parameter naming a user or a session for the same
-- reason — an IDOR here would be a denial-of-service against other people's
-- sessions.
--
-- Deletes every row for the caller by default, because supabase-js signOut()
-- defaults to global scope and revokes every refresh token the user has. The
-- database side matches that: if all sessions are being ended, none of them
-- should keep a verified marker. Pass false to revoke only the current session.

CREATE OR REPLACE FUNCTION public.revoke_login_verification(
  p_all_sessions boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid     uuid := auth.uid();
  sid     uuid := public.current_session_id();
  removed integer := 0;
  actor   uuid;
  uemail  text;
BEGIN
  -- No session, nothing to revoke. Deliberately not an error: logging out
  -- twice, or from an already-expired session, is normal and must not surface
  -- a failure to the user.
  IF uid IS NULL THEN
    RETURN jsonb_build_object('status', 'not_authenticated', 'revoked', 0);
  END IF;

  IF p_all_sessions THEN
    DELETE FROM login_verifications WHERE user_id = uid;
  ELSE
    -- Both columns are matched so a stale or mismatched session id cannot
    -- delete a row belonging to a different user.
    DELETE FROM login_verifications WHERE user_id = uid AND session_id = sid;
  END IF;

  GET DIAGNOSTICS removed = ROW_COUNT;

  -- Audit trail. Written only when something was actually removed, so repeated
  -- logouts do not pad the log. Records no code, no hash, no token.
  IF removed > 0 THEN
    SELECT email INTO uemail FROM auth.users WHERE id = uid;
    SELECT id    INTO actor  FROM employees  WHERE auth_user_id = uid LIMIT 1;

    INSERT INTO audit_logs (actor_id, actor_email, action, entity_type, entity_id, new_value)
    VALUES (
      actor, uemail, 'login.verification_revoked', 'session', sid,
      jsonb_build_object('rows_revoked', removed, 'all_sessions', p_all_sessions)
    );
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'revoked', removed);
END;
$fn$;

-- anon has no session, so this would be a no-op for it — revoked anyway to
-- keep the reachable surface honest.
REVOKE EXECUTE ON FUNCTION public.revoke_login_verification(boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.revoke_login_verification(boolean) TO authenticated;


-- ── Harden the access-token hook: pin its search_path ───────
--
-- Found during the final security audit. It is the ONLY SECURITY DEFINER
-- function in this project without `SET search_path`, and Supabase's own
-- linter flags exactly this as `function_search_path_mutable`.
--
-- Why it matters. A SECURITY DEFINER function without a pinned search_path
-- resolves unqualified names using whatever search_path the *caller* has,
-- while running with the *definer's* privileges. This particular function runs
-- on every single token mint and is executable by supabase_auth_admin, so it
-- is about the most privileged path in the system.
--
-- Honest severity: LOW, not critical. The one table it touches is already
-- schema-qualified (`public.employees`), and the built-ins it uses live in
-- pg_catalog, which is searched ahead of user schemas anyway. Exploiting it
-- would additionally require CREATE on a schema that sorts earlier — which
-- `authenticated` does not have here. This is defence in depth and a lint
-- clean-up, not the closing of an open door.
--
-- THE BODY BELOW IS LOGICALLY IDENTICAL to migration 006. Only `SET
-- search_path = public` is added, matching the convention every other function
-- in 021/022 already follows. Nothing else changed — deliberately, because if
-- this function is wrong, RLS sees every user as an ordinary employee and the
-- entire HR and manager experience silently returns nothing.
--
-- After applying, sign in once and confirm the token still carries `user_role`
-- and `employee_id`.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public                       -- <- the only change
AS $fn$
DECLARE
  claims jsonb;
  emp_role text;
  emp_id uuid;
BEGIN
  SELECT role, id INTO emp_role, emp_id
  FROM public.employees
  WHERE auth_user_id = (event->>'user_id')::uuid;

  claims := event->'claims';

  IF emp_role IS NOT NULL THEN
    claims := jsonb_set(claims, '{user_role}', to_jsonb(emp_role));
  ELSE
    claims := jsonb_set(claims, '{user_role}', '"employee"');
  END IF;

  IF emp_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{employee_id}', to_jsonb(emp_id::text));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$fn$;

-- Re-granted because CREATE OR REPLACE does not disturb existing grants, but
-- stating it keeps this migration self-contained if it is ever replayed onto a
-- project where the grant was lost.
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;


-- ── Verification ────────────────────────────────────────────

SELECT 'HOOK HARDENED' AS check,
       proname,
       prosecdef                                    AS security_definer,
       proconfig                                    AS settings
  FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace
   AND proname = 'custom_access_token_hook';
-- EXPECT security_definer = true and settings containing search_path=public.


SELECT '023 APPLIED' AS check,
       EXISTS (SELECT 1 FROM pg_proc
                WHERE pronamespace = 'public'::regnamespace
                  AND proname = 'revoke_login_verification')          AS function_created,
       (SELECT COALESCE(array_to_string(proacl, ' | '), 'PUBLIC (default)')
          FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'revoke_login_verification')                 AS grants,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policies_untouched;
-- EXPECT function_created = true, grants listing authenticated and NOT anon,
-- and policies_untouched unchanged from before this migration ran.


-- ============================================================
-- ROLLBACK
--
-- 1. The logout revocation:
--
--      DROP FUNCTION IF EXISTS public.revoke_login_verification(boolean);
--
--    Restores the previous behaviour exactly: logout stops clearing the
--    verification row. Nothing else calls this function and no policy depends
--    on it, so the drop is safe at any time. The frontend tolerates its
--    absence — AuthContext swallows the error and signs out regardless.
--
-- 2. The hook hardening:
--
--    Re-run the original definition from 006_views_and_auth.sql, which is the
--    same body without `SET search_path`. There is no reason to do this except
--    to prove the hardening was the cause of some other problem.
--
-- NOTE for anyone auditing later: a text search of the migrations folder will
-- still show 006's unpinned definition, because history is never rewritten.
-- The live database state is what 023 leaves behind. Confirm with:
--
--   SELECT proname, proconfig FROM pg_proc
--    WHERE pronamespace = 'public'::regnamespace
--      AND proname = 'custom_access_token_hook';
-- ============================================================
