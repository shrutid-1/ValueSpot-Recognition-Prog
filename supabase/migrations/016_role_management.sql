-- ============================================================
-- Migration 016: Change roles from inside the app  ** RUN THIS **
--
-- Idempotent and self-contained. Safe to run more than once.
-- Requires 011-015.
--
-- Two problems, one fix
-- ---------------------
-- 1. Handing Super Admin to somebody else required editing the database by
--    hand. That is not something a non-technical HR team can be asked to do,
--    and an administrator who cannot hand over is a single point of failure —
--    when they leave the company, nobody can appoint their replacement.
--
-- 2. Roles were writable straight from the browser. employees_hr_write is
--    FOR ALL, so any hr_admin could PATCH their own row to 'super_admin' and
--    route around the access-code hierarchy entirely. The role dropdown simply
--    not offering the option is not a control; anyone can call the REST API.
--
-- Both are fixed by making set_employee_role() the only way a role can change,
-- and enforcing that with a trigger rather than with UI that can be bypassed.
--
-- Who may set what
-- ----------------
--   super_admin  ->  any role, including granting and revoking super_admin
--   hr_admin     ->  'employee' and 'manager' only
--   anyone else  ->  nothing
--
-- So HR still runs the org chart day to day, but cannot promote itself to the
-- top. Only a super admin appoints another super admin.
--
-- The system refuses to leave itself with no administrator: demoting or
-- deactivating the last super_admin is rejected. Appoint the replacement
-- first, then step down.
--
-- Every change is written to audit_logs, so who granted or revoked
-- administrator access, to whom, and when, is answerable after the fact. It
-- appears in HR -> Audit Logs alongside everything else.
-- ============================================================


-- ── 1. The only supported way to change a role ──────────────

CREATE OR REPLACE FUNCTION public.set_employee_role(
  p_employee_id uuid,
  p_role        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text := public.current_employee_role();
  caller_id   uuid;
  target      employees%ROWTYPE;
  admin_count integer;
BEGIN
  IF caller_role IS NULL THEN
    RETURN jsonb_build_object('status', 'not_authenticated');
  END IF;

  IF p_role NOT IN ('employee', 'manager', 'hr_admin', 'super_admin') THEN
    RETURN jsonb_build_object('status', 'invalid_role');
  END IF;

  -- HR runs the org chart, but the top two rungs are a super admin's to give.
  IF caller_role = 'hr_admin' AND p_role NOT IN ('employee', 'manager') THEN
    RETURN jsonb_build_object('status', 'forbidden', 'reason', 'needs_super_admin');
  END IF;
  IF caller_role NOT IN ('hr_admin', 'super_admin') THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  SELECT * INTO target FROM employees WHERE id = p_employee_id;
  IF target.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- An hr_admin must not be able to rewrite a super admin's record either.
  IF caller_role = 'hr_admin' AND target.role IN ('hr_admin', 'super_admin') THEN
    RETURN jsonb_build_object('status', 'forbidden', 'reason', 'needs_super_admin');
  END IF;

  IF target.role = p_role THEN
    RETURN jsonb_build_object('status', 'ok', 'role', p_role, 'unchanged', true);
  END IF;

  -- Never leave the system without an administrator. Checked here rather than
  -- trusted to the UI, because this is the one mistake with no way back.
  IF target.role = 'super_admin' AND p_role <> 'super_admin' THEN
    SELECT count(*) INTO admin_count
      FROM employees
     WHERE role = 'super_admin' AND is_active AND auth_user_id IS NOT NULL;

    IF admin_count <= 1 THEN
      RETURN jsonb_build_object('status', 'last_admin');
    END IF;
  END IF;

  SELECT id INTO caller_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;

  -- Tells the guard trigger below that this change came through the front
  -- door. Transaction scoped, so it cannot leak into a later statement.
  PERFORM set_config('app.role_change_authorised', '1', true);
  UPDATE employees SET role = p_role WHERE id = p_employee_id;
  PERFORM set_config('app.role_change_authorised', '0', true);

  -- Audit trail. Written here rather than by a trigger so it records who asked
  -- and what they asked for, not merely that a row changed. audit_logs has no
  -- INSERT policy for authenticated users; this function is SECURITY DEFINER,
  -- which is exactly why an ordinary session cannot forge or erase an entry.
  -- Surfaces in HR -> Audit Logs with no extra work.
  INSERT INTO audit_logs (
    actor_id, actor_email, action, entity_type, entity_id,
    previous_value, new_value
  )
  VALUES (
    caller_id,
    lower(btrim(auth.jwt()->>'email')),
    CASE
      WHEN p_role      = 'super_admin' THEN 'super_admin.granted'
      WHEN target.role = 'super_admin' THEN 'super_admin.revoked'
      ELSE 'employee.role_changed'
    END,
    'employee',
    p_employee_id,
    jsonb_build_object('role', target.role, 'full_name', target.full_name,
                       'email', target.email),
    jsonb_build_object('role', p_role,      'full_name', target.full_name,
                       'email', target.email)
  );

  RETURN jsonb_build_object(
    'status',        'ok',
    'role',          p_role,
    'previous_role', target.role,
    'self',          (caller_id = p_employee_id)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_employee_role(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_employee_role(uuid, text) TO authenticated;


-- ── 2. Close the direct-write escalation path ───────────────
--
-- Without this the function above is advisory: employees_hr_write is FOR ALL,
-- so an hr_admin could still PATCH /rest/v1/employees and set their own role.
-- The trigger makes the rule structural instead of cosmetic.

CREATE OR REPLACE FUNCTION public.guard_employee_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN

    -- The SQL Editor, migrations and the service role have no end-user
    -- identity. They are already trusted — reaching them means owning the
    -- project — and they remain the escape hatch if the app ever locks itself
    -- out. Only browser sessions are constrained here.
    IF auth.uid() IS NULL THEN
      RETURN NEW;
    END IF;

    -- Came through set_employee_role().
    IF COALESCE(current_setting('app.role_change_authorised', true), '0') = '1' THEN
      RETURN NEW;
    END IF;

    -- First link of an unclaimed record, which is how the founding
    -- administrator adopts an existing row in claim_employee_account().
    IF OLD.auth_user_id IS NULL AND NEW.auth_user_id = auth.uid() THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'Roles are changed with set_employee_role(), not by writing to this table.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_employee_role_change ON employees;
CREATE TRIGGER guard_employee_role_change
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION public.guard_employee_role_change();


-- ── 3. Do not deactivate the last administrator either ──────
--
-- Demotion is not the only way to end up with nobody in charge.

CREATE OR REPLACE FUNCTION public.guard_last_admin_active()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_count integer;
BEGIN
  IF OLD.is_active AND NOT NEW.is_active AND OLD.role = 'super_admin' THEN
    IF auth.uid() IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT count(*) INTO admin_count
      FROM employees
     WHERE role = 'super_admin' AND is_active AND auth_user_id IS NOT NULL
       AND id <> OLD.id;

    IF admin_count = 0 THEN
      RAISE EXCEPTION
        'This is the only administrator. Appoint another one before deactivating this account.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_last_admin_active ON employees;
CREATE TRIGGER guard_last_admin_active
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_admin_active();


-- ── 4. Who the administrators are ───────────────────────────
--
-- So the Employees screen can show "you are handing over to X" honestly, and
-- warn when only one administrator remains.

CREATE OR REPLACE FUNCTION public.list_administrators()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text := public.current_employee_role();
BEGIN
  IF caller_role IS NULL OR caller_role NOT IN ('hr_admin', 'super_admin') THEN
    RETURN jsonb_build_object('status', 'forbidden', 'admins', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'admins', COALESCE((
      SELECT jsonb_agg(a ORDER BY a.full_name)
        FROM (
          SELECT id, full_name, email, is_active,
                 (auth_user_id IS NOT NULL) AS can_sign_in
            FROM employees
           WHERE role = 'super_admin'
        ) a
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_administrators() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_administrators() TO authenticated;
