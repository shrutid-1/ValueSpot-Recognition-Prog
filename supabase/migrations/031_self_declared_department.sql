-- ============================================================
-- 031 -- the employee says which department they are in
--
-- THE PROBLEM
-- -----------
-- `employees.department_id` is nullable and, in practice, null for nearly
-- everyone. HR can set it on the Employees screen, but nothing ever asks the
-- one person who always knows the answer -- the employee -- so the Department
-- column stays empty and every department-scoped report reads as unassigned.
--
-- WHAT THIS ADDS
-- --------------
-- set_own_department(), which lets a signed-in person fill in their OWN
-- department, once. The application asks on the first visit after signing in
-- for anyone whose record has no department yet.
--
-- WHY A FUNCTION RATHER THAN A PLAIN UPDATE
-- -----------------------------------------
-- `employees_update_own` would already permit the write, so this adds no
-- capability the client did not have. What it adds is a NARROW one, which is
-- the point:
--
--   1. It writes exactly one column. A raw self-update is a whole-row write
--      that the RLS policy constrains only as far as `role`; a self-service
--      prompt has no business being able to touch full_name, email or
--      is_active on the way past.
--
--   2. It fills a gap, it does not overwrite. The UPDATE carries
--      `department_id IS NULL`, so once a department is set -- by HR, or by
--      this function earlier -- this function will not change it. HR's
--      assignment is the authority; the employee's answer is only ever the
--      thing that gets used when HR has not said.
--
--      This also makes it idempotent and safe to call twice: the second call
--      returns 'already_set' rather than quietly re-writing.
--
--   3. It resolves the caller from auth.uid(), not from the JWT's
--      `employee_id` claim. A brand-new account's JWT does not carry that
--      claim until the token is refreshed, and the prompt is shown at exactly
--      that moment.
--
-- WHAT IT IS NOT
-- --------------
-- Not a way to move somebody else, and not a way to move yourself twice.
-- There is no employee-id argument -- the row is found from the verified
-- session -- so the worst a tampered client can do is name a different
-- DEPARTMENT for itself, which is a value HR can see and correct on the
-- Employees screen. Departments carry no permissions; nothing in this system
-- grants access by department.
--
-- The 2FA gate applies here as it does everywhere else since 022: an
-- unverified session cannot call this, for the same reason it cannot read the
-- directory.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_own_department(p_department_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid      uuid := auth.uid();
  emp      employees%ROWTYPE;
  affected integer;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('status', 'not_authenticated');
  END IF;

  IF NOT public.session_second_factor_ok() THEN
    RETURN jsonb_build_object('status', 'needs_verification');
  END IF;

  IF p_department_id IS NULL THEN
    RETURN jsonb_build_object('status', 'department_required');
  END IF;

  -- An inactive department is not an option the prompt offers, so reaching
  -- here with one means the list went stale mid-answer (or the call was made
  -- by hand). Either way it is refused rather than stored.
  IF NOT EXISTS (
    SELECT 1 FROM departments
     WHERE id = p_department_id AND is_active
  ) THEN
    RETURN jsonb_build_object('status', 'unknown_department');
  END IF;

  SELECT * INTO emp FROM employees WHERE auth_user_id = uid LIMIT 1;

  -- No record yet means the account was never claimed. That is
  -- claim_employee_account()'s job and it runs before the prompt is ever
  -- shown; say so plainly rather than inventing a row here.
  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('status', 'no_employee_record');
  END IF;

  IF NOT emp.is_active THEN
    RETURN jsonb_build_object('status', 'inactive');
  END IF;

  -- The gap-filling write. `department_id IS NULL` is the whole guarantee:
  -- HR's assignment, whenever it was made, wins.
  UPDATE employees
     SET department_id = p_department_id
   WHERE id = emp.id
     AND department_id IS NULL;

  GET DIAGNOSTICS affected = ROW_COUNT;

  IF affected = 0 THEN
    RETURN jsonb_build_object(
      'status', 'already_set',
      'department_id', emp.department_id
    );
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'department_id', p_department_id);
END;
$fn$;

-- anon cannot call it: there is no session to resolve, and the 2FA gate would
-- refuse anyway. Stated explicitly so a later default GRANT cannot widen it.
REVOKE EXECUTE ON FUNCTION public.set_own_department(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_own_department(uuid) TO authenticated;


-- ============================================================
-- Verification
--
-- Printed when the migration runs. Same shape as 026/027: a single row, every
-- boolean expected true.
-- ============================================================
SELECT '031 APPLIED' AS check,
       EXISTS (SELECT 1 FROM pg_proc
                WHERE pronamespace = 'public'::regnamespace
                  AND proname = 'set_own_department')                  AS function_installed,
       (SELECT prosecdef FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'set_own_department')                         AS is_security_definer,
       -- Takes a department and nothing else: no employee id to point elsewhere.
       (SELECT pronargs = 1 FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'set_own_department')                         AS takes_only_a_department,
       -- The 2FA gate applies here as everywhere else since 022.
       (SELECT pg_get_functiondef(oid) LIKE '%session_second_factor_ok%'
          FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'set_own_department')                         AS needs_2fa,
       -- The gap-filling guard: HR's assignment is never overwritten.
       (SELECT pg_get_functiondef(oid) LIKE '%department_id IS NULL%'
          FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'set_own_department')                         AS never_overwrites_hr,
       NOT has_function_privilege('anon', 'public.set_own_department(uuid)', 'EXECUTE')
                                                                       AS anon_cannot_call,
       has_function_privilege('authenticated', 'public.set_own_department(uuid)', 'EXECUTE')
                                                                       AS authenticated_can_call,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')   AS policies_untouched;
-- EXPECT every boolean true. policies_untouched should equal whatever it read
-- after 030: this migration creates, alters and drops no policy -- the write it
-- performs was already permitted by employees_update_own, and the function only
-- narrows it.
