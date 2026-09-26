-- ============================================================
-- 029 -- Project-based approval routing
--
-- WHAT CHANGES
-- ------------
-- A recognition's approver is now the MANAGER OF THE PROJECT the recognition
-- is filed against, not the nominee's line manager.
--
--   recognizer -> nominee -> selected project -> project manager -> approval
--
-- WHY THIS IS A DATABASE CHANGE AND NOT A FRONTEND ONE
-- ---------------------------------------------------
-- Until now `assigned_approver_id` was computed IN THE BROWSER, by walking the
-- nominee's manager chain, and sent as part of the INSERT. The row-level
-- policy on `nominations` constrains who may insert and who they may name as
-- nominator, but it never constrained that column -- so a modified client
-- could name ANY approver, including the nominator themselves, and the
-- notification trigger would dutifully deliver the request there.
--
-- Routing therefore has to be decided by the database. The trigger below
-- OVERWRITES whatever the client sent. There is no argument, column or claim
-- a browser can set that changes which manager receives the request.
--
-- ONE AUTHORITATIVE ROUTING RULE
-- ------------------------------
-- Everything downstream already keys off `nominations.assigned_approver_id`:
--
--   * notify_nomination_submitted (009) sends the approval notification
--   * the approver RLS policies (003, 022) decide who may act on the row
--   * process-approval (Edge Function) checks it before approving
--   * the manager dashboard and approval queue filter on it
--
-- So setting that ONE column correctly, at INSERT, routes every one of them.
-- None of those call sites is changed by this migration -- deliberately.
--
-- HISTORICAL INTEGRITY
-- --------------------
-- `assigned_approver_id` is written once, at submission, and never recomputed.
-- Re-pointing a project at a different manager afterwards does not move
-- recognitions that are already in flight: they keep the approver they were
-- routed to. New recognitions route to the new manager. This is the same
-- write-once discipline the snapshot_* columns already use.
--
-- SEEDERS AND MIGRATIONS
-- ----------------------
-- Every guard here uses the established escape hatch: when auth.uid() IS NULL
-- the caller is trusted and identity-less (the CLI applying seed files, the
-- service-role seeder, a migration, the SQL editor). Same rule as
-- guard_employee_role_insert() in 026. Demo nominations without a project
-- therefore still seed.
-- ============================================================


-- ============================================================
-- PART A -- one active project per employee
--
-- The MVP rule. project_members already models employee <-> project with an
-- is_active flag; it was simply never used. A partial unique index is the
-- whole enforcement: the database will not hold two active rows for one
-- person, so "their active project" is always a single answer.
-- ============================================================

-- Defensive: the table is empty today, but never assume. Keep the most
-- recently joined active row per employee and stand the rest down.
UPDATE project_members pm
   SET is_active = false,
       left_at   = COALESCE(pm.left_at, CURRENT_DATE)
 WHERE pm.is_active
   AND pm.id <> (
     SELECT keep.id
       FROM project_members keep
      WHERE keep.employee_id = pm.employee_id
        AND keep.is_active
      ORDER BY keep.joined_at DESC, keep.created_at DESC, keep.id DESC
      LIMIT 1
   );

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_members_one_active_per_employee
  ON project_members (employee_id)
  WHERE is_active;

COMMENT ON INDEX idx_project_members_one_active_per_employee IS
  'MVP rule: an employee has at most one active project at a time.';


-- ============================================================
-- PART B -- a project must name an eligible manager
--
-- Not a NOT NULL constraint: the demo projects seeded by 004_demo_data.sql
-- carry no manager, and adding NOT NULL would fail against any database that
-- has them. A trigger lets those rows continue to exist while making them
-- unusable for routing (Part C refuses them with a clear message) and forcing
-- a manager the moment HR next saves one.
--
-- ELIGIBILITY: role = 'manager'.
-- The brief says "for the MVP, use the existing Manager role". Note this is
-- NARROWER than employeesApi.listPotentialManagers(), which also offers
-- hr_admin for the line-manager field. Widening later is a one-line change
-- here; narrowing later would orphan projects, so the strict reading is the
-- safer default. See the implementation report.
-- ============================================================

CREATE OR REPLACE FUNCTION public.guard_project_manager()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  mgr employees%ROWTYPE;
BEGIN
  -- Trusted, identity-less callers: seeders, migrations, SQL editor.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- An archived project needs no manager; it cannot be used for routing.
  IF TG_OP = 'UPDATE' AND NOT NEW.is_active THEN
    RETURN NEW;
  END IF;

  IF NEW.manager_id IS NULL THEN
    RAISE EXCEPTION 'A project must have a Project Manager.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO mgr FROM employees WHERE id = NEW.manager_id;

  IF mgr.id IS NULL THEN
    RAISE EXCEPTION 'That Project Manager does not exist.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT mgr.is_active THEN
    RAISE EXCEPTION 'That Project Manager account is deactivated.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF mgr.role <> 'manager' THEN
    RAISE EXCEPTION 'A Project Manager must hold the Manager role.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS guard_project_manager ON projects;
CREATE TRIGGER guard_project_manager
  BEFORE INSERT OR UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_manager();


-- ============================================================
-- PART C -- route the nomination to the project's manager
--
-- This is the security boundary. It runs BEFORE INSERT and assigns
-- NEW.assigned_approver_id itself, discarding whatever arrived from the
-- client.
-- ============================================================

CREATE OR REPLACE FUNCTION public.route_nomination_to_project_manager()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  proj        projects%ROWTYPE;
  mgr         employees%ROWTYPE;
  is_member   boolean;
  fallback_id uuid;
BEGIN
  -- Trusted, identity-less callers keep whatever they supplied. Demo data and
  -- historical back-fills predate this rule and must not be rewritten by it.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.project_id IS NULL THEN
    RAISE EXCEPTION
      'A recognition must name the project it relates to.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO proj FROM projects WHERE id = NEW.project_id;

  IF proj.id IS NULL THEN
    RAISE EXCEPTION 'That project does not exist.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT proj.is_active THEN
    RAISE EXCEPTION
      'That project is archived and cannot receive new recognitions.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The recognizer may only file against the NOMINEE's own active project.
  -- This is what stops someone routing a recognition to a manager of their
  -- choosing by naming an unrelated project.
  SELECT EXISTS (
    SELECT 1 FROM project_members pm
     WHERE pm.employee_id = NEW.nominee_id
       AND pm.project_id  = NEW.project_id
       AND pm.is_active
  ) INTO is_member;

  IF NOT is_member THEN
    RAISE EXCEPTION
      'That is not the active project of the person being recognised.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF proj.manager_id IS NULL THEN
    RAISE EXCEPTION
      'That project has no Project Manager, so there is nobody to approve this. Ask HR to assign one.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO mgr FROM employees WHERE id = proj.manager_id;

  IF mgr.id IS NULL OR NOT mgr.is_active THEN
    RAISE EXCEPTION
      'The Project Manager for that project is not an active account. Ask HR to assign one.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- THE ROUTING DECISION. Whatever the client sent is discarded here.
  NEW.assigned_approver_id := mgr.id;
  NEW.escalation_level     := 0;

  /*
    The project manager cannot review their own recognition, nor one they
    wrote. Fall back to HR exactly as the previous chain-walk did -- the
    configured fallback first, then any active HR admin who is not a party.
    This preserves the existing fallback behaviour rather than replacing it.
  */
  IF mgr.id = NEW.nominee_id OR mgr.id = NEW.nominator_id THEN
    /*
      `value` is jsonb and is seeded as JSON null. Read it as text and accept
      it only if it actually looks like a uuid -- a misconfigured key should
      fall through to the HR search below, not raise a cast error at the
      person trying to submit a recognition.
    */
    SELECT (value #>> '{}')::uuid
      INTO fallback_id
      FROM app_config
     WHERE key = 'hr_fallback_employee_id'
       AND (value #>> '{}') ~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

    IF fallback_id IS NULL
       OR fallback_id = NEW.nominee_id
       OR fallback_id = NEW.nominator_id
       OR NOT EXISTS (
            SELECT 1 FROM employees
             WHERE id = fallback_id AND is_active
          )
    THEN
      SELECT e.id INTO fallback_id
        FROM employees e
       WHERE e.role = 'hr_admin'
         AND e.is_active
         AND e.id <> NEW.nominee_id
         AND e.id <> NEW.nominator_id
       ORDER BY e.created_at
       LIMIT 1;
    END IF;

    IF fallback_id IS NULL THEN
      RAISE EXCEPTION
        'This recognition cannot be routed: the Project Manager is involved in it and no HR approver is available.'
        USING ERRCODE = 'check_violation';
    END IF;

    NEW.assigned_approver_id := fallback_id;
    NEW.escalation_level     := 1;
  END IF;

  -- Keep the project name with the recognition, like the other snapshots, so
  -- the record still reads correctly if the project is later renamed.
  NEW.snapshot_project_name := COALESCE(NEW.snapshot_project_name, proj.name);

  RETURN NEW;
END;
$fn$;

/*
  Named to sort AFTER enforce_nomination_rate_limits (007): Postgres fires
  BEFORE triggers in name order, and there is no point resolving an approver
  for a submission the rate limiter is about to refuse.
*/
DROP TRIGGER IF EXISTS route_nomination_to_project_manager ON nominations;
CREATE TRIGGER route_nomination_to_project_manager
  BEFORE INSERT ON nominations
  FOR EACH ROW EXECUTE FUNCTION public.route_nomination_to_project_manager();


-- ============================================================
-- PART D -- the nominee's active project, for the recognition form
--
-- SECURITY INVOKER: this must show the caller exactly what their own policies
-- allow and nothing more. It exists so the wizard can ask one clear question
-- rather than assembling the join itself, not to widen any access.
-- ============================================================

CREATE OR REPLACE FUNCTION public.employee_active_project(p_employee_id uuid)
RETURNS TABLE (
  project_id      uuid,
  project_name    text,
  manager_id      uuid,
  manager_name    text,
  is_routable     boolean
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $fn$
  SELECT
    p.id,
    p.name,
    p.manager_id,
    m.full_name,
    -- Whether a recognition filed against it would actually route.
    (p.is_active AND m.id IS NOT NULL AND m.is_active AND m.role = 'manager')
  FROM project_members pm
  JOIN projects p   ON p.id = pm.project_id
  LEFT JOIN employees m ON m.id = p.manager_id
  WHERE pm.employee_id = p_employee_id
    AND pm.is_active
  LIMIT 1;
$fn$;

REVOKE EXECUTE ON FUNCTION public.employee_active_project(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.employee_active_project(uuid) TO authenticated;

COMMENT ON FUNCTION public.employee_active_project(uuid) IS
  'The one active project of an employee (MVP: at most one). SECURITY INVOKER -- RLS still applies.';
