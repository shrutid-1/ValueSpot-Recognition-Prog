-- ============================================================
-- Migration 035: Permanent employee erasure
--
-- Adds ONE function: purge_employee(). It removes a person and everything
-- that refers to them from the public schema, permanently, so their email
-- address can be used again by a new account.
--
-- This is a deliberate exception to the way the rest of this schema works, and
-- the exception is worth stating plainly before the code.
--
--
-- WHY THIS IS NOT A SOFT DELETE
-- -----------------------------
-- Everything else here soft-deletes. Migration 034 moved recognition removal
-- to a 'removed' status precisely so that nothing is ever torn out from under
-- a statistic, and employees have carried an is_active flag since 001.
--
-- Deactivation remains the right tool for someone who has left: their
-- recognitions stay, their badges stay, the feed still reads correctly, and
-- the record of what happened survives.
--
-- purge_employee() is for the other case — an erasure request, a test account,
-- a record created by mistake — where the requirement is that the person is
-- GONE and the address is free. Deactivation cannot do that: employees.email
-- carries a UNIQUE constraint and auth.users still holds the identity, so the
-- address stays occupied for as long as the row exists.
--
--
-- WHAT THIS DESTROYS THAT DOES NOT BELONG TO THE TARGET
-- ----------------------------------------------------
-- This is the consequence to understand before enabling the button.
--
-- nominations.nominator_id and .nominee_id are ON DELETE RESTRICT (003). The
-- row cannot go while any recognition mentions them, so every recognition they
-- GAVE is deleted too -- and a recognition they gave is part of the RECIPIENT's
-- history. Deleting a prolific recognizer therefore removes recognitions from
-- other people's profiles and lowers their badge counts.
--
-- That is not a side effect this function can avoid; it is what "erase them
-- from everywhere" means against a schema where recognition is a relationship
-- between two people rather than a possession of one.
--
-- What it CAN do, and does below, is leave the survivors consistent: badge
-- counts are recomputed from the recognitions that remain, rather than left
-- to describe a history that no longer exists.
--
--
-- WHAT SURVIVES ON PURPOSE
-- ------------------------
--   audit_logs          actor_id is set to NULL, the entry is kept. An audit
--                       trail that can be erased by the person it implicates
--                       is not an audit trail. actor_email already denormalises
--                       the address, so the entry still reads correctly.
--   app_config          updated_by set to NULL; configuration is not personal.
--   The deletion itself  is written to audit_logs with the target's name and
--                       address inline, because the row it points at is gone.
--
--
-- AUTHORIZATION
-- -------------
-- Callable by the SERVICE ROLE ONLY. It is executed by the delete-employee
-- Edge Function, which validates the caller's JWT, their second factor and
-- their role before calling, in the same shape process-approval uses. The
-- actor is passed in and re-checked here rather than read from auth.uid(),
-- which is NULL under the service role.
--
-- Nothing is granted to `authenticated`. A browser cannot reach this function,
-- so it cannot name itself as the actor.
--
-- The boundary matches set_employee_role() in 016:
--   super_admin   may erase anyone but themselves
--   hr_admin      may erase employees and managers, never an administrator
-- and the last active Super Admin cannot be erased by anyone.
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


  -- ── Sign-in and invitation trails ───────────────────────
  --
  -- Keyed by auth user id, with no foreign key to follow, so each is named.
  IF target.auth_user_id IS NOT NULL THEN
    DELETE FROM login_verifications        WHERE user_id      = target.auth_user_id;
    DELETE FROM login_code_sends           WHERE user_id      = target.auth_user_id;
    DELETE FROM role_access_code_attempts  WHERE auth_user_id = target.auth_user_id;
  END IF;

  -- invitation_sends.employee_id is ON DELETE CASCADE (027); sent_by is SET
  -- NULL. Both resolve themselves when the employee row goes.

  -- Kept deliberately. See the header.
  UPDATE audit_logs  SET actor_id   = NULL WHERE actor_id   = target.id;
  UPDATE app_config  SET updated_by = NULL WHERE updated_by = target.id;
  UPDATE role_access_codes SET created_by = NULL WHERE created_by = target.id;


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

-- Service role only, granted the same way session_second_factor_ok_for() is in
-- 021: revoke the implicit PUBLIC execute, then name the one role that may
-- call it. The GRANT is not redundant with Supabase's default privileges —
-- relying on those would leave the permission invisible here and dependent on
-- project setup, and the REVOKE above is what removes the PUBLIC path.
--
-- Never granted to authenticated: the actor is a parameter, so a browser able
-- to call this could name anyone as the actor.
REVOKE EXECUTE ON FUNCTION public.purge_employee(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_employee(uuid, uuid) TO service_role;


-- ============================================================
-- ROLLBACK
--
--   DROP FUNCTION IF EXISTS public.purge_employee(uuid, uuid);
--
-- Nothing else in this migration creates state. Erasures already performed
-- are, by design, not recoverable by dropping the function.
-- ============================================================
