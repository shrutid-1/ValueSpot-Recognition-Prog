-- ============================================================
-- 030 -- the recognizer CHOOSES the project
--
-- WHAT THIS CORRECTS IN 029
-- -------------------------
-- 029 made the project an inference: a recognition had to be filed against the
-- NOMINEE'S own active project, and the wizard resolved it automatically and
-- showed it read-only. That is the wrong rule.
--
-- The recognizer chooses the project explicitly. A recognition is about work
-- done ON a project, and the person best placed to say which project that was
-- is the person who witnessed it — not a lookup of where the nominee happens
-- to be assigned. The two are frequently different, which is exactly the case
-- 029 refused.
--
-- So the nominee-membership requirement is REMOVED here.
--
-- WHAT DOES NOT CHANGE
-- --------------------
-- The security property is untouched and remains the whole point:
--
--     the browser names a PROJECT; the database derives the APPROVER
--
-- route_nomination_to_project_manager() still overwrites
-- NEW.assigned_approver_id from the selected project's manager, discarding
-- whatever the client sent. Dropping the membership check widens which
-- projects may be chosen; it does not hand the caller any say over who
-- approves. Choosing a project is a business choice. Choosing an approver is
-- not, and still cannot be done.
--
-- WHY THE MEMBERSHIP CHECK WAS NOT THE SECURITY BOUNDARY
-- -----------------------------------------------------
-- It is worth being precise, because 029's comment overstated it. Tying the
-- project to the nominee narrowed the set of reachable approvers, but it never
-- prevented approver spoofing — the overwrite does that, on its own. Every
-- project still has exactly one manager, and the caller still cannot pick
-- which. What remains enforced is that the project is real, active, and has a
-- usable Project Manager.
--
-- WHY A NEW MIGRATION RATHER THAN EDITING 029
-- -------------------------------------------
-- 029 is applied. This project's rule is that an applied migration is history
-- and is never rewritten to change behaviour. CREATE OR REPLACE on the
-- function is the supported way to change it.
-- ============================================================


-- ============================================================
-- The routing trigger, without the nominee-membership requirement.
--
-- Everything else is carried over from 029 deliberately and unchanged:
-- the identity-less escape hatch for seeders, the project validity checks,
-- the approver overwrite, the HR fallback when the manager is a party, and
-- the project-name snapshot.
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
  fallback_id uuid;
BEGIN
  -- Trusted, identity-less callers keep whatever they supplied: the CLI
  -- applying seed files, the service-role seeder, a migration, the SQL editor.
  -- Same escape hatch as guard_employee_role_insert() in 026.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.project_id IS NULL THEN
    RAISE EXCEPTION
      'Choose the project this recognition relates to.'
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

  /*
    NO nominee-membership check. Removed from 029 on purpose -- see the header.
    A recognition may be filed against any active project; who approves it is
    still decided below, from the project, and never by the caller.
  */

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

  IF mgr.role <> 'manager' THEN
    RAISE EXCEPTION
      'The Project Manager for that project no longer holds the Manager role. Ask HR to assign one.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- THE ROUTING DECISION. Whatever the client sent is discarded here.
  NEW.assigned_approver_id := mgr.id;
  NEW.escalation_level     := 0;

  /*
    The project manager cannot review their own recognition, nor one they
    wrote. Falls back to HR as the pre-project implementation did: the
    configured approver first, then any active HR admin who is not a party.
  */
  IF mgr.id = NEW.nominee_id OR mgr.id = NEW.nominator_id THEN
    SELECT (value #>> '{}')::uuid
      INTO fallback_id
      FROM app_config
     WHERE key = 'hr_fallback_employee_id'
       AND (value #>> '{}') ~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

    IF fallback_id IS NULL
       OR fallback_id = NEW.nominee_id
       OR fallback_id = NEW.nominator_id
       OR NOT EXISTS (SELECT 1 FROM employees WHERE id = fallback_id AND is_active)
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

COMMENT ON FUNCTION public.route_nomination_to_project_manager() IS
  'Derives a nomination''s approver from the SELECTED project''s manager, overwriting any client-supplied value. The recognizer chooses the project; the database chooses the approver.';


-- ============================================================
-- Projects a recognition may be filed against.
--
-- Every ACTIVE project with a usable Project Manager. Not the nominee's, and
-- not the recognizer's: the choice is the recognizer's to make.
--
-- Why "any active project": it is what the product did before 029 (the wizard
-- offered every active project), it is what the corrected rule asks for, and
-- project_members has never been the gate — it holds no rows outside what HR
-- has entered since it was surfaced.
--
-- The manager is returned alongside so the wizard can CONFIRM who will approve
-- before submission. That is display only; the trigger above re-derives it.
--
-- SECURITY INVOKER: shows the caller exactly what their own policies allow.
-- ============================================================

CREATE OR REPLACE FUNCTION public.selectable_recognition_projects()
RETURNS TABLE (
  project_id   uuid,
  project_name text,
  manager_id   uuid,
  manager_name text
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $fn$
  SELECT p.id, p.name, m.id, m.full_name
    FROM projects p
    JOIN employees m ON m.id = p.manager_id
   WHERE p.is_active
     AND m.is_active
     AND m.role = 'manager'
   ORDER BY p.name;
$fn$;

REVOKE EXECUTE ON FUNCTION public.selectable_recognition_projects() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.selectable_recognition_projects() TO authenticated;

COMMENT ON FUNCTION public.selectable_recognition_projects() IS
  'Active projects with a usable Project Manager -- what the recognition wizard may offer.';


-- ============================================================
-- employees.manager_id is now DEPRECATED for the recognition workflow.
--
-- Deliberately NOT dropped:
--
--   * nominations.snapshot_nominee_manager_id records who the nominee reported
--     to at the time of past recognitions. Dropping the column it mirrors
--     would strand that history.
--   * The column is referenced by existing rows and by the directory's org
--     data. Removing it is a data decision, not a routing one.
--
-- What changes is that nothing in the recognition path reads it any more, and
-- the HR/Super Admin employee forms no longer write it. Managers relate to
-- PROJECTS now. "A manager's team" is derived from the projects they manage.
-- ============================================================

COMMENT ON COLUMN public.employees.manager_id IS
  'DEPRECATED for recognition approval (migration 030). Managers relate to projects, not employees. Retained for historical records and existing org data; no longer written by the employee admin forms.';
