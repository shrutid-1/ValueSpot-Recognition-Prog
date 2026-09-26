-- ============================================================
-- Migration 009: Approval notifications, clarification responses, realtime
--
-- Closes three gaps in the recognition loop:
--   1. REQ-003-01 — nothing notified the approver that a nomination was
--      waiting. Managers had to discover pending work by visiting the page.
--   2. REQ-003-03 — a nominator could not respond to a clarification request.
--      The RLS UPDATE policy had no WITH CHECK, so Postgres reused the USING
--      expression as the check and the clarification_requested -> pending
--      transition failed: the new row's status was no longer one of the
--      statuses USING permits. Nominations stuck in that state forever.
--   3. The notifications table was never added to the realtime publication, so
--      the frontend's postgres_changes subscription received nothing.
-- ============================================================

-- ── 1. Notify the assigned approver on submission ───────────

/**
 * Raise a notification for whoever has to act on a new nomination.
 *
 * SECURITY DEFINER because the nominator may not insert rows into another
 * employee's notifications — the notifications_own policy restricts inserts to
 * the recipient themselves, which is correct and should stay that way.
 */
CREATE OR REPLACE FUNCTION public.notify_nomination_submitted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nominator_name text;
  value_name     text;
BEGIN
  -- Drafts have not been submitted to anyone yet.
  IF NEW.status <> 'pending' OR NEW.assigned_approver_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO nominator_name FROM employees WHERE id = NEW.nominator_id;
  value_name := COALESCE(NEW.snapshot_core_value_name, 'a Core Value');

  INSERT INTO notifications (recipient_id, type, title, body, related_id, related_type)
  VALUES (
    NEW.assigned_approver_id,
    'approval_required',
    'A recognition needs your review',
    COALESCE(nominator_name, 'A colleague')
      || ' submitted a recognition for ' || value_name || '.',
    NEW.id,
    'nomination'
  );

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_nomination_submitted() FROM PUBLIC;

DROP TRIGGER IF EXISTS notify_nomination_submitted ON nominations;
CREATE TRIGGER notify_nomination_submitted
  AFTER INSERT ON nominations
  FOR EACH ROW EXECUTE FUNCTION public.notify_nomination_submitted();


-- ── 2. Let the nominator respond to a clarification request ─

DROP POLICY IF EXISTS "nominations_update_nominator" ON nominations;

-- USING gates which existing rows may be edited; WITH CHECK gates what they may
-- become. Without an explicit WITH CHECK, Postgres reuses USING for both, which
-- forbade the very transition this policy exists to allow.
CREATE POLICY "nominations_update_nominator" ON nominations
  FOR UPDATE
  USING (
    nominator_id = (auth.jwt()->>'employee_id')::uuid AND
    status IN ('draft', 'clarification_requested')
  )
  WITH CHECK (
    nominator_id = (auth.jwt()->>'employee_id')::uuid AND
    status IN ('draft', 'pending', 'clarification_requested')
  );

/**
 * Constrain what a nominator may actually change on their own nomination.
 *
 * The policy above authorises the row and the target status, but not the
 * individual columns — on its own it would let a nominator rewrite the nominee,
 * the Core Value, or the approver. This restricts a nominator-initiated update
 * to the narrative fields and the resubmission bookkeeping.
 *
 * Approvals run through the process-approval Edge Function under the service
 * role, and HR acts under its own policy, so neither is affected.
 */
CREATE OR REPLACE FUNCTION public.enforce_nominator_update_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id   uuid := (auth.jwt()->>'employee_id')::uuid;
  actor_role text := COALESCE(auth.jwt()->>'user_role', '');
BEGIN
  -- Only police updates made by the nominator acting as themselves.
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR actor_id IS NULL
     OR actor_id <> OLD.nominator_id
     OR actor_role IN ('hr_admin', 'super_admin')
     OR actor_id = OLD.assigned_approver_id
  THEN
    RETURN NEW;
  END IF;

  IF NEW.nominee_id            IS DISTINCT FROM OLD.nominee_id
     OR NEW.nominator_id       IS DISTINCT FROM OLD.nominator_id
     OR NEW.core_value_id      IS DISTINCT FROM OLD.core_value_id
     OR NEW.behaviour_id       IS DISTINCT FROM OLD.behaviour_id
     OR NEW.scenario_id        IS DISTINCT FROM OLD.scenario_id
     OR NEW.assigned_approver_id IS DISTINCT FROM OLD.assigned_approver_id
     OR NEW.escalation_level   IS DISTINCT FROM OLD.escalation_level
     OR NEW.approved_by_id     IS DISTINCT FROM OLD.approved_by_id
     OR NEW.approved_at        IS DISTINCT FROM OLD.approved_at
     OR NEW.rejected_by_id     IS DISTINCT FROM OLD.rejected_by_id
     OR NEW.rejected_at        IS DISTINCT FROM OLD.rejected_at
     OR NEW.rejection_reason   IS DISTINCT FROM OLD.rejection_reason
     OR NEW.published_at       IS DISTINCT FROM OLD.published_at
     OR NEW.recognition_source IS DISTINCT FROM OLD.recognition_source
     OR NEW.idempotency_key    IS DISTINCT FROM OLD.idempotency_key
  THEN
    RAISE EXCEPTION 'You may only revise the description and impact of your recognition.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A clarification response goes back to the approver, never straight through.
  IF OLD.status = 'clarification_requested' AND NEW.status NOT IN ('clarification_requested', 'pending') THEN
    RAISE EXCEPTION 'A clarification response must return the recognition to pending review.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_nominator_update_scope() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_nominator_update_scope ON nominations;
CREATE TRIGGER enforce_nominator_update_scope
  BEFORE UPDATE ON nominations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_nominator_update_scope();

/**
 * Notify the approver again once the nominator has answered.
 */
CREATE OR REPLACE FUNCTION public.notify_clarification_answered()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nominator_name text;
BEGIN
  IF OLD.status = 'clarification_requested'
     AND NEW.status = 'pending'
     AND NEW.assigned_approver_id IS NOT NULL
  THEN
    SELECT full_name INTO nominator_name FROM employees WHERE id = NEW.nominator_id;

    INSERT INTO notifications (recipient_id, type, title, body, related_id, related_type)
    VALUES (
      NEW.assigned_approver_id,
      'approval_required',
      'Clarification answered',
      COALESCE(nominator_name, 'A colleague')
        || ' has updated their recognition and returned it for review.',
      NEW.id,
      'nomination'
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_clarification_answered() FROM PUBLIC;

DROP TRIGGER IF EXISTS notify_clarification_answered ON nominations;
CREATE TRIGGER notify_clarification_answered
  AFTER UPDATE ON nominations
  FOR EACH ROW EXECUTE FUNCTION public.notify_clarification_answered();


-- ── 3. Realtime delivery for notifications ──────────────────

-- The NotificationProvider subscribes to postgres_changes on this table. Without
-- membership of the publication the subscription connects and then silently
-- receives nothing, so notifications only appeared on a full page reload.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END;
$$;
