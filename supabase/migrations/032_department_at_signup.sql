-- ============================================================
-- 032 -- the department is chosen while CREATING the account
--
-- WHAT THIS CORRECTS IN 031
-- -------------------------
-- 031 added set_own_department() and described it as a prompt shown on the
-- first screen after signing in, to anyone whose record had no department.
-- That is not where the question belongs. It belongs on the create-account
-- form, next to the name and the email address -- asked once, while the person
-- is already filling in who they are, rather than as a modal that interrupts
-- someone who came to do something else.
--
-- set_own_department() itself is UNCHANGED and is not redefined here. It was
-- always the right function for this: it resolves the caller from the session,
-- writes one column, and only when that column is still null. All that moves
-- is WHEN the application calls it -- at the end of registration now, in the
-- same breath as claim_employee_account(), instead of on a later visit.
--
-- WHAT THIS ADDS
-- --------------
-- signup_departments(), because the create-account form runs BEFORE there is
-- an account. The `departments` table is readable only by an authenticated,
-- second-factor-verified session (001, tightened by 022), which someone who
-- has not registered yet is by definition not. Without this the dropdown on
-- the signup form would be empty for every person who needs it.
--
-- WHY THIS IS SAFE TO EXPOSE TO anon
-- ----------------------------------
-- Be clear about what is disclosed, because this is the one genuinely new
-- exposure in the change: an anonymous visitor who can reach the signup page
-- can read the NAMES of active departments. Nothing else -- not the
-- description, not headcount, not who is in them, not inactive ones.
--
-- That is accepted deliberately:
--
--   * A department name is not a secret. It appears on every recognition,
--     every report and every employee row inside the product, and on job ads
--     and email signatures outside it.
--
--   * It grants nothing. No policy, role or route in this system keys off
--     department -- it is a reporting dimension. Knowing the names gets an
--     attacker no closer to an account than knowing the company exists.
--
--   * The signup page is already anonymous by necessity, and already calls
--     auth_setup_status() and check_signup_eligibility() as anon. This is the
--     same shape of call, returning strictly less about any individual.
--
-- If that trade is ever unwanted, the fix is to move the question behind the
-- emailed code -- the session is authenticated and verified by then, so the
-- ordinary RLS read works and this function can be dropped. The application
-- would change; set_own_department() would not.
--
-- WHAT IT IS NOT
-- --------------
-- Not a directory. It cannot be made to return employees, inactive
-- departments, or any column beyond id and name -- there are no arguments to
-- steer it with.
-- ============================================================

CREATE OR REPLACE FUNCTION public.signup_departments()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  -- COALESCE so an empty table returns [] rather than NULL: the form treats
  -- "no departments exist yet" as "do not ask", and that has to be a value it
  -- can read rather than a null it has to guess at.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('id', d.id, 'name', d.name)
      ORDER BY d.name
    ),
    '[]'::jsonb
  )
  FROM departments d
  WHERE d.is_active;
$fn$;

-- anon is granted DELIBERATELY: the caller has no account yet. See the note
-- above for exactly what that discloses and why it is accepted.
GRANT EXECUTE ON FUNCTION public.signup_departments() TO anon, authenticated;


-- ============================================================
-- Verification
--
-- Printed when the migration runs. Same shape as 026/027/031.
-- ============================================================
SELECT '032 APPLIED' AS check,
       EXISTS (SELECT 1 FROM pg_proc
                WHERE pronamespace = 'public'::regnamespace
                  AND proname = 'signup_departments')                  AS list_installed,
       -- Takes no arguments: there is nothing to steer it with.
       (SELECT pronargs = 0 FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'signup_departments')                         AS takes_no_arguments,
       -- Active departments only.
       (SELECT pg_get_functiondef(oid) LIKE '%d.is_active%'
          FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'signup_departments')                         AS active_only,
       has_function_privilege('anon', 'public.signup_departments()', 'EXECUTE')
                                                                       AS anon_can_list,
       -- 031's function is untouched and still refuses anonymous callers.
       EXISTS (SELECT 1 FROM pg_proc
                WHERE pronamespace = 'public'::regnamespace
                  AND proname = 'set_own_department')                  AS claim_side_intact,
       NOT has_function_privilege('anon', 'public.set_own_department(uuid)', 'EXECUTE')
                                                                       AS anon_still_cannot_write,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')   AS policies_untouched;
-- EXPECT every boolean true. anon_can_list is true ON PURPOSE -- it is the
-- point of this migration; anon_still_cannot_write is what keeps that narrow.
-- policies_untouched should equal whatever it read after 031: no policy is
-- created, altered or dropped here, and `departments` RLS is NOT relaxed --
-- the function reads past it as its definer instead.
