-- ============================================================
-- 041 -- Employees may only recognise other Employees
--
-- Additive. Four functions, one trigger, one policy tightened. Safe to run
-- more than once. Requires 001-040.
--
--
-- THE RULE
-- --------
--     nominator role   may recognise
--     --------------   -------------------------------------------
--     employee         employee                       ONLY
--     manager          unchanged -- anyone but themselves
--     hr_admin         unchanged -- anyone but themselves
--     super_admin      unchanged -- anyone but themselves
--
-- Self-recognition stays refused for everybody, exactly as before. Nothing
-- here relaxes anything: the only pairing that becomes narrower is
-- "employee -> non-employee", which was previously allowed.
--
--
-- WHY THIS IS A DATABASE CHANGE AND NOT A FRONTEND ONE
-- ---------------------------------------------------
-- Until now the ONLY thing standing between a nomination and its nominee was
--
--     CONSTRAINT no_self_nomination CHECK (nominator_id != nominee_id)   (003)
--
-- plus the same test repeated in the nominations_insert policy. The nominee's
-- ROLE was never consulted anywhere in the database. The wizard's search box
-- was the whole of the restriction, and a search box is not a restriction:
--
--     POST /rest/v1/nominations  { "nominee_id": "<a super admin>", ... }
--
-- is a one-line request carrying the caller's own token, and it would have
-- been accepted. Every downstream step -- the approval assignment, the
-- notification, badge calculation, the feed -- keys off that row existing, so
-- accepting the INSERT is accepting all of it.
--
-- So the rule lives at the INSERT, where it cannot be skipped, and the search
-- is aligned with it rather than asked to enforce it.
--
--
-- WHERE THE CALLER'S ROLE COMES FROM
-- ----------------------------------
-- From `employees`, read inside the database. Never from the request body,
-- never from a query parameter, and not from the `user_role` JWT claim either
-- -- that claim is only refreshed when a token is minted, so a role changed
-- ten minutes ago is not yet in it. recognition_eligibility() reads the row.
--
-- The trigger separately binds the nomination to the CALLER: NEW.nominator_id
-- must be the employee record belonging to auth.uid(). The nominations_insert
-- policy already required that; asserting it here too means the role the rule
-- is applied to is provably the role of the person making the request, even if
-- that policy is ever loosened.
--
--
-- TWO GATES, ON PURPOSE
-- ---------------------
--   1. check_nomination_eligibility  BEFORE INSERT trigger. Raises a sentence
--      written for a person: "Employees can only recognize other employees."
--   2. nominations_insert            the row-level policy now also demands
--      recognition_eligibility() = 'ok'.
--
-- Postgres runs BEFORE ROW triggers before it evaluates a policy's WITH CHECK,
-- so in practice gate 1 answers first and the user sees the readable message.
-- Gate 2 is what still refuses the row if the trigger is ever dropped or
-- disabled. Neither gate weakens the other conditions already in the policy --
-- the second-factor test, the authenticated test, the nominator binding and
-- the self-recognition test are all carried over verbatim.
--
--
-- WHAT THIS MIGRATION DOES NOT TOUCH
-- ----------------------------------
--   route_nomination_to_project_manager()   (029/030) -- approval routing
--   assigned_approver_id / escalation_level -- still the database's alone
--   projects.manager_id / project_members   -- project selection is unchanged
--   enforce_nomination_rate_limits()        (007) -- rate limits
--   enforce_nominator_update_scope()        (009) -- what a nominator may edit
--   notify_nomination_submitted()           (009) -- notifications
--   every badge, analytics and audit path
--   every other RLS policy, including 022's second-factor gate
--
-- The new trigger is named to sort BEFORE both existing BEFORE INSERT triggers
-- (`check_` < `enforce_` < `route_`), because Postgres fires them in name
-- order and there is no point costing a rate-limit count or resolving an
-- approver for a nomination that is about to be refused outright.
--
--
-- SEEDERS AND MIGRATIONS
-- ----------------------
-- The established escape hatch: when auth.uid() IS NULL the caller is trusted
-- and identity-less -- the CLI applying seed files, the service-role seeder, a
-- migration, the SQL editor. Same rule as guard_employee_role_insert() (026)
-- and route_nomination_to_project_manager() (029/030). Demo data in which an
-- employee recognises a manager therefore still seeds, and historical rows are
-- not invalidated.
-- ============================================================


-- ============================================================
-- PART A -- the rule itself, in one expression
--
-- One definition, used by the guard, by the policy and by the search. A second
-- copy of "who may recognise whom" is how a search and an INSERT end up
-- disagreeing, which is the bug class this whole migration is about.
--
-- IMMUTABLE and argument-only: it knows nothing about sessions, so it is
-- equally usable inside a row filter and inside a trigger.
-- ============================================================

CREATE OR REPLACE FUNCTION public.role_may_recognize(
  p_nominator_role text,
  p_nominee_role   text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  -- An Employee may only recognise an Employee. No other role gains a
  -- restriction here: they recognise whoever they could before.
  SELECT p_nominator_role IS DISTINCT FROM 'employee'
      OR p_nominee_role = 'employee';
$fn$;

-- Granted to `authenticated` because recognition_candidates() below is
-- SECURITY INVOKER and therefore calls this as the caller. It answers a
-- question about two role names it was handed and reads nothing, so there is
-- nothing here for anon to learn -- but the house rule is that nothing is
-- executable by anon unless it has to be.
REVOKE EXECUTE ON FUNCTION public.role_may_recognize(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.role_may_recognize(text, text) TO authenticated;

COMMENT ON FUNCTION public.role_may_recognize(text, text) IS
  'Whether a nominator holding one role may recognise a nominee holding another. Employees may only recognise employees; no other role is restricted.';


-- ============================================================
-- PART B -- the eligibility verdict for one specific pair
--
-- Returns a STATUS rather than a boolean so the trigger can say which rule was
-- broken without re-deriving it, and so the policy can test one value.
--
-- SECURITY DEFINER because it is called from inside a row-level policy on
-- `nominations`, where a plain read of `employees` would itself be filtered by
-- that caller's employees policies -- and a nominee the caller cannot see must
-- still be judged by their real role rather than treated as missing.
-- search_path is pinned and EXECUTE is granted to `authenticated` only.
--
-- It discloses nothing: the caller already holds both ids, and all it returns
-- is a verdict about a pair they supplied.
-- ============================================================

CREATE OR REPLACE FUNCTION public.recognition_eligibility(
  p_nominator_id uuid,
  p_nominee_id   uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  nominator_role text;
  nominee_role   text;
BEGIN
  IF p_nominator_id IS NULL OR p_nominee_id IS NULL THEN
    RETURN 'incomplete';
  END IF;

  -- Checked first so the caller is told "you cannot recognise yourself"
  -- rather than given a role explanation for a pair refused either way.
  IF p_nominator_id = p_nominee_id THEN
    RETURN 'self';
  END IF;

  SELECT role INTO nominator_role FROM employees WHERE id = p_nominator_id;
  IF nominator_role IS NULL THEN
    RETURN 'unknown_nominator';
  END IF;

  SELECT role INTO nominee_role FROM employees WHERE id = p_nominee_id;
  IF nominee_role IS NULL THEN
    RETURN 'unknown_nominee';
  END IF;

  IF NOT public.role_may_recognize(nominator_role, nominee_role) THEN
    RETURN 'nominee_not_employee';
  END IF;

  RETURN 'ok';
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.recognition_eligibility(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.recognition_eligibility(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.recognition_eligibility(uuid, uuid) IS
  'Verdict on a nominator/nominee pair: ok, self, nominee_not_employee, unknown_nominator, unknown_nominee or incomplete. Roles are read from employees, never from a claim or a request.';


-- ============================================================
-- PART C -- the gate on INSERT
--
-- This is the enforcement point. It refuses the row before the rate limiter
-- counts it and before the routing trigger resolves an approver, so a refused
-- attempt creates nothing at all: no nomination, no approver assignment, no
-- notification, no badge recalculation, no analytics row. The statement fails
-- and the transaction rolls back.
-- ============================================================

CREATE OR REPLACE FUNCTION public.guard_nomination_eligibility()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  caller_id uuid;
  verdict   text;
BEGIN
  -- Trusted, identity-less callers: SQL Editor, migrations, seeders, service
  -- role. Same escape hatch as guard_employee_role_insert() (026).
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  /*
    The nomination must be the caller's own.

    Resolved from auth.uid() against `employees` rather than from the
    employee_id JWT claim, and deliberately WITHOUT requiring is_active or the
    second factor: those are the nominations_insert policy's job, and this must
    not quietly add a restriction it was not asked for. All this establishes is
    that the role about to be judged is the role of the person submitting.
  */
  SELECT id INTO caller_id
    FROM employees
   WHERE auth_user_id = auth.uid()
   LIMIT 1;

  IF caller_id IS NULL THEN
    RAISE EXCEPTION
      'Your employee record is not set up yet, so you cannot give recognition.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.nominator_id IS DISTINCT FROM caller_id THEN
    RAISE EXCEPTION 'You can only give recognition from your own account.'
      USING ERRCODE = 'check_violation';
  END IF;

  verdict := public.recognition_eligibility(NEW.nominator_id, NEW.nominee_id);

  IF verdict = 'ok' THEN
    RETURN NEW;
  END IF;

  /*
    One sentence per refusal, written for the person reading it. None names a
    table, a column, a policy or a role id -- the API layer passes a
    check-violation message straight through to the screen, so what is written
    here is what the user sees.
  */
  IF verdict = 'self' THEN
    RAISE EXCEPTION 'You cannot recognize yourself.'
      USING ERRCODE = 'check_violation';
  ELSIF verdict = 'nominee_not_employee' THEN
    RAISE EXCEPTION 'Employees can only recognize other employees.'
      USING ERRCODE = 'check_violation';
  ELSIF verdict IN ('unknown_nominee', 'unknown_nominator', 'incomplete') THEN
    RAISE EXCEPTION 'That person is no longer available to recognize.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Unreachable today. Present so that adding a verdict to Part B without
  -- adding a branch here fails closed rather than silently permitting it.
  RAISE EXCEPTION 'This recognition cannot be submitted.'
    USING ERRCODE = 'check_violation';
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.guard_nomination_eligibility() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS check_nomination_eligibility ON nominations;
CREATE TRIGGER check_nomination_eligibility
  BEFORE INSERT ON nominations
  FOR EACH ROW EXECUTE FUNCTION public.guard_nomination_eligibility();

COMMENT ON FUNCTION public.guard_nomination_eligibility() IS
  'Refuses a nomination whose nominee the nominator may not recognise. Runs before the rate limiter and the routing trigger, so a refused attempt creates nothing.';


-- ============================================================
-- PART D -- the same rule in the row-level policy
--
-- The second gate. Every condition from 022's version of this policy is
-- carried over unchanged; the eligibility test is added at the end.
--
-- nominator_id != nominee_id is kept even though recognition_eligibility()
-- also returns 'self' for that pair. It is the existing self-recognition
-- protection and it is not being replaced by something newer -- it now has a
-- second opinion, which is the point.
-- ============================================================

ALTER POLICY "nominations_insert" ON nominations
  WITH CHECK (
    public.session_second_factor_ok()
    AND auth.role() = 'authenticated'
    AND nominator_id = (auth.jwt()->>'employee_id')::uuid
    AND nominator_id != nominee_id
    AND public.recognition_eligibility(nominator_id, nominee_id) = 'ok'
  );


-- ============================================================
-- PART E -- the nominee search, scoped by the CALLER'S OWN role
--
-- Replaces the browser-built query behind the wizard's "who do you want to
-- recognize?" box. That query filtered on is_active and excluded the caller's
-- own id -- and both of those came from the client, as did the absence of any
-- role filter. Which candidates are eligible is not a browser decision, so the
-- browser no longer makes it: it sends a search term and nothing else.
--
-- There is no role parameter, and adding one would be the bug. The caller's
-- role comes from current_employee_role() (022), which reads `employees` and
-- returns NULL for a session that has not passed the emailed code -- so an
-- unverified session matches nothing here rather than everything.
--
-- SECURITY INVOKER, like selectable_recognition_projects() (030) and
-- managed_projects() (040): it grants nothing. Every row it returns is one
-- employees_read_active already allows this caller to read. It NARROWS that
-- set, cannot widen it, and narrows further automatically if that policy is
-- ever tightened.
--
-- This is an alignment and a convenience, NOT the enforcement point. Part C is.
-- ============================================================

CREATE OR REPLACE FUNCTION public.recognition_candidates(p_term text)
RETURNS SETOF employees
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $fn$
  SELECT e.*
    FROM employees e
   WHERE e.is_active
     -- Under two characters the wizard wants nothing, not everybody.
     AND length(btrim(COALESCE(p_term, ''))) >= 2
     -- Never yourself. NULL when the session has no employee record, which
     -- makes the predicate NULL and returns no rows.
     AND e.id <> public.employee_id()
     -- The rule, from Part A, applied to the caller's real role.
     AND public.role_may_recognize(public.current_employee_role(), e.role)
     AND (
          e.full_name   ILIKE '%' || btrim(p_term) || '%'
       OR e.email       ILIKE '%' || btrim(p_term) || '%'
       OR e.employee_id ILIKE '%' || btrim(p_term) || '%'
     )
   ORDER BY e.full_name
   LIMIT 8;
$fn$;

REVOKE EXECUTE ON FUNCTION public.recognition_candidates(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.recognition_candidates(text) TO authenticated;

COMMENT ON FUNCTION public.recognition_candidates(text) IS
  'Active people the CALLER may recognise, matching a search term. Takes a term and nothing else -- the eligibility rule is applied from the caller''s own role, read from employees. SECURITY INVOKER: RLS still applies.';
