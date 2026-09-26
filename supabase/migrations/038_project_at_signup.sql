-- ============================================================
-- 038 -- the project is chosen while CREATING the account
--
-- The same shape as 031/032 did for the department, for the same reason: the
-- question belongs on the create-account form, beside the name and the email,
-- rather than as manual work HR does afterwards for every new joiner.
--
-- Two functions, mirroring that pair exactly:
--
--   signup_projects()   the list, readable before there is an account
--   set_own_project()   the write, resolving the caller from their session
--
-- WHAT THIS DOES NOT CHANGE
-- -------------------------
-- HR and Super Admin keep every power they had. setEmployeeProject() (029),
-- the Projects screen and the employee dialog are untouched; this only fills
-- the gap BEFORE they get there. Every write below is a gap-filling write --
-- it declines rather than overwrites whenever an assignment already exists,
-- so an administrator's decision always wins over a self-declared one.
--
-- Recognition approval routing is untouched. The project a recognition is
-- filed against is still chosen by the recognizer in the wizard and the
-- approver is still re-derived by route_nomination_to_project_manager() (030).
-- Where an employee happens to work has never decided either, and does not
-- start to here.
--
--
-- THE TWO RELATIONSHIPS ARE DIFFERENT, AND STAY DIFFERENT
-- ------------------------------------------------------
--   An employee belongs to a project   project_members
--   A manager runs a project           projects.manager_id
--
-- set_own_project() picks between them by reading the caller's role FROM THE
-- EMPLOYEES TABLE, never from an argument. The browser supplies a project id
-- and nothing else; it cannot say which relationship to write, and it cannot
-- say who it is.
--
-- employees.manager_id is NOT touched. It has been deprecated for this purpose
-- since 030 and nothing here revives it.
--
--
-- WHY A MANAGER IS OFFERED ONLY UNMANAGED PROJECTS
-- ------------------------------------------------
-- Because taking a project off its current manager is an administrative act.
--
-- guard_project_manager() (029) already refuses to leave an ACTIVE project
-- without a manager, and the Projects screen requires one on create, so on a
-- well-tended workspace most projects are already managed and this list is
-- short or empty. That is the correct outcome, not a defect: a newly invited
-- Manager should not be able to displace a colleague by choosing a dropdown
-- entry. Where the list is empty the form simply does not ask, and HR assigns
-- the project as they do today.
--
-- Manager-less active projects genuinely exist -- 004_demo_data.sql seeds five
-- of them, and 029 chose a trigger over a NOT NULL constraint precisely so
-- they could continue to -- so the list is not dead code.
--
-- A takeover attempt is refused explicitly (`project_has_manager`) rather than
-- silently ignored, so the form can say who to ask.
--
--
-- WHY set_own_project IS SAFE TO EXPOSE TO authenticated
-- -----------------------------------------------------
-- It takes one argument, a project id. It cannot be pointed at another person:
-- the employee row comes from auth.uid(). It cannot be used to change an
-- existing assignment: both branches write only into an empty slot. It cannot
-- be used to gain a role: the role is read, never written. And it requires the
-- second factor, like every other authenticated write since 022.
-- ============================================================


-- ============================================================
-- PART A -- the list, before there is an account
--
-- Same reasoning as signup_departments() in 032: `projects` is readable only
-- by an authenticated, second-factor-verified session (001, tightened by 022),
-- which someone part-way through creating an account is not. Without this the
-- dropdown would be empty for exactly the people who need it.
--
-- WHAT THIS DISCLOSES TO anon
-- ---------------------------
-- The NAMES of active projects. Not the description, not the code, not the
-- manager, not the members, not inactive or archived ones.
--
-- Accepted on the same terms 032 accepted department names: a project name is
-- not a secret inside this product -- it appears on recognitions, in the
-- wizard and on reports -- and nothing keys off it for access. If that trade
-- is ever unwanted the fix is the same one 032 names: move the question behind
-- the emailed code, where ordinary RLS already works, and drop this function.
--
-- THE ARGUMENT
-- ------------
-- p_for_manager only narrows: it returns the subset of the same active
-- projects that have no manager. A caller who lies about it learns strictly
-- less than the default already tells them, so there is nothing to gain by
-- steering it. It exists so the manager form does not have to be sent rows it
-- must then refuse.
-- ============================================================

CREATE OR REPLACE FUNCTION public.signup_projects(p_for_manager boolean DEFAULT false)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  -- COALESCE so an empty result is [] rather than NULL: the form treats "no
  -- projects to offer" as "do not ask", and that has to be a value it can read.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('id', p.id, 'name', p.name)
      ORDER BY p.name
    ),
    '[]'::jsonb
  )
  FROM projects p
  WHERE p.is_active
    AND (NOT p_for_manager OR p.manager_id IS NULL);
$fn$;

COMMENT ON FUNCTION public.signup_projects(boolean) IS
  'Active project names for the create-account form. With p_for_manager, only those with no Project Manager. Names only -- never members, managers or inactive projects.';

-- anon is granted DELIBERATELY: the caller has no account yet. See above for
-- exactly what that discloses.
REVOKE EXECUTE ON FUNCTION public.signup_projects(boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.signup_projects(boolean) TO anon, authenticated;


-- ============================================================
-- PART B -- the write, from the session
--
-- Called at the end of registration, in the same breath as
-- claim_employee_account(), exactly where set_own_department() is called.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_own_project(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid      uuid := auth.uid();
  emp      employees%ROWTYPE;
  proj     projects%ROWTYPE;
  existing uuid;
  affected integer;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('status', 'not_authenticated');
  END IF;

  IF NOT public.session_second_factor_ok() THEN
    RETURN jsonb_build_object('status', 'needs_verification');
  END IF;

  IF p_project_id IS NULL THEN
    RETURN jsonb_build_object('status', 'project_required');
  END IF;

  -- An inactive project is not something the form offers, so arriving with one
  -- means the list went stale mid-answer, or the call was made by hand.
  SELECT * INTO proj FROM projects WHERE id = p_project_id AND is_active;
  IF proj.id IS NULL THEN
    RETURN jsonb_build_object('status', 'unknown_project');
  END IF;

  -- WHO IS CALLING. From the session and the table -- never from an argument.
  SELECT * INTO emp FROM employees WHERE auth_user_id = uid LIMIT 1;

  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('status', 'no_employee_record');
  END IF;

  IF NOT emp.is_active THEN
    RETURN jsonb_build_object('status', 'inactive');
  END IF;


  -- ── A Manager runs a project ────────────────────────────
  IF emp.role = 'manager' THEN

    -- Already theirs: the ordinary case where HR named them when creating the
    -- project, before they had ever signed in. Nothing to do, and not an error.
    IF proj.manager_id = emp.id THEN
      RETURN jsonb_build_object(
        'status', 'unchanged', 'relationship', 'manager', 'project', proj.name);
    END IF;

    -- Somebody else's. Refused, and said out loud: reassigning a project is
    -- HR's to do, and 029 gives no one else the right to.
    IF proj.manager_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'status', 'project_has_manager', 'project', proj.name);
    END IF;

    -- The gap-filling write. `manager_id IS NULL` in the WHERE is the whole
    -- guarantee: if anyone claimed it between the check above and here, this
    -- writes nothing rather than overwriting them.
    --
    -- guard_project_manager() (029) still runs on this UPDATE and still
    -- enforces that the manager is an active employee holding the Manager
    -- role. This function does not repeat that check; it relies on it.
    UPDATE projects
       SET manager_id = emp.id
     WHERE id = proj.id
       AND manager_id IS NULL;

    GET DIAGNOSTICS affected = ROW_COUNT;

    IF affected = 0 THEN
      RETURN jsonb_build_object(
        'status', 'project_has_manager', 'project', proj.name);
    END IF;

    RETURN jsonb_build_object(
      'status', 'ok', 'relationship', 'manager', 'project', proj.name);
  END IF;


  -- ── Everyone else belongs to a project ──────────────────
  --
  -- MVP rule, unchanged: at most one active membership per employee, enforced
  -- by idx_project_members_one_active_per_employee (029). This does not
  -- introduce that rule and does not relax it -- it writes only when the slot
  -- is empty, so HR's assignment is never displaced and the index is never
  -- challenged.

  SELECT project_id INTO existing
    FROM project_members
   WHERE employee_id = emp.id AND is_active
   LIMIT 1;

  IF existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', CASE WHEN existing = proj.id THEN 'unchanged' ELSE 'already_assigned' END,
      'relationship', 'member',
      'project', (SELECT name FROM projects WHERE id = existing));
  END IF;

  /*
    ON CONFLICT DO NOTHING covers the row this person may already have for
    this project on this same date, left inactive by a previous assignment --
    UNIQUE(project_id, employee_id, joined_at) treats that as the same row.
    Reviving it is the correct reading, and is what setEmployeeProject() does.
  */
  INSERT INTO project_members (project_id, employee_id, is_active)
  VALUES (proj.id, emp.id, true)
  ON CONFLICT (project_id, employee_id, joined_at)
  DO UPDATE SET is_active = true, left_at = NULL;

  RETURN jsonb_build_object(
    'status', 'ok', 'relationship', 'member', 'project', proj.name);
END;
$fn$;

COMMENT ON FUNCTION public.set_own_project(uuid) IS
  'Records the project chosen during account creation. Writes projects.manager_id for a Manager and project_members for everyone else, choosing by the caller''s own role. Gap-filling only: never displaces an assignment HR has already made.';

REVOKE EXECUTE ON FUNCTION public.set_own_project(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_own_project(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- Verification
--
-- Printed when the migration runs. Same shape as 026/027/031/032: one row,
-- every boolean expected true.
-- ============================================================
SELECT '038 APPLIED' AS check,
       EXISTS (SELECT 1 FROM pg_proc
                WHERE pronamespace = 'public'::regnamespace
                  AND proname = 'signup_projects')                      AS list_installed,
       EXISTS (SELECT 1 FROM pg_proc
                WHERE pronamespace = 'public'::regnamespace
                  AND proname = 'set_own_project')                      AS write_installed,
       -- Active projects only, in both modes.
       (SELECT pg_get_functiondef(oid) LIKE '%p.is_active%'
          FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'signup_projects')                             AS active_only,
       has_function_privilege('anon', 'public.signup_projects(boolean)', 'EXECUTE')
                                                                        AS anon_can_list,
       -- The write stays shut to anon.
       NOT has_function_privilege('anon', 'public.set_own_project(uuid)', 'EXECUTE')
                                                                        AS anon_cannot_write,
       -- 029's guard is still the thing deciding who may manage a project.
       EXISTS (SELECT 1 FROM pg_trigger
                WHERE tgname = 'guard_project_manager'
                  AND NOT tgisinternal)                                 AS project_guard_intact,
       -- The MVP one-active-project rule is untouched.
       EXISTS (SELECT 1 FROM pg_indexes
                WHERE schemaname = 'public'
                  AND indexname = 'idx_project_members_one_active_per_employee')
                                                                        AS one_project_rule_intact,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')    AS policies_untouched;
-- EXPECT every boolean true. anon_can_list is true ON PURPOSE. No policy is
-- created, altered or dropped here: both functions read past RLS as their
-- definer rather than relaxing it.


-- ============================================================
-- ROLLBACK
--
--   DROP FUNCTION IF EXISTS public.signup_projects(boolean);
--   DROP FUNCTION IF EXISTS public.set_own_project(uuid);
--
-- Nothing else is created. Associations already written are ordinary
-- project_members rows and projects.manager_id values, indistinguishable from
-- ones HR made by hand, and are left alone.
-- ============================================================
