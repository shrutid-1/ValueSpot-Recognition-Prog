-- ============================================================
-- 033 -- removing a department, not just archiving it
--
-- WHAT THIS IS FOR
-- ----------------
-- The Departments screen could only archive: `is_active` went false, the row
-- stayed, and the department vanished from every dropdown. That is the right
-- default for a department that has history behind it. It is the wrong and
-- only option for the ordinary case of one typed by mistake, or a reorg that
-- left a name nobody should see again -- the list grows and never shrinks.
--
-- WHY A FUNCTION AND NOT A PLAIN DELETE
-- -------------------------------------
-- `employees.department_id REFERENCES departments(id)` carries no ON DELETE
-- clause, so it defaults to NO ACTION: while a single employee points at a
-- department, PostgreSQL refuses to delete it. A bare DELETE from the browser
-- would therefore fail for exactly the departments most worth removing.
--
-- Doing it as two statements from the client -- null the employees, then
-- delete -- is worse: they are two round trips and two transactions, so a
-- refusal on the second leaves employees detached from a department that
-- still exists. Nobody asked for that and nothing would report it.
--
-- Inside a function the two statements share one transaction. Either the
-- department is gone and its members are unassigned, or nothing happened.
--
-- WHY SECURITY INVOKER (the default, stated here for the reader)
-- -------------------------------------------------------------
-- Deliberately NOT a definer function. This needs no privilege that HR does
-- not already hold: `departments_hr_write` is FOR ALL, which includes DELETE,
-- and `employees_hr_full` likewise. Both still carry the 2FA gate from 022.
--
-- So the caller's own RLS applies to both statements, exactly as it would to
-- the same SQL typed by hand, and this function grants NOTHING. An employee
-- who calls it has both statements filtered to zero rows and gets the refusal
-- below. That is the whole authorization story -- there is no role check in
-- this function on purpose, because a check here would be a second, weaker
-- copy of the policies that are already deciding.
--
-- WHAT IT COSTS
-- -------------
-- Detaching is a real edit to employee records: anyone in the department is
-- left with none, the same state as someone who has never been assigned. It
-- is reversible only by reassigning them. The count is returned so the screen
-- can say how many people it touched, and the confirmation names the number
-- BEFORE the click -- this function reports, it does not warn.
--
-- Recognitions are untouched. `nominations` does not reference departments;
-- department appears in reporting through the employee, so removing one
-- changes how history GROUPS, never what it says.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_department(p_department_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  detached integer;
  removed  integer;
BEGIN
  IF p_department_id IS NULL THEN
    RETURN jsonb_build_object('status', 'department_required');
  END IF;

  -- Clears the foreign keys that would otherwise refuse the DELETE. Filtered
  -- by the caller's own RLS: a non-HR caller updates nothing here, and then
  -- deletes nothing below, and the RAISE undoes this in the same breath.
  UPDATE employees
     SET department_id = NULL
   WHERE department_id = p_department_id;

  GET DIAGNOSTICS detached = ROW_COUNT;

  DELETE FROM departments WHERE id = p_department_id;

  GET DIAGNOSTICS removed = ROW_COUNT;

  /*
    Nothing was deleted: the row is already gone, or RLS filtered it out
    because this caller may not write departments.

    This MUST raise rather than return a status. A plain RETURN commits the
    function's transaction, which would leave the UPDATE above standing --
    employees detached from a department that still exists, reported as a
    failure. Raising rolls both statements back, which is the only honest
    outcome when the delete did not happen.
  */
  IF removed = 0 THEN
    RAISE EXCEPTION 'department_not_removed'
      USING ERRCODE = 'P0001',
            HINT    = 'The department no longer exists, or this session may not change departments.';
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'employees_detached', detached
  );
END;
$fn$;

-- anon has no session for RLS to resolve and would be refused by every policy
-- this touches; said explicitly so a later default GRANT cannot widen it.
REVOKE EXECUTE ON FUNCTION public.delete_department(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_department(uuid) TO authenticated;


-- ============================================================
-- Verification
--
-- Printed when the migration runs. Same shape as 026/027/031/032.
-- ============================================================
SELECT '033 APPLIED' AS check,
       EXISTS (SELECT 1 FROM pg_proc
                WHERE pronamespace = 'public'::regnamespace
                  AND proname = 'delete_department')                   AS function_installed,
       -- INVOKER, not DEFINER: the caller's own RLS decides, and this
       -- function grants nothing. False here would mean it had been turned
       -- into an escalation.
       (SELECT NOT prosecdef FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'delete_department')                          AS runs_as_caller,
       -- The rollback path is present: a failed delete must not leave
       -- employees detached.
       (SELECT pg_get_functiondef(oid) LIKE '%department_not_removed%'
          FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'delete_department')                          AS refusal_rolls_back,
       NOT has_function_privilege('anon', 'public.delete_department(uuid)', 'EXECUTE')
                                                                       AS anon_cannot_call,
       has_function_privilege('authenticated', 'public.delete_department(uuid)', 'EXECUTE')
                                                                       AS authenticated_can_call,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')   AS policies_untouched;
-- EXPECT every boolean true. runs_as_caller true is the important one: it is
-- what makes "authenticated may execute" safe, because the policies still
-- decide. policies_untouched should equal whatever it read after 032 -- no
-- policy is created, altered or dropped here, and no foreign key is relaxed:
-- the ON DELETE behaviour of employees.department_id is deliberately left as
-- NO ACTION so that only this function can detach anyone.
