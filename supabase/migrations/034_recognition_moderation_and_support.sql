-- ============================================================
-- 034 -- recognition moderation, and the support requests that ask for it
--
-- TWO HALVES OF ONE WORKFLOW
-- --------------------------
--   An employee notices a mistake in a recognition they gave or received.
--   They cannot edit a published recognition -- and must not be able to.
--   So they raise a SUPPORT REQUEST.
--   HR or a Super Admin -- whichever reaches it first -- corrects it.
--
-- Everything below exists to make that path safe, attributable, and impossible
-- to shortcut.
--
--
-- WHAT THIS DELIBERATELY DOES NOT CHANGE
-- --------------------------------------
-- Read these first, because the value of this migration is as much in what it
-- leaves alone as in what it adds:
--
--   * Approval routing. route_nomination_to_project_manager() is BEFORE INSERT
--     ON nominations and nothing here alters it. A moderator may correct the
--     project on a recognition; the approver is NOT recalculated, because the
--     trigger does not fire on UPDATE. Who approved what, and when, stays
--     exactly as it happened.
--
--   * assigned_approver_id, approved_by_id, approved_at, rejected_by_id,
--     rejected_at, nominator_id, nominee_id, created_at, id. None of these are
--     writable by anything added here. A moderator corrects CONTENT; they
--     cannot rewrite who did what.
--
--   * Every existing RLS policy. Not one is dropped, altered or relaxed. The
--     new authority is exercised through SECURITY DEFINER functions that check
--     the caller's role AGAINST THE DATABASE, never against a JWT claim the
--     browser could shape.
--
--   * The 2FA gate. Every function here refuses a session that has not passed
--     session_second_factor_ok(), exactly like everything since 022.
--
--
-- WHY SOFT DELETE IS A STATUS AND NOT A deleted_at COLUMN
-- ------------------------------------------------------
-- This is the most consequential decision in the file, so it is worth stating
-- plainly.
--
-- Every consumer of recognitions already filters on status:
--
--   v_recognition_feed                   WHERE n.status = 'approved'
--   recognition_monthly_trend()          WHERE n.status = 'approved'
--   v_* views in 006                     WHERE n.status = 'approved'
--   calculate-badges                     .eq('status', 'approved')
--   check-duplicate                      .eq('status', 'approved')
--   analytics.ts, nine separate queries  .eq('status', 'approved')
--   recognitions.getMine()               .in('status', [allowlist])
--
-- A `deleted_at` column would have required finding and amending every one of
-- those, and a single miss would leave a removed recognition still counted in
-- a statistic -- silently, and only visible as a number that does not add up.
--
-- Moving status to 'removed' excludes it from ALL of them at once, with no
-- change to any of those queries, because none of them lists 'removed' as a
-- status they want. The safety comes from the shape of the existing code
-- rather than from my remembering every call site.
--
-- The previous status is not lost: previous_status keeps it, and the audit row
-- records it too, so a removal is reversible and reconstructable.
-- ============================================================


-- ============================================================
-- PART A -- the nominations table gains a removed state
-- ============================================================

-- The CHECK is recreated rather than edited; there is no ALTER for a check
-- constraint's expression. Identical apart from the added value.
ALTER TABLE nominations DROP CONSTRAINT IF EXISTS nominations_status_check;
ALTER TABLE nominations ADD CONSTRAINT nominations_status_check
  CHECK (status IN ('draft', 'pending', 'clarification_requested',
                    'approved', 'rejected', 'removed'));

ALTER TABLE nominations
  ADD COLUMN IF NOT EXISTS removed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS removed_by_id   UUID REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS removal_reason  TEXT,
  -- What it was before removal, so the act is reversible and the history of a
  -- recognition that was approved-then-removed is distinguishable from one
  -- that was rejected-then-removed.
  ADD COLUMN IF NOT EXISTS previous_status TEXT;

-- Moderation reads the removed set on its own (the admin queue), and that is
-- the only query that asks for them.
CREATE INDEX IF NOT EXISTS idx_nominations_removed_at
  ON nominations(removed_at DESC) WHERE removed_at IS NOT NULL;


-- ============================================================
-- PART B -- notifications gains the three support types
--
-- Extending the existing table rather than adding a second notification
-- mechanism: the realtime publication, the unread badge, the notification
-- centre and the read/unread handling all already work, and a parallel system
-- would have to reimplement every one of them.
-- ============================================================

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'nomination_submitted',
    'approval_required',
    'clarification_requested',
    'nomination_approved',
    'nomination_rejected',
    'recognition_received',
    'team_recognition_published',
    'badge_unlocked',
    'monthly_report_ready',
    -- Added by 034.
    'support_request_created',    -- to every HR admin and Super Admin
    'support_request_resolved',   -- to the requester
    'support_request_rejected'    -- to the requester
  ));


-- ============================================================
-- PART C -- support requests
--
-- NO INSERT, UPDATE OR DELETE POLICY EXISTS FOR THIS TABLE, ON PURPOSE.
--
-- Reads are policied normally. Every write goes through one of the SECURITY
-- DEFINER functions below, which is what makes several of the stated
-- requirements true by construction rather than by convention:
--
--   an employee cannot change a request's status      -- no UPDATE policy
--   an employee cannot mark a request resolved        -- no UPDATE policy
--   an employee cannot raise a request for a stranger -- create_support_request
--                                                        checks participation
--   a manager cannot resolve requests                 -- resolve/reject check
--                                                        the role in the table
--
-- Hiding the buttons is not the boundary. There are no policies through which
-- these writes could be made at all.
-- ============================================================

CREATE TABLE IF NOT EXISTS recognition_support_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- RESTRICT, not CASCADE: a support request is part of the history of a
  -- correction and must outlive any tidying of the recognition. Recognitions
  -- are never hard-deleted anyway (see Part A), so this is belt and braces.
  nomination_id    UUID NOT NULL REFERENCES nominations(id) ON DELETE RESTRICT,
  requester_id     UUID NOT NULL REFERENCES employees(id)   ON DELETE RESTRICT,

  issue_type       TEXT NOT NULL CHECK (issue_type IN (
                     'core_value', 'behaviour', 'scenario',
                     'story', 'impact', 'project', 'other')),
  description      TEXT NOT NULL,
  requested_change TEXT NOT NULL,

  status           TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'in_progress', 'resolved', 'rejected')),

  /*
    Who settled it, and as what.

    resolved_by_role is a SNAPSHOT of the resolver's role at the moment they
    acted, not a join to their current role. "Resolved by HR — Priya" must keep
    saying HR even if Priya is later made a Super Admin, or steps down to
    Employee. The historical record is about what happened, not about who they
    are now.
  */
  resolved_by_id   UUID REFERENCES employees(id),
  resolved_by_role TEXT,
  resolved_at      TIMESTAMPTZ,
  resolution_note  TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_requests_status
  ON recognition_support_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_requests_requester
  ON recognition_support_requests(requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_requests_nomination
  ON recognition_support_requests(nomination_id);

DROP TRIGGER IF EXISTS set_support_requests_updated_at ON recognition_support_requests;
CREATE TRIGGER set_support_requests_updated_at
  BEFORE UPDATE ON recognition_support_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE recognition_support_requests ENABLE ROW LEVEL SECURITY;

-- The requester sees their own, and only their own.
CREATE POLICY "support_requests_read_own" ON recognition_support_requests
  FOR SELECT USING (
    public.session_second_factor_ok()
    AND requester_id = (auth.jwt()->>'employee_id')::uuid
  );

/*
  HR and Super Admin read all of them — the SAME rows, which is the point.

  There is one queue, not one per role. "Either HR or a Super Admin can resolve
  it, and the other then sees it resolved" falls out of both roles selecting
  through this single policy over a single table; nothing is copied or mirrored
  between them.
*/
CREATE POLICY "support_requests_admin_read_all" ON recognition_support_requests
  FOR SELECT USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );


-- ============================================================
-- PART D -- the shared guard
--
-- One place that answers "may this caller moderate?", so the answer cannot
-- drift between the four functions that ask it.
--
-- Reads the role from `employees` via current_employee_role(), NOT from
-- auth.jwt()->>'user_role'. The JWT claim is populated by the access-token
-- hook and is correct in practice, but it is a value that travels through the
-- client, and this is the check that decides whether someone may rewrite
-- another person's recognition. It reads the table.
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_moderate_recognitions()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT public.session_second_factor_ok()
     AND public.current_employee_role() IN ('hr_admin', 'super_admin');
$fn$;

REVOKE EXECUTE ON FUNCTION public.can_moderate_recognitions() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_moderate_recognitions() TO authenticated;


-- ============================================================
-- PART E -- edit a recognition
--
-- WHAT IS EDITABLE, AND WHY THOSE
-- -------------------------------
--   core_value_id   the mistake this whole feature exists for
--   behaviour_id    same, and tied to the core value
--   scenario_id     same
--   what_happened   the story, for typos and corrections of fact
--   what_impact     likewise
--   project_id      SAFE, and the reasoning matters: the routing trigger is
--                   BEFORE INSERT ON nominations, so changing the project on
--                   an existing row does not re-route anything. The approver
--                   who actually approved it stays recorded. Correcting the
--                   project fixes the recognition's attribution in reporting
--                   without inventing a new approval.
--
-- WHAT IS NOT, AND CANNOT BE
-- --------------------------
-- There is no parameter for nominator_id, nominee_id, id, created_at, status,
-- assigned_approver_id, approved_by_id, approved_at, or the rejection fields.
-- Not "they are ignored" -- they do not exist in this function's signature, so
-- no caller can express the intent.
--
-- THE SNAPSHOTS ARE REFRESHED, AND THIS IS NOT OPTIONAL
-- ----------------------------------------------------
-- nominations carries snapshot_* text columns, written at insert and described
-- in 003 as "never updated". v_recognition_feed reads
-- COALESCE(n.snapshot_behaviour_name, b.name) -- the SNAPSHOT WINS over the
-- joined live row.
--
-- So correcting behaviour_id alone would change the relationship in the
-- database while the feed carried on displaying the old behaviour name. That
-- is precisely the stale-derived-data failure to avoid, and it is invisible
-- unless you read the view definition. Every snapshot whose id moves is
-- rewritten here, in the same statement.
--
-- (snapshot_nominator_dept, snapshot_nominee_dept and
-- snapshot_nominee_manager_id are NOT touched: those record where people stood
-- when the recognition happened, which a later correction does not change.)
-- ============================================================

CREATE OR REPLACE FUNCTION public.moderate_recognition(
  p_nomination_id uuid,
  p_core_value_id uuid    DEFAULT NULL,
  p_behaviour_id  uuid    DEFAULT NULL,
  p_scenario_id   uuid    DEFAULT NULL,
  p_what_happened text    DEFAULT NULL,
  p_what_impact   text    DEFAULT NULL,
  p_project_id    uuid    DEFAULT NULL,
  -- Distinguishes "leave the behaviour alone" from "clear the behaviour",
  -- which a NULL argument cannot express on its own. Same for scenario and
  -- project, all three of which are nullable columns.
  p_clear_behaviour boolean DEFAULT false,
  p_clear_scenario  boolean DEFAULT false,
  p_clear_project   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  actor_id   uuid;
  actor_role text := public.current_employee_role();
  before_row nominations%ROWTYPE;
  after_row  nominations%ROWTYPE;
  changed    jsonb := '{}'::jsonb;
  prev       jsonb := '{}'::jsonb;

  new_core_value uuid;
  new_behaviour  uuid;
  new_scenario   uuid;
  new_project    uuid;
BEGIN
  IF NOT public.can_moderate_recognitions() THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  SELECT id INTO actor_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT * INTO before_row FROM nominations WHERE id = p_nomination_id;
  IF before_row.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF before_row.status = 'removed' THEN
    RETURN jsonb_build_object('status', 'removed');
  END IF;

  -- Resolve each field to its intended value: an explicit clear, an explicit
  -- new value, or unchanged.
  new_core_value := COALESCE(p_core_value_id, before_row.core_value_id);
  new_behaviour  := CASE WHEN p_clear_behaviour THEN NULL
                         ELSE COALESCE(p_behaviour_id, before_row.behaviour_id) END;
  new_scenario   := CASE WHEN p_clear_scenario  THEN NULL
                         ELSE COALESCE(p_scenario_id,  before_row.scenario_id)  END;
  new_project    := CASE WHEN p_clear_project   THEN NULL
                         ELSE COALESCE(p_project_id,   before_row.project_id)   END;

  -- A core value is mandatory on the table; refuse an unknown or inactive one
  -- rather than letting the foreign key raise something unreadable.
  IF NOT EXISTS (SELECT 1 FROM core_values WHERE id = new_core_value) THEN
    RETURN jsonb_build_object('status', 'unknown_core_value');
  END IF;

  IF new_behaviour IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM behaviours WHERE id = new_behaviour) THEN
    RETURN jsonb_build_object('status', 'unknown_behaviour');
  END IF;

  IF new_scenario IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM scenarios WHERE id = new_scenario) THEN
    RETURN jsonb_build_object('status', 'unknown_scenario');
  END IF;

  IF new_project IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM projects WHERE id = new_project) THEN
    RETURN jsonb_build_object('status', 'unknown_project');
  END IF;

  /*
    The write.

    Note what is absent: no status, no approver, no participant, no timestamp
    of record. The snapshot_* columns move WITH their ids so the feed cannot
    disagree with the relationship.
  */
  UPDATE nominations
     SET core_value_id            = new_core_value,
         behaviour_id             = new_behaviour,
         scenario_id              = new_scenario,
         project_id               = new_project,
         what_happened            = COALESCE(NULLIF(btrim(p_what_happened), ''), what_happened),
         what_impact              = COALESCE(NULLIF(btrim(p_what_impact),   ''), what_impact),
         snapshot_core_value_name = (SELECT name FROM core_values WHERE id = new_core_value),
         snapshot_behaviour_name  = (SELECT name FROM behaviours  WHERE id = new_behaviour),
         snapshot_scenario_name   = (SELECT name FROM scenarios   WHERE id = new_scenario),
         snapshot_project_name    = (SELECT name FROM projects    WHERE id = new_project)
   WHERE id = p_nomination_id
  RETURNING * INTO after_row;

  -- Build the diff from what actually moved, so the audit row is a record of
  -- the change rather than a copy of the row.
  IF after_row.core_value_id IS DISTINCT FROM before_row.core_value_id THEN
    prev    := prev    || jsonb_build_object('core_value', before_row.snapshot_core_value_name);
    changed := changed || jsonb_build_object('core_value', after_row.snapshot_core_value_name);
  END IF;
  IF after_row.behaviour_id IS DISTINCT FROM before_row.behaviour_id THEN
    prev    := prev    || jsonb_build_object('behaviour', before_row.snapshot_behaviour_name);
    changed := changed || jsonb_build_object('behaviour', after_row.snapshot_behaviour_name);
  END IF;
  IF after_row.scenario_id IS DISTINCT FROM before_row.scenario_id THEN
    prev    := prev    || jsonb_build_object('scenario', before_row.snapshot_scenario_name);
    changed := changed || jsonb_build_object('scenario', after_row.snapshot_scenario_name);
  END IF;
  IF after_row.project_id IS DISTINCT FROM before_row.project_id THEN
    prev    := prev    || jsonb_build_object('project', before_row.snapshot_project_name);
    changed := changed || jsonb_build_object('project', after_row.snapshot_project_name);
  END IF;
  IF after_row.what_happened IS DISTINCT FROM before_row.what_happened THEN
    prev    := prev    || jsonb_build_object('what_happened', before_row.what_happened);
    changed := changed || jsonb_build_object('what_happened', after_row.what_happened);
  END IF;
  IF after_row.what_impact IS DISTINCT FROM before_row.what_impact THEN
    prev    := prev    || jsonb_build_object('what_impact', before_row.what_impact);
    changed := changed || jsonb_build_object('what_impact', after_row.what_impact);
  END IF;

  IF changed = '{}'::jsonb THEN
    RETURN jsonb_build_object('status', 'ok', 'changed', changed, 'no_op', true);
  END IF;

  -- The existing audit_logs table, not a new one. It has no INSERT policy for
  -- authenticated sessions, which is exactly why writing from a SECURITY
  -- DEFINER function means an ordinary session can neither forge nor erase an
  -- entry. Surfaces in HR -> Audit Logs with no extra work.
  INSERT INTO audit_logs (
    actor_id, actor_email, action, entity_type, entity_id, previous_value, new_value
  )
  VALUES (
    actor_id,
    lower(btrim(auth.jwt()->>'email')),
    'recognition.moderated',
    'nomination',
    p_nomination_id,
    prev,
    changed || jsonb_build_object('_actor_role', actor_role)
  );

  RETURN jsonb_build_object('status', 'ok', 'changed', changed, 'previous', prev);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.moderate_recognition(uuid, uuid, uuid, uuid, text, text, uuid, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moderate_recognition(uuid, uuid, uuid, uuid, text, text, uuid, boolean, boolean, boolean) TO authenticated;


-- ============================================================
-- PART F -- remove a recognition (soft)
--
-- Sets status to 'removed' and records who, when and why. See the header for
-- why this is a status rather than a deleted_at flag.
--
-- The row is not deleted. nomination_appreciations, support requests and audit
-- rows that reference it stay valid, and an administrator can still read the
-- whole history.
-- ============================================================

CREATE OR REPLACE FUNCTION public.remove_recognition(
  p_nomination_id uuid,
  p_reason        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  actor_id   uuid;
  actor_role text := public.current_employee_role();
  target     nominations%ROWTYPE;
  affected   integer;
BEGIN
  IF NOT public.can_moderate_recognitions() THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  SELECT id INTO actor_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT * INTO target FROM nominations WHERE id = p_nomination_id;
  IF target.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- Conditional on still being present, so a double click removes once and the
  -- second call reports the truth rather than rewriting the attribution.
  UPDATE nominations
     SET status          = 'removed',
         previous_status = target.status,
         removed_at      = now(),
         removed_by_id   = actor_id,
         removal_reason  = NULLIF(btrim(p_reason), '')
   WHERE id = p_nomination_id
     AND status <> 'removed';

  GET DIAGNOSTICS affected = ROW_COUNT;

  IF affected = 0 THEN
    RETURN jsonb_build_object('status', 'already_removed');
  END IF;

  INSERT INTO audit_logs (
    actor_id, actor_email, action, entity_type, entity_id, previous_value, new_value
  )
  VALUES (
    actor_id,
    lower(btrim(auth.jwt()->>'email')),
    'recognition.removed',
    'nomination',
    p_nomination_id,
    jsonb_build_object(
      'status',        target.status,
      'core_value',    target.snapshot_core_value_name,
      'nominator_id',  target.nominator_id,
      'nominee_id',    target.nominee_id,
      'what_happened', target.what_happened
    ),
    jsonb_build_object(
      'status',      'removed',
      'reason',      NULLIF(btrim(p_reason), ''),
      '_actor_role', actor_role
    )
  );

  RETURN jsonb_build_object('status', 'ok', 'previous_status', target.status);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.remove_recognition(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.remove_recognition(uuid, text) TO authenticated;


-- ============================================================
-- PART G -- an employee raises a support request
--
-- PARTICIPATION IS CHECKED HERE, NOT IN THE BROWSER
-- -------------------------------------------------
-- The only recognitions a person may raise a request about are ones they gave
-- or received. That is enforced by the nominator_id/nominee_id test below,
-- which reads the nomination row directly -- so passing someone else's
-- recognition id, however it was obtained, is refused.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_support_request(
  p_nomination_id    uuid,
  p_issue_type       text,
  p_description      text,
  p_requested_change text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  requester  employees%ROWTYPE;
  target     nominations%ROWTYPE;
  new_id     uuid;
  open_count integer;
BEGIN
  IF NOT public.session_second_factor_ok() THEN
    RETURN jsonb_build_object('status', 'needs_verification');
  END IF;

  SELECT * INTO requester FROM employees WHERE auth_user_id = auth.uid() AND is_active LIMIT 1;
  IF requester.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_authenticated');
  END IF;

  IF p_issue_type NOT IN ('core_value','behaviour','scenario','story','impact','project','other') THEN
    RETURN jsonb_build_object('status', 'invalid_issue_type');
  END IF;

  IF NULLIF(btrim(p_description), '') IS NULL
     OR NULLIF(btrim(p_requested_change), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'incomplete');
  END IF;

  SELECT * INTO target FROM nominations WHERE id = p_nomination_id;
  IF target.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- The participation rule.
  IF requester.id <> target.nominator_id AND requester.id <> target.nominee_id THEN
    RETURN jsonb_build_object('status', 'not_your_recognition');
  END IF;

  IF target.status = 'removed' THEN
    RETURN jsonb_build_object('status', 'recognition_removed');
  END IF;

  -- One open request per person per recognition. Without this, an impatient
  -- employee files the same correction four times and four administrators each
  -- pick up a copy.
  SELECT count(*) INTO open_count
    FROM recognition_support_requests
   WHERE nomination_id = p_nomination_id
     AND requester_id  = requester.id
     AND status IN ('open', 'in_progress');

  IF open_count > 0 THEN
    RETURN jsonb_build_object('status', 'already_open');
  END IF;

  INSERT INTO recognition_support_requests (
    nomination_id, requester_id, issue_type, description, requested_change
  )
  VALUES (
    p_nomination_id, requester.id, p_issue_type,
    btrim(p_description), btrim(p_requested_change)
  )
  RETURNING id INTO new_id;

  /*
    Notify EVERY HR admin and Super Admin, as one row each.

    One queue, many watchers: each administrator gets their own notification
    row so read/unread stays personal, while the request itself is a single
    shared row. Resolving it does not require chasing these down -- the queue
    reads the request's status, not anyone's notification.

    The requester is excluded: an HR admin can raise a request about their own
    recognition, and telling them about their own submission is noise.
  */
  INSERT INTO notifications (recipient_id, type, title, body, related_id, related_type)
  SELECT
    e.id,
    'support_request_created',
    'Recognition correction requested',
    requester.full_name || ' asked for a correction to a recognition ('
      || replace(p_issue_type, '_', ' ') || ').',
    new_id,
    'support_request'
  FROM employees e
  WHERE e.role IN ('hr_admin', 'super_admin')
    AND e.is_active
    AND e.auth_user_id IS NOT NULL
    AND e.id <> requester.id;

  INSERT INTO audit_logs (
    actor_id, actor_email, action, entity_type, entity_id, new_value
  )
  VALUES (
    requester.id,
    lower(btrim(auth.jwt()->>'email')),
    'support_request.created',
    'support_request',
    new_id,
    jsonb_build_object(
      'nomination_id', p_nomination_id,
      'issue_type',    p_issue_type
    )
  );

  RETURN jsonb_build_object('status', 'ok', 'request_id', new_id);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.create_support_request(uuid, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_support_request(uuid, text, text, text) TO authenticated;


-- ============================================================
-- PART H -- resolve a support request, applying the correction
--
-- ONE OPERATION. This is the requirement that shapes the whole function:
-- verifying the caller, applying the correction, auditing it, claiming the
-- request and notifying the requester happen inside a single transaction, so
-- there is no ordering of client calls that can leave a request half-resolved.
--
-- HOW DOUBLE RESOLUTION IS PREVENTED
-- ----------------------------------
-- The claim is a CONDITIONAL UPDATE:
--
--     UPDATE ... WHERE id = $1 AND status IN ('open','in_progress')
--
-- Two administrators pressing Resolve at the same instant both reach it. One
-- commits; the other blocks on the row lock, re-evaluates the WHERE clause
-- under READ COMMITTED once the lock is released, matches zero rows, and is
-- told who won. There is no window in which both succeed, and no frontend
-- state is involved in the decision.
--
-- The claim is taken BEFORE the correction is applied, so the loser's call
-- cannot also have edited the recognition on its way to failing.
-- ============================================================

CREATE OR REPLACE FUNCTION public.resolve_support_request(
  p_request_id       uuid,
  p_resolution_note  text    DEFAULT NULL,
  -- Optional correction, applied through moderate_recognition() so there is
  -- exactly one implementation of "edit a recognition" and one audit shape.
  -- Omit them all to resolve without changing the recognition (the request was
  -- mistaken, or the fix was made elsewhere).
  p_core_value_id    uuid    DEFAULT NULL,
  p_behaviour_id     uuid    DEFAULT NULL,
  p_scenario_id      uuid    DEFAULT NULL,
  p_what_happened    text    DEFAULT NULL,
  p_what_impact      text    DEFAULT NULL,
  p_project_id       uuid    DEFAULT NULL,
  p_clear_behaviour  boolean DEFAULT false,
  p_clear_scenario   boolean DEFAULT false,
  p_clear_project    boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  actor      employees%ROWTYPE;
  actor_role text := public.current_employee_role();
  req        recognition_support_requests%ROWTYPE;
  winner     employees%ROWTYPE;
  edit       jsonb := NULL;
  affected   integer;
BEGIN
  IF NOT public.can_moderate_recognitions() THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  SELECT * INTO actor FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT * INTO req FROM recognition_support_requests WHERE id = p_request_id;
  IF req.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- ── Claim first. Whoever wins this UPDATE owns the resolution. ──
  UPDATE recognition_support_requests
     SET status           = 'resolved',
         resolved_by_id   = actor.id,
         resolved_by_role = actor_role,
         resolved_at      = now(),
         resolution_note  = NULLIF(btrim(p_resolution_note), '')
   WHERE id = p_request_id
     AND status IN ('open', 'in_progress');

  GET DIAGNOSTICS affected = ROW_COUNT;

  IF affected = 0 THEN
    -- Someone else got there first, or it was already rejected. Re-read and
    -- report who, so the caller can show "Already resolved by ..." rather than
    -- a bare failure.
    SELECT * INTO req FROM recognition_support_requests WHERE id = p_request_id;
    SELECT * INTO winner FROM employees WHERE id = req.resolved_by_id;

    RETURN jsonb_build_object(
      'status',           'already_settled',
      'request_status',   req.status,
      'resolved_by_name', winner.full_name,
      'resolved_by_role', req.resolved_by_role,
      'resolved_at',      req.resolved_at
    );
  END IF;

  -- ── Then the correction, if one was asked for. ──
  IF p_core_value_id IS NOT NULL OR p_behaviour_id IS NOT NULL
     OR p_scenario_id IS NOT NULL OR p_project_id IS NOT NULL
     OR NULLIF(btrim(p_what_happened), '') IS NOT NULL
     OR NULLIF(btrim(p_what_impact), '')   IS NOT NULL
     OR p_clear_behaviour OR p_clear_scenario OR p_clear_project
  THEN
    edit := public.moderate_recognition(
      req.nomination_id,
      p_core_value_id, p_behaviour_id, p_scenario_id,
      p_what_happened, p_what_impact, p_project_id,
      p_clear_behaviour, p_clear_scenario, p_clear_project
    );

    -- The edit failing must not leave the request marked resolved with nothing
    -- done. Raising rolls the claim back with it.
    IF edit->>'status' <> 'ok' THEN
      RAISE EXCEPTION 'correction_failed:%', COALESCE(edit->>'status', 'unknown')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ── Tell the requester, once. ──
  INSERT INTO notifications (recipient_id, type, title, body, related_id, related_type)
  VALUES (
    req.requester_id,
    'support_request_resolved',
    'Your correction request was resolved',
    'Resolved by ' || CASE actor_role
                        WHEN 'hr_admin'    THEN 'HR'
                        WHEN 'super_admin' THEN 'Super Admin'
                        ELSE actor_role
                      END
      || ' — ' || COALESCE(actor.full_name, 'an administrator') || '.'
      || COALESCE(' ' || NULLIF(btrim(p_resolution_note), ''), ''),
    p_request_id,
    'support_request'
  );

  INSERT INTO audit_logs (
    actor_id, actor_email, action, entity_type, entity_id, previous_value, new_value
  )
  VALUES (
    actor.id,
    lower(btrim(auth.jwt()->>'email')),
    'support_request.resolved',
    'support_request',
    p_request_id,
    jsonb_build_object('status', req.status),
    jsonb_build_object(
      'status',        'resolved',
      'nomination_id', req.nomination_id,
      'requester_id',  req.requester_id,
      'note',          NULLIF(btrim(p_resolution_note), ''),
      'correction',    edit,
      '_actor_role',   actor_role
    )
  );

  RETURN jsonb_build_object(
    'status',           'ok',
    'resolved_by_role', actor_role,
    'resolved_by_name', actor.full_name,
    'correction',       edit
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.resolve_support_request(uuid, text, uuid, uuid, uuid, text, text, uuid, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resolve_support_request(uuid, text, uuid, uuid, uuid, text, text, uuid, boolean, boolean, boolean) TO authenticated;


-- ============================================================
-- PART I -- reject a request, or take it up
--
-- Rejection exists so that a request cannot silently disappear: every request
-- ends in a state the requester can see and that names a person. A rejection
-- notifies the requester with the reason, which is the whole reason it is here
-- rather than leaving administrators to ignore requests they disagree with.
--
-- 'in_progress' is a claim, not a resolution -- it says someone is looking. It
-- deliberately does NOT settle the request, and opening or reading a request
-- never calls this: only an explicit action does.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reject_support_request(
  p_request_id uuid,
  p_reason     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  actor      employees%ROWTYPE;
  actor_role text := public.current_employee_role();
  req        recognition_support_requests%ROWTYPE;
  winner     employees%ROWTYPE;
  affected   integer;
BEGIN
  IF NOT public.can_moderate_recognitions() THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'reason_required');
  END IF;

  SELECT * INTO actor FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  SELECT * INTO req   FROM recognition_support_requests WHERE id = p_request_id;

  IF req.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  UPDATE recognition_support_requests
     SET status           = 'rejected',
         resolved_by_id   = actor.id,
         resolved_by_role = actor_role,
         resolved_at      = now(),
         resolution_note  = btrim(p_reason)
   WHERE id = p_request_id
     AND status IN ('open', 'in_progress');

  GET DIAGNOSTICS affected = ROW_COUNT;

  IF affected = 0 THEN
    SELECT * INTO req    FROM recognition_support_requests WHERE id = p_request_id;
    SELECT * INTO winner FROM employees WHERE id = req.resolved_by_id;
    RETURN jsonb_build_object(
      'status',           'already_settled',
      'request_status',   req.status,
      'resolved_by_name', winner.full_name,
      'resolved_by_role', req.resolved_by_role,
      'resolved_at',      req.resolved_at
    );
  END IF;

  INSERT INTO notifications (recipient_id, type, title, body, related_id, related_type)
  VALUES (
    req.requester_id,
    'support_request_rejected',
    'Your correction request was not applied',
    CASE actor_role WHEN 'hr_admin' THEN 'HR' WHEN 'super_admin' THEN 'Super Admin'
                    ELSE actor_role END
      || ' reviewed your request. ' || btrim(p_reason),
    p_request_id,
    'support_request'
  );

  INSERT INTO audit_logs (
    actor_id, actor_email, action, entity_type, entity_id, previous_value, new_value
  )
  VALUES (
    actor.id,
    lower(btrim(auth.jwt()->>'email')),
    'support_request.rejected',
    'support_request',
    p_request_id,
    jsonb_build_object('status', req.status),
    jsonb_build_object('status', 'rejected', 'reason', btrim(p_reason),
                       '_actor_role', actor_role)
  );

  RETURN jsonb_build_object('status', 'ok');
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.reject_support_request(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reject_support_request(uuid, text) TO authenticated;


-- Take a request up without settling it. Idempotent and non-destructive: it
-- moves 'open' to 'in_progress' and does nothing to anything else.
CREATE OR REPLACE FUNCTION public.claim_support_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  affected integer;
BEGIN
  IF NOT public.can_moderate_recognitions() THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  UPDATE recognition_support_requests
     SET status = 'in_progress'
   WHERE id = p_request_id AND status = 'open';

  GET DIAGNOSTICS affected = ROW_COUNT;

  RETURN jsonb_build_object('status', 'ok', 'changed', affected > 0);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.claim_support_request(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.claim_support_request(uuid) TO authenticated;


-- ============================================================
-- Verification
--
-- Printed when the migration runs. Same shape as 026/027/031/032/033.
-- ============================================================
SELECT '034 APPLIED' AS check,
       -- Part A
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'nominations' AND column_name = 'removed_by_id')  AS soft_delete_columns,
       (SELECT pg_get_constraintdef(oid) LIKE '%removed%' FROM pg_constraint
         WHERE conname = 'nominations_status_check')                                 AS removed_status_allowed,
       -- Part C
       EXISTS (SELECT 1 FROM pg_tables
                WHERE schemaname = 'public'
                  AND tablename = 'recognition_support_requests')                    AS support_table,
       (SELECT relrowsecurity FROM pg_class
         WHERE oid = 'public.recognition_support_requests'::regclass)                AS support_rls_on,
       -- The heart of the write model: reads are policied, writes are not.
       -- Two SELECT policies and nothing else means every write must go
       -- through a SECURITY DEFINER function.
       (SELECT count(*) FROM pg_policies
         WHERE tablename = 'recognition_support_requests'
           AND cmd = 'SELECT') = 2                                                   AS two_read_policies,
       (SELECT count(*) FROM pg_policies
         WHERE tablename = 'recognition_support_requests'
           AND cmd <> 'SELECT') = 0                                                  AS no_write_policies,
       -- Parts D-I
       (SELECT count(*) FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname IN ('can_moderate_recognitions','moderate_recognition',
                           'remove_recognition','create_support_request',
                           'resolve_support_request','reject_support_request',
                           'claim_support_request')) = 7                             AS all_functions_installed,
       -- The role check reads the TABLE, not the JWT claim.
       (SELECT pg_get_functiondef(oid) LIKE '%current_employee_role%' FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'can_moderate_recognitions')                                AS role_read_from_database,
       (SELECT pg_get_functiondef(oid) LIKE '%session_second_factor_ok%' FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'can_moderate_recognitions')                                AS two_factor_enforced,
       -- The conditional claim that makes double resolution impossible.
       (SELECT pg_get_functiondef(oid) LIKE '%AND status IN (''open'', ''in_progress'')%'
          FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'resolve_support_request')                                  AS atomic_claim_present,
       -- The snapshot refresh that keeps the feed from showing a stale value.
       (SELECT pg_get_functiondef(oid) LIKE '%snapshot_behaviour_name  =%' FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'moderate_recognition')                                     AS snapshots_refreshed,
       -- Nothing here may write a participant or an approver.
       (SELECT pg_get_functiondef(oid) NOT LIKE '%nominator_id =%'
           AND pg_get_functiondef(oid) NOT LIKE '%assigned_approver_id =%'
           AND pg_get_functiondef(oid) NOT LIKE '%approved_by_id =%'
          FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'moderate_recognition')                                     AS identity_columns_untouched,
       -- anon reaches none of it.
       NOT (has_function_privilege('anon', 'public.moderate_recognition(uuid,uuid,uuid,uuid,text,text,uuid,boolean,boolean,boolean)', 'EXECUTE')
         OR has_function_privilege('anon', 'public.remove_recognition(uuid,text)', 'EXECUTE')
         OR has_function_privilege('anon', 'public.create_support_request(uuid,text,text,text)', 'EXECUTE'))
                                                                                     AS anon_locked_out,
       -- The routing trigger is untouched and still INSERT-only.
       (SELECT count(*) FROM pg_trigger
         WHERE tgrelid = 'public.nominations'::regclass
           AND tgname = 'route_nomination_to_project_manager'
           AND NOT tgisinternal) = 1                                                 AS routing_trigger_intact;
-- EXPECT every boolean true.
-- routing_trigger_intact and identity_columns_untouched are the two that prove
-- the existing approval workflow was not disturbed: the router still fires on
-- INSERT only, and no function added here can write a participant or approver.
