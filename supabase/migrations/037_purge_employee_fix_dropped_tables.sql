-- ============================================================
-- Migration 037: purge_employee() must not reference dropped tables
--
-- 035 failed at runtime with:
--
--   relation "role_access_code_attempts" does not exist  (SQLSTATE 42P01)
--
-- THE MISTAKE
-- -----------
-- The erasure map in 035 was built by finding every table that references
-- employees(id) across the migration history. That finds every table ever
-- CREATED -- not the schema as it now stands. Migration 018 dropped both
-- access-code tables:
--
--   DROP TABLE IF EXISTS role_access_code_attempts;
--   DROP TABLE IF EXISTS role_access_codes;
--
-- and 035 referenced both. The schema is the NET of the migrations, not the
-- sum of their CREATE statements.
--
-- WHY IT SURFACED ONLY WHEN SOMEONE PRESSED DELETE
-- ------------------------------------------------
-- PL/pgSQL does not resolve table names when the function is created; it
-- resolves them the first time the statement runs. So 035 applied cleanly and
-- the function existed, broken, until it was called. Nothing was lost: the
-- function body is one transaction, so the failure rolled the whole erasure
-- back -- which is why the error correctly said "Nothing was changed".
--
-- WHAT CHANGES
-- ------------
-- Two statements are removed. Nothing else differs from 035, and the erasure
-- semantics documented there are unchanged -- the tables those statements
-- targeted have not existed since 018, so they were erasing nothing.
--
-- These were the only two casualties: 018 is the only migration that drops a
-- table, and no migration drops a column.
-- ============================================================


CREATE OR REPLACE FUNCTION public.purge_employee(
  p_employee_id uuid,
  p_actor_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor        employees%ROWTYPE;
  target       employees%ROWTYPE;
  admin_count  integer;
  nomination_ids uuid[];
  affected_nominees uuid[];
  removed_given    integer := 0;
  removed_received integer := 0;
BEGIN
  -- ── Who is asking ───────────────────────────────────────
  SELECT * INTO actor FROM employees WHERE id = p_actor_id;

  IF actor.id IS NULL OR NOT actor.is_active THEN
    RETURN jsonb_build_object('status', 'not_authenticated');
  END IF;

  IF actor.role NOT IN ('hr_admin', 'super_admin') THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  -- ── Who is being erased ─────────────────────────────────
  SELECT * INTO target FROM employees WHERE id = p_employee_id;

  IF target.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- Self-deletion is never a good outcome: it would log the actor out of an
  -- account that no longer exists, mid-transaction.
  IF target.id = actor.id THEN
    RETURN jsonb_build_object('status', 'cannot_delete_self');
  END IF;

  -- HR runs the org chart; administrators are a Super Admin's to remove.
  IF actor.role = 'hr_admin' AND target.role IN ('hr_admin', 'super_admin') THEN
    RETURN jsonb_build_object('status', 'forbidden', 'reason', 'needs_super_admin');
  END IF;

  -- Never leave the system without an administrator. guard_last_admin_active
  -- (016) only covers UPDATE, so a DELETE would walk straight past it.
  IF target.role = 'super_admin' THEN
    SELECT count(*) INTO admin_count
      FROM employees
     WHERE role = 'super_admin' AND is_active AND auth_user_id IS NOT NULL
       AND id <> target.id;

    IF admin_count = 0 THEN
      RETURN jsonb_build_object('status', 'last_admin');
    END IF;
  END IF;


  -- ── Everything they gave or received ────────────────────
  --
  -- Gathered first: the ids are needed to clear the tables that hang off a
  -- nomination, and the nominee list is needed to rebuild badge counts once
  -- the rows are gone.

  SELECT array_agg(id) INTO nomination_ids
    FROM nominations
   WHERE nominator_id = target.id OR nominee_id = target.id;

  nomination_ids := COALESCE(nomination_ids, ARRAY[]::uuid[]);

  SELECT count(*) INTO removed_given
    FROM nominations WHERE nominator_id = target.id;
  SELECT count(*) INTO removed_received
    FROM nominations WHERE nominee_id = target.id;

  -- Everyone whose own history shrinks because this person's recognitions go
  -- with them. The target is excluded -- their badge rows are deleted outright.
  SELECT COALESCE(array_agg(DISTINCT nominee_id), ARRAY[]::uuid[])
    INTO affected_nominees
    FROM nominations
   WHERE nominator_id = target.id
     AND nominee_id <> target.id;


  -- ── Children of those nominations ───────────────────────
  --
  -- Ahead of the nominations themselves: support requests are ON DELETE
  -- RESTRICT (034) and reward_assignments defaults to NO ACTION, so neither
  -- would yield to a cascade.

  DELETE FROM recognition_support_requests
   WHERE requester_id = target.id
      OR nomination_id = ANY(nomination_ids);

  UPDATE recognition_support_requests
     SET resolved_by_id = NULL
   WHERE resolved_by_id = target.id;

  DELETE FROM reward_assignments
   WHERE employee_id   = target.id
      OR assigned_by   = target.id       -- NOT NULL, so the row cannot stay
      OR nomination_id = ANY(nomination_ids);

  -- nomination_appreciations cascades from nominations, but the target's own
  -- appreciations of OTHER people's recognitions have to go explicitly.
  DELETE FROM nomination_appreciations
   WHERE employee_id = target.id
      OR nomination_id = ANY(nomination_ids);

  -- related_id carries no foreign key, so nothing would clean these up.
  -- Matched on the id alone rather than on related_type as well: the ids are
  -- uuids and cannot collide across entity types, and 034 writes notifications
  -- about a recognition under more than one type.
  DELETE FROM notifications
   WHERE recipient_id = target.id
      OR related_id = ANY(nomination_ids);


  -- ── The nominations ─────────────────────────────────────
  DELETE FROM nominations
   WHERE nominator_id = target.id OR nominee_id = target.id;

  -- Surviving recognitions may still name them as the approver or remover.
  UPDATE nominations SET assigned_approver_id = NULL WHERE assigned_approver_id = target.id;
  UPDATE nominations SET approved_by_id       = NULL WHERE approved_by_id       = target.id;
  UPDATE nominations SET rejected_by_id       = NULL WHERE rejected_by_id       = target.id;
  UPDATE nominations SET removed_by_id        = NULL WHERE removed_by_id        = target.id;


  -- ── Badges, flags, memberships ──────────────────────────
  DELETE FROM employee_value_badges WHERE employee_id = target.id;
  DELETE FROM badge_history         WHERE employee_id = target.id;

  DELETE FROM reciprocal_recognition_flags
   WHERE employee_a_id = target.id OR employee_b_id = target.id;
  UPDATE reciprocal_recognition_flags
     SET reviewed_by_id = NULL
   WHERE reviewed_by_id = target.id;

  DELETE FROM project_members WHERE employee_id = target.id;

  -- A project left without a manager cannot route approvals (029/030 refuse
  -- it with a clear message) until HR assigns a new one. Reported below so
  -- the caller can say so rather than leaving it to be discovered.
  UPDATE projects  SET manager_id = NULL WHERE manager_id = target.id;

  -- The deprecated line-manager link (030). Still present for legacy records.
  UPDATE employees SET manager_id = NULL WHERE manager_id = target.id;


  -- ── Rebuild what the deletion invalidated ───────────────
  --
  -- Counts are recomputed from the APPROVED recognitions that survive, inside
  -- each badge row's own period, and the level is re-derived from
  -- badge_definitions -- the same threshold rule calculate-badges applies
  -- (count >= minimum_count, and within maximum_count when it is set).
  --
  -- Rows are updated rather than deleted so that a badge which drops to no
  -- level still exists at zero, which is what the Edge Function would write.

  UPDATE employee_value_badges evb
     SET recognition_count       = fresh.cnt,
         unique_recognizer_count = fresh.recognizers,
         badge_level             = (
           SELECT bd.level FROM badge_definitions bd
            WHERE bd.is_active
              AND fresh.cnt >= bd.minimum_count
              AND (bd.maximum_count IS NULL OR fresh.cnt <= bd.maximum_count)
            ORDER BY bd.minimum_count DESC
            LIMIT 1
         ),
         last_updated = now()
    FROM (
      SELECT p.employee_id,
             p.core_value_id,
             p.period_type,
             p.period_start,
             count(n.id)                    AS cnt,
             count(DISTINCT n.nominator_id) AS recognizers
        FROM employee_value_badges p
        -- LEFT, so a badge whose every recognition has just been deleted is
        -- rewritten to zero rather than skipped and left overstating itself.
        LEFT JOIN nominations n
               ON n.nominee_id    = p.employee_id
              AND n.core_value_id = p.core_value_id
              AND n.status        = 'approved'
              AND n.approved_at  >= p.period_start::timestamptz
              AND n.approved_at   < (p.period_end + 1)::timestamptz
       WHERE p.employee_id = ANY(affected_nominees)
       GROUP BY p.employee_id, p.core_value_id, p.period_type, p.period_start
    ) AS fresh
   WHERE evb.employee_id   = fresh.employee_id
     AND evb.core_value_id = fresh.core_value_id
     AND evb.period_type   = fresh.period_type
     AND evb.period_start  = fresh.period_start;


  -- ── Sign-in trails ──────────────────────────────────────
  --
  -- Keyed by auth user id, with no foreign key to follow, so each is named.
  -- role_access_code_attempts belonged here until migration 018 dropped it.
  IF target.auth_user_id IS NOT NULL THEN
    DELETE FROM login_verifications WHERE user_id = target.auth_user_id;
    DELETE FROM login_code_sends    WHERE user_id = target.auth_user_id;
  END IF;

  -- invitation_sends.employee_id is ON DELETE CASCADE (027); sent_by is SET
  -- NULL. Both resolve themselves when the employee row goes.

  -- Kept deliberately. See 035's header.
  UPDATE audit_logs SET actor_id   = NULL WHERE actor_id   = target.id;
  UPDATE app_config SET updated_by = NULL WHERE updated_by = target.id;



  -- ── The record of the erasure ───────────────────────────
  --
  -- Written BEFORE the row goes, with the identity inline: entity_id will
  -- point at an employee that no longer exists, so the entry has to carry
  -- enough of the person to be readable on its own.
  INSERT INTO audit_logs (
    actor_id, actor_email, action, entity_type, entity_id,
    previous_value, new_value
  )
  VALUES (
    actor.id,
    actor.email,
    'employee.erased',
    'employee',
    target.id,
    jsonb_build_object(
      'full_name',   target.full_name,
      'email',       target.email,
      'employee_id', target.employee_id,
      'role',        target.role,
      'recognitions_given',    removed_given,
      'recognitions_received', removed_received
    ),
    NULL
  );


  -- ── The person ──────────────────────────────────────────
  DELETE FROM employees WHERE id = target.id;

  RETURN jsonb_build_object(
    'status',                'ok',
    'employee_id',           target.id,
    'email',                 target.email,
    'full_name',             target.full_name,
    -- The Edge Function removes the auth account next; this is how it knows
    -- whether there is one to remove.
    'auth_user_id',          target.auth_user_id,
    'recognitions_given',    removed_given,
    'recognitions_received', removed_received,
    'projects_unassigned',   (SELECT count(*) FROM projects WHERE manager_id IS NULL AND is_active)
  );
END;
$$;

COMMENT ON FUNCTION public.purge_employee(uuid, uuid) IS
  'Permanently erases an employee and every reference to them, freeing their email. Service role only -- called by the delete-employee Edge Function after it has authorised the caller. Deactivation, not this, is the tool for someone who has merely left.';

-- CREATE OR REPLACE keeps existing privileges, but 036 had to add these once
-- already. Restating them costs nothing and keeps the intended privilege set
-- readable in the migration that last defined the function.
REVOKE EXECUTE ON FUNCTION public.purge_employee(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_employee(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- ROLLBACK
--
-- Re-apply 035's definition. Note that doing so restores the broken
-- references to role_access_code_attempts and role_access_codes.
-- ============================================================
