-- ============================================================
-- 055 -- clearing the audit log, Super Admin only
--
-- WHAT THIS ADDS
-- --------------
-- One function:
--
--   clear_audit_log()  deletes every row in audit_logs, then writes a single
--                      'audit_log.cleared' row saying who cleared it and how
--                      many entries went.
--
-- WHY A FUNCTION
-- --------------
-- audit_logs has no DELETE policy, and stays that way: no session can delete
-- from it directly. This SECURITY DEFINER function is the one way to do it,
-- and it decides who may -- a Super Admin whose session has completed its
-- second sign-in step. HR can read the log but not clear it.
--
-- The role is read from `employees`, not trusted from the JWT, the same way
-- adjust_value_coins() does in 050: a role revoked a minute ago must not
-- still be able to wipe the trail on the strength of an old token.
--
-- WHY IT LEAVES ONE ROW BEHIND
-- ----------------------------
-- A cleared log that shows nothing would hide that it was cleared at all.
-- The new first entry records the actor, their email and the count removed,
-- in the same transaction as the delete, so the two cannot come apart.
--
-- The typed eight-digit code on the Audit Logs screen is a guard against a
-- misclick, generated in the browser. It is deliberately not checked here:
-- the authority is the role, and a code the client invents proves nothing
-- to the server.
-- ============================================================

CREATE OR REPLACE FUNCTION public.clear_audit_log()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  actor      UUID := (auth.jwt()->>'employee_id')::uuid;
  actor_role TEXT;
  removed    INTEGER := 0;
BEGIN
  IF NOT public.session_second_factor_ok() THEN
    RAISE EXCEPTION 'This session has not completed its second step.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT role INTO actor_role FROM employees WHERE id = actor AND is_active;

  IF actor_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only a Super Admin can clear the audit log.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- WHERE true: some Postgres setups refuse an unqualified DELETE.
  DELETE FROM audit_logs WHERE true;
  GET DIAGNOSTICS removed = ROW_COUNT;

  INSERT INTO audit_logs (
    actor_id, actor_email, action, entity_type, entity_id, previous_value, new_value
  )
  VALUES (
    actor,
    lower(btrim(auth.jwt()->>'email')),
    'audit_log.cleared',
    'audit_log',
    NULL,
    jsonb_build_object('entries', removed),
    jsonb_build_object('entries', 0, '_actor_role', actor_role)
  );

  RETURN jsonb_build_object('status', 'ok', 'removed', removed);
END;
$fn$;

COMMENT ON FUNCTION public.clear_audit_log() IS
  'Deletes every audit log entry and records the clearing as the first new entry. Super Admin only, with a completed second sign-in step.';

REVOKE EXECUTE ON FUNCTION public.clear_audit_log() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.clear_audit_log() TO authenticated;
