-- ============================================================
--  POST-DEPLOYMENT VERIFICATION  —  read-only, changes nothing
--
--  Run the whole file in the SQL Editor and send me the output of each
--  numbered query. It creates nothing, alters nothing, and prints no secret
--  values — only whether the required secrets exist by name.
-- ============================================================


-- ── 1. Extensions ───────────────────────────────────────────
SELECT '1. EXTENSIONS' AS check,
       extname, extversion
  FROM pg_extension
 WHERE extname IN ('pg_net', 'supabase_vault', 'pgcrypto')
 ORDER BY extname;


-- ── 2. Vault secrets — NAMES ONLY, never values ─────────────
SELECT '2. VAULT SECRETS' AS check,
       name,
       (length(COALESCE(decrypted_secret, '')) > 0) AS has_value
  FROM vault.decrypted_secrets
 WHERE name IN ('resend_api_key', 'resend_sender')
 ORDER BY name;
-- EXPECT two rows, both has_value = true. Missing rows mean login codes
-- cannot be sent and request_login_code() will return 'email_not_configured'.


-- ── 3. The 2FA objects exist ────────────────────────────────
SELECT '3. FUNCTIONS' AS check,
       p.proname,
       p.prosecdef                                        AS security_definer,
       COALESCE(array_to_string(p.proconfig, ', '), '(none)') AS config,
       pg_get_functiondef(p.oid) ILIKE '%session_second_factor_ok%' AS uses_2fa_check
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN (
        'request_login_code', 'verify_login_code', 'session_status',
        'session_second_factor_ok', 'session_second_factor_ok_for',
        'session_auth_methods', 'current_session_id', 'hash_login_code',
        'current_employee_role', 'claim_employee_account')
 ORDER BY p.proname;
-- EXPECT: all ten present.
--   current_employee_role  -> uses_2fa_check = true
--   claim_employee_account -> uses_2fa_check = true
--   every SECURITY DEFINER row -> config contains search_path


-- ── 4. Migration 018 really removed the access codes ────────
SELECT '4. ACCESS CODES REMOVED' AS check,
       NOT EXISTS (SELECT 1 FROM pg_tables
                    WHERE schemaname = 'public'
                      AND tablename IN ('role_access_codes','role_access_code_attempts'))
       AS tables_gone,
       NOT EXISTS (SELECT 1 FROM pg_proc
                    WHERE pronamespace = 'public'::regnamespace
                      AND proname IN ('create_role_access_code','revoke_role_access_code',
                                      'list_role_access_codes','hash_access_code',
                                      'normalise_access_code'))
       AS functions_gone;
-- EXPECT both true.


-- ── 5. Policy coverage — the important one ──────────────────
SELECT '5. POLICY COVERAGE' AS check,
       count(*) FILTER (WHERE protected)     AS protected_policies,
       count(*) FILTER (WHERE NOT protected) AS unprotected_policies
  FROM (
    SELECT (COALESCE(qual, '') ILIKE '%session_second_factor_ok%'
         OR COALESCE(with_check, '') ILIKE '%session_second_factor_ok%') AS protected
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('employees','departments','projects','project_members',
                         'core_values','behaviours','scenarios','nominations',
                         'nomination_appreciations','badge_definitions',
                         'employee_value_badges','badge_history','notifications',
                         'audit_logs','app_config','rewards','reward_assignments',
                         'reciprocal_recognition_flags')
  ) t;
-- EXPECT unprotected_policies = 0.


-- ── 6. Any policy 022 missed, named explicitly ──────────────
SELECT '6. UNPROTECTED POLICIES' AS check,
       tablename, policyname, cmd
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('employees','departments','projects','project_members',
                     'core_values','behaviours','scenarios','nominations',
                     'nomination_appreciations','badge_definitions',
                     'employee_value_badges','badge_history','notifications',
                     'audit_logs','app_config','rewards','reward_assignments',
                     'reciprocal_recognition_flags')
   AND COALESCE(qual, '')       NOT ILIKE '%session_second_factor_ok%'
   AND COALESCE(with_check, '') NOT ILIKE '%session_second_factor_ok%'
 ORDER BY tablename, policyname;
-- EXPECT zero rows. Any row here is a table a password-only session can still
-- reach — send it to me and do not treat the deployment as complete.


-- ── 7. The recognition feed view ────────────────────────────
SELECT '7. FEED VIEW' AS check,
       pg_get_viewdef('public.v_recognition_feed'::regclass) ILIKE '%session_second_factor_ok%'
       AS view_protected;
-- EXPECT true. This view bypasses RLS by design, so the check lives inside it.


-- ── 8. The 2FA tables are unreachable from a browser ────────
SELECT '8. TABLE GRANTS' AS check,
       t.relname AS table_name,
       t.relrowsecurity AS rls_enabled,
       COALESCE((SELECT string_agg(DISTINCT g.grantee, ', ')
                   FROM information_schema.role_table_grants g
                  WHERE g.table_schema = 'public'
                    AND g.table_name = t.relname
                    AND g.grantee IN ('anon','authenticated')), '(none)') AS browser_grants,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = t.relname) AS policy_count
  FROM pg_class t
 WHERE t.relnamespace = 'public'::regnamespace
   AND t.relname IN ('login_verifications','login_code_sends');
-- EXPECT: rls_enabled true, browser_grants '(none)', policy_count 0.


-- ── 9. Who may execute the sensitive functions ──────────────
SELECT '9. EXECUTE GRANTS' AS check,
       p.proname,
       COALESCE(array_to_string(p.proacl, ' | '), 'PUBLIC (default)') AS acl
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('session_second_factor_ok_for','request_login_code',
                     'verify_login_code','session_status','session_second_factor_ok')
 ORDER BY p.proname;
-- EXPECT session_second_factor_ok_for to list service_role and NOT anon or
-- authenticated. The others should list authenticated.
