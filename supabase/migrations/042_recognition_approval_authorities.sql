-- ============================================================
-- 042 -- three approval authorities, one winning decision
--
-- Additive. Four columns, seven functions, one trigger. One existing trigger
-- function is redefined (notify_nomination_submitted). No policy is created,
-- altered or dropped. Safe to run more than once. Requires 001-041.
--
--
-- WHAT CHANGES
-- ------------
-- A submitted recognition becomes visible to, and actionable by, all three
-- approval authorities:
--
--     relevant Project Manager   scoped -- the project's manager, as now
--     HR Admin                   organisation-wide
--     Super Admin                organisation-wide
--
-- and exactly ONE of them can ever record a decision on it.
--
--
-- WHAT DOES NOT CHANGE, AND THIS IS THE IMPORTANT PART
-- ---------------------------------------------------
-- Approval ROUTING is untouched. route_nomination_to_project_manager()
-- (029/030) still derives assigned_approver_id from the project the recognizer
-- selected, still overwrites whatever the client sends, and still falls back to
-- HR when the project's manager is a party to the recognition. This migration
-- does not read, write or mention that function.
--
--     recognition.project_id -> projects.manager_id -> the Manager's scope
--
-- employees.manager_id is not consulted anywhere here. The nominee's project is
-- not inferred anywhere here. What widens is WHO ELSE may act, not who the
-- recognition was routed to.
--
--
-- THE VISIBILITY MODEL WAS ALREADY IN THE POLICIES
-- -----------------------------------------------
-- Worth saying plainly, because it explains why this migration is small. The
-- row-level policies from 003, tightened by 022, already describe exactly the
-- required model:
--
--     nominations_read_approver   manager/hr/super_admin AND
--                                 assigned_approver_id = me
--     nominations_hr_read_all     hr_admin/super_admin, every row
--
-- A Manager cannot read another Manager's queue, whatever they send. HR and
-- Super Admin can read everything. Nothing needed widening; what was missing
-- was a QUERY that asked the right question. getPendingApprovals() filtered on
-- `assigned_approver_id = <an id from the browser>`, so HR and Super Admin got
-- an empty page even though their policy allowed the rows.
--
-- recognition_approval_queue() below asks the right question, takes no
-- arguments, and leaves the policies as the authority.
--
--
-- SINGLE-ACTION CONCURRENCY
-- -------------------------
-- The old path was:
--
--     process-approval  ->  UPDATE nominations SET status = 'approved' ...
--
-- with no precondition on the current status and no lock. Two authorities
-- acting at the same moment both succeeded, and the second write simply
-- overwrote the first: Manager approved, HR rejected, and the row ended up
-- rejected with approved_by_id still set. There was nothing to detect it.
--
-- record_nomination_decision() takes a ROW LOCK (SELECT ... FOR UPDATE) before
-- it reads the status. The second transaction blocks on that lock, and when it
-- resumes it re-reads the row and sees the decision the first one made, so it
-- returns 'already_handled' and writes nothing. This is the database deciding,
-- not a timing accident and not a frontend check.
--
--
-- WHO ACTED IS NOW RECORDED FOR ALL THREE ACTIONS
-- ----------------------------------------------
-- approved_by_id and rejected_by_id existed (003). Clarification recorded only
-- a timestamp and a note -- there was no way to answer "who asked for this?".
-- Part A adds the missing id, and a ROLE SNAPSHOT for each of the three
-- actions.
--
-- The role is snapshotted for the same reason the snapshot_* columns exist: a
-- person's role changes, and "Approved by Manager -- John Doe" must keep saying
-- Manager even after John becomes an HR Admin. The NAME is NOT copied -- it is
-- resolved through the foreign key, so a rename corrects the display everywhere
-- rather than leaving stale strings behind.
-- ============================================================


-- ============================================================
-- PART A -- the missing actor columns
--
-- Four columns, all nullable, all additive. Nothing is backfilled: a decision
-- made before this migration genuinely has no recorded role, and inventing one
-- from the actor's CURRENT role would be a guess written into the audit trail.
-- The UI renders those as "Approved by John Doe", without a role.
-- ============================================================

ALTER TABLE nominations
  ADD COLUMN IF NOT EXISTS clarification_requested_by_id   UUID REFERENCES employees(id),
  -- Role AT THE TIME OF THE DECISION. See the header.
  ADD COLUMN IF NOT EXISTS approved_by_role                TEXT,
  ADD COLUMN IF NOT EXISTS rejected_by_role                TEXT,
  ADD COLUMN IF NOT EXISTS clarification_requested_by_role TEXT;

COMMENT ON COLUMN public.nominations.clarification_requested_by_id IS
  'Who asked for clarification. Added by 042; clarification previously recorded only a timestamp and a note.';
COMMENT ON COLUMN public.nominations.approved_by_role IS
  'The approver''s role at the moment of approval. Snapshot, like snapshot_core_value_name: roles change, history does not.';


-- ============================================================
-- PART B -- role labels, in the database
--
-- Only so the notification bodies written below read like the rest of the
-- product ("Approved by HR"). Mirrors roleLabel() in src/lib/portals.ts, which
-- remains the frontend's copy -- the two are four short strings and the
-- alternative is the database emitting 'hr_admin' at a human.
-- ============================================================

CREATE OR REPLACE FUNCTION public.role_label(p_role text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE p_role
    WHEN 'employee'    THEN 'Employee'
    WHEN 'manager'     THEN 'Manager'
    WHEN 'hr_admin'    THEN 'HR'
    WHEN 'super_admin' THEN 'Super Admin'
    ELSE NULL
  END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.role_label(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.role_label(text) TO authenticated;


-- ============================================================
-- PART C -- may this person decide this recognition?
--
-- ONE definition of the rule, used by three callers that must never disagree:
-- the queue (to decide whether to offer the buttons), the decision function (to
-- refuse), and the verification script (to assert the first two share it).
--
-- THE RULE
--   actor must hold manager, hr_admin or super_admin
--   a MANAGER may act only on a recognition routed to them
--       (assigned_approver_id -- which 029/030 derived from the project)
--   HR and Super Admin may act on any recognition
--   NOBODY decides a recognition they are a party to
--   only a 'pending' recognition is actionable
--
-- ON THE PARTY RULE
-- ----------------
-- This is the one rule here that is stricter than the code it replaces, and it
-- is deliberate. route_nomination_to_project_manager() (029/030) already
-- refuses to route a recognition to a manager who is its nominee or nominator,
-- and falls back to "any active HR admin WHO IS NOT A PARTY". The system's
-- established rule is that a party does not decide; the Edge Function simply
-- never applied it to HR and Super Admin, because before this change they had
-- no queue through which to reach their own recognitions.
--
-- It cannot strand a recognition: the routing trigger refuses at INSERT unless
-- a non-party approver exists, so every row that exists has one.
--
-- SECURITY DEFINER because the queue calls it per row and it must judge a
-- nominee by their real role, not by what the caller happens to be able to
-- read. It discloses nothing: a verdict about a pair of ids the caller holds.
-- ============================================================

CREATE OR REPLACE FUNCTION public.nomination_decision_authority(
  p_nomination_id uuid,
  p_actor_id      uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  nom   nominations%ROWTYPE;
  actor employees%ROWTYPE;
BEGIN
  IF p_nomination_id IS NULL OR p_actor_id IS NULL THEN
    RETURN 'forbidden';
  END IF;

  SELECT * INTO actor FROM employees WHERE id = p_actor_id;
  IF actor.id IS NULL OR NOT actor.is_active THEN
    RETURN 'forbidden';
  END IF;

  IF actor.role NOT IN ('manager', 'hr_admin', 'super_admin') THEN
    RETURN 'forbidden';
  END IF;

  SELECT * INTO nom FROM nominations WHERE id = p_nomination_id;
  IF nom.id IS NULL THEN
    RETURN 'not_found';
  END IF;

  -- A Manager's scope is the recognition that was ROUTED to them, and routing
  -- follows the project. Not their team, not their projects re-derived here --
  -- the column 029/030 already wrote.
  IF actor.role = 'manager' AND nom.assigned_approver_id IS DISTINCT FROM actor.id THEN
    RETURN 'forbidden';
  END IF;

  IF actor.id = nom.nominator_id OR actor.id = nom.nominee_id THEN
    RETURN 'party';
  END IF;

  -- The state machine, unchanged: only a pending recognition is actionable.
  -- 'clarification_requested' is NOT actionable and must not become so -- it is
  -- waiting on the author, who returns it to 'pending' by answering.
  IF nom.status <> 'pending' THEN
    RETURN 'already_handled';
  END IF;

  RETURN 'ok';
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.nomination_decision_authority(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.nomination_decision_authority(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.nomination_decision_authority(uuid, uuid) IS
  'Whether an actor may decide a nomination: ok, forbidden, party, already_handled or not_found. Managers are scoped to assigned_approver_id (project-derived); HR and Super Admin are organisation-wide; a party to the recognition never decides.';


-- ============================================================
-- PART D -- the decision as a record, for everyone who has to display it
--
-- Derived from the row rather than stored a second time. The three actions
-- write three different column sets (003 chose that shape); this is the one
-- place that knows which columns belong to which action, so no screen has to.
--
-- Returns NULL while a recognition is still pending -- there is no decision to
-- describe yet -- and for 'draft' and 'removed'.
--
-- The NAME comes from the join, never from a stored string: someone who marries
-- and changes their name is still correctly named on decisions they made years
-- ago. The ROLE comes from the snapshot, because someone promoted since is NOT
-- correctly described by their current role.
-- ============================================================

CREATE OR REPLACE FUNCTION public.nomination_decision(p_nomination_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
  SELECT CASE n.status
    WHEN 'approved' THEN jsonb_build_object(
      'action',     'approve',
      'at',         n.approved_at,
      'actor_id',   n.approved_by_id,
      'actor_name', ap.full_name,
      'actor_role', n.approved_by_role,
      'reason',     NULL,
      'note',       NULL
    )
    WHEN 'rejected' THEN jsonb_build_object(
      'action',     'reject',
      'at',         n.rejected_at,
      'actor_id',   n.rejected_by_id,
      'actor_name', rj.full_name,
      'actor_role', n.rejected_by_role,
      'reason',     n.rejection_reason,
      'note',       NULL
    )
    WHEN 'clarification_requested' THEN jsonb_build_object(
      'action',     'request_clarification',
      'at',         n.clarification_requested_at,
      'actor_id',   n.clarification_requested_by_id,
      'actor_name', cl.full_name,
      'actor_role', n.clarification_requested_by_role,
      'reason',     NULL,
      'note',       n.clarification_note
    )
    ELSE NULL
  END
  FROM nominations n
  LEFT JOIN employees ap ON ap.id = n.approved_by_id
  LEFT JOIN employees rj ON rj.id = n.rejected_by_id
  LEFT JOIN employees cl ON cl.id = n.clarification_requested_by_id
  WHERE n.id = p_nomination_id;
$fn$;

REVOKE EXECUTE ON FUNCTION public.nomination_decision(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.nomination_decision(uuid) TO authenticated;

COMMENT ON FUNCTION public.nomination_decision(uuid) IS
  'Who decided a nomination, how and when, or NULL while it is still pending. Name resolved through the foreign key; role read from the snapshot taken at the time.';


-- ============================================================
-- PART E -- the atomic decision
--
-- THE CONCURRENCY BOUNDARY. Everything about "only one authority wins" is the
-- SELECT ... FOR UPDATE below and nothing else.
--
--   T1  SELECT ... FOR UPDATE   takes the row lock, sees 'pending', updates
--   T2  SELECT ... FOR UPDATE   BLOCKS until T1 commits, then re-reads the row,
--                               sees 'approved', returns already_handled
--
-- Under READ COMMITTED a locking read re-evaluates against the row version the
-- blocking transaction committed, which is exactly the property needed. The
-- `AND status = 'pending'` on each UPDATE is belt and braces on top of it, and
-- ROW_COUNT is checked rather than assumed.
--
-- Note what is NOT relied on: no advisory lock, no version column, no
-- SERIALIZABLE retry loop, and nothing whatsoever in the browser.
--
--
-- WHY service_role ONLY
-- ---------------------
-- EXECUTE is granted to service_role and to nobody else -- deliberately NOT to
-- `authenticated`. The state change is only half of an approval: the other half
-- is the notifications, the badge recalculation and the reciprocal-pattern
-- check that process-approval orchestrates around it. A browser able to call
-- this directly could approve a recognition and skip all of that, producing an
-- approved recognition that never reached the nominee's badges. Keeping the
-- grant off `authenticated` means there is exactly one path.
--
-- The caller's IDENTITY and SECOND FACTOR are therefore established by
-- process-approval, which holds the JWT: it validates the token, calls
-- session_second_factor_ok_for() with the session id read from that token, and
-- resolves the actor from employees.auth_user_id. p_actor_id is that resolved
-- id -- never a value from the request body. AUTHORIZATION is established here,
-- by Part C, so the database refuses regardless of what the function asks for.
--
-- The audit row is written INSIDE this function, in the same transaction as the
-- state change. It used to be written afterwards by the Edge Function, where a
-- failure lost the record of a decision that had already happened.
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_nomination_decision(
  p_nomination_id      uuid,
  p_actor_id           uuid,
  p_action             text,
  p_reason             text DEFAULT NULL,
  p_clarification_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  nom       nominations%ROWTYPE;
  actor     employees%ROWTYPE;
  verdict   text;
  affected  integer;
  reason    text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  note      text := NULLIF(btrim(COALESCE(p_clarification_note, '')), '');
  new_state text;
  audit_act text;
BEGIN
  IF p_action NOT IN ('approve', 'reject', 'request_clarification') THEN
    RETURN jsonb_build_object('status', 'invalid_action');
  END IF;

  -- Argument validation before the lock: no point holding a row to refuse an
  -- empty rejection reason.
  IF p_action = 'reject' AND reason IS NULL THEN
    RETURN jsonb_build_object('status', 'reason_required');
  END IF;

  IF p_action = 'request_clarification' AND note IS NULL THEN
    RETURN jsonb_build_object('status', 'note_required');
  END IF;

  SELECT * INTO actor FROM employees WHERE id = p_actor_id;
  IF actor.id IS NULL THEN
    RETURN jsonb_build_object('status', 'unknown_actor');
  END IF;

  -- THE LOCK. Held to the end of the transaction. See the header.
  SELECT * INTO nom FROM nominations WHERE id = p_nomination_id FOR UPDATE;
  IF nom.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- Read AFTER the lock, so a decision committed while we waited is seen.
  verdict := public.nomination_decision_authority(p_nomination_id, p_actor_id);

  IF verdict = 'already_handled' THEN
    RETURN jsonb_build_object(
      'status',            'already_handled',
      'nomination_status', nom.status,
      'decision',          public.nomination_decision(nom.id)
    );
  END IF;

  IF verdict <> 'ok' THEN
    RETURN jsonb_build_object('status', verdict);
  END IF;

  IF p_action = 'approve' THEN
    new_state := 'approved';
    audit_act := 'nomination_approved';

    UPDATE nominations
       SET status           = 'approved',
           approved_by_id   = actor.id,
           approved_by_role = actor.role,
           approved_at      = now(),
           published_at     = now()
     WHERE id = nom.id
       AND status = 'pending';

  ELSIF p_action = 'reject' THEN
    new_state := 'rejected';
    audit_act := 'nomination_rejected';

    UPDATE nominations
       SET status           = 'rejected',
           rejected_by_id   = actor.id,
           rejected_by_role = actor.role,
           rejected_at      = now(),
           rejection_reason = reason
     WHERE id = nom.id
       AND status = 'pending';

  ELSE
    new_state := 'clarification_requested';
    audit_act := 'nomination_clarification_requested';

    UPDATE nominations
       SET status                          = 'clarification_requested',
           clarification_requested_by_id   = actor.id,
           clarification_requested_by_role = actor.role,
           clarification_requested_at      = now(),
           clarification_note              = note,
           /*
             Cleared so a SECOND clarification round is coherent. Without this
             a re-request leaves clarification_responded_at pointing at the
             answer to the PREVIOUS question, which reads as "already
             answered" for a question nobody has answered yet.
           */
           clarification_responded_at      = NULL
     WHERE id = nom.id
       AND status = 'pending';
  END IF;

  GET DIAGNOSTICS affected = ROW_COUNT;

  -- Unreachable while the lock above is held, and checked anyway: a decision
  -- reported as successful when no row changed is the failure this whole
  -- function exists to make impossible.
  IF affected = 0 THEN
    SELECT * INTO nom FROM nominations WHERE id = p_nomination_id;
    RETURN jsonb_build_object(
      'status',            'already_handled',
      'nomination_status', nom.status,
      'decision',          public.nomination_decision(nom.id)
    );
  END IF;

  /*
    Settle the other authorities' notifications rather than sending new ones.

    Every authority who was asked to review this recognition holds an
    'approval_required' notification. Once one of them has acted, that request
    is answered -- so it is REWRITTEN IN PLACE to say who answered it and marked
    read, which clears their bell without adding a row. Sending each of them a
    fresh "this was handled" notification would be one message per authority per
    decision, for information they can already see in the queue.

    Scoped to type = 'approval_required', so the nominator's and nominee's own
    notifications are untouched.
  */
  UPDATE notifications
     SET title   = 'Recognition already reviewed',
         body    = COALESCE(public.role_label(actor.role) || ' — ', '')
                   || actor.full_name || ' '
                   || CASE p_action
                        WHEN 'approve' THEN 'approved'
                        WHEN 'reject'  THEN 'rejected'
                        ELSE 'requested clarification on'
                      END
                   || ' this recognition.',
         is_read = true,
         read_at = COALESCE(read_at, now())
   WHERE related_id   = nom.id
     AND related_type = 'nomination'
     AND type         = 'approval_required';

  /*
    The audit row, in the SAME TRANSACTION as the decision.

    Action names are the ones AuditLogsPage already filters on, so its dropdown
    keeps working. actor_role and the reason go in new_value, which is jsonb and
    has always been free-form.
  */
  INSERT INTO audit_logs (actor_id, actor_email, action, entity_type, entity_id,
                          previous_value, new_value)
  VALUES (
    actor.id,
    actor.email,
    audit_act,
    'nomination',
    nom.id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object(
      'status',     new_state,
      'actor_id',   actor.id,
      'actor_role', actor.role,
      'reason',     reason,
      'note',       note
    )
  );

  RETURN jsonb_build_object(
    'status',            'ok',
    'action',            p_action,
    'nomination_status', new_state,
    'decision',          public.nomination_decision(nom.id)
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.record_nomination_decision(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_nomination_decision(uuid, uuid, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.record_nomination_decision(uuid, uuid, text, text, text) IS
  'The one atomic approval decision. Locks the row, refuses anything already handled, records the actor and their role, settles the other authorities'' notifications and writes the audit row -- all in one transaction. service_role only: process-approval is the sole caller.';


-- ============================================================
-- PART F -- a decision cannot be forged from a browser session
--
-- nominations_hr_update (003/022) lets an HR Admin or Super Admin UPDATE any
-- nomination through PostgREST. Nothing stopped one of them writing
--
--     PATCH /rest/v1/nominations?id=eq.<x>
--     { "status": "approved", "approved_by_id": "<somebody else>" }
--
-- which records a decision that nobody made, attributed to a person who did not
-- make it -- and skips the lock, the notifications and the badge recalculation
-- on the way past. That policy is not weakened here; this makes the forgery
-- impossible instead.
--
-- Scoped as narrowly as it can be:
--
--   auth.uid() IS NULL   untouched. The established escape hatch -- the service
--                        role (so record_nomination_decision, called by the
--                        Edge Function, passes), migrations, seeders, the SQL
--                        editor. Same rule as 026/029/030/041.
--   -> 'removed'         untouched. remove_recognition() (034) is a SECURITY
--                        DEFINER RPC that runs with auth.uid() set, and soft
--                        deletion is not a decision.
--   -> 'pending'         untouched. This is the nominator answering a
--                        clarification request, guarded by
--                        enforce_nominator_update_scope() (009).
--   content edits        untouched. moderate_recognition() (034) has no status
--                        or actor parameter at all.
--
-- What is refused: a browser session moving a nomination INTO a decided state,
-- or touching any actor column. Both only ever happen legitimately inside
-- record_nomination_decision().
-- ============================================================

CREATE OR REPLACE FUNCTION public.guard_nomination_decision_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- Trusted, identity-less callers: the service role (and therefore
  -- record_nomination_decision), migrations, seeders, the SQL editor.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('approved', 'rejected', 'clarification_requested')
  THEN
    RAISE EXCEPTION
      'Recognition decisions are recorded through the approval workflow.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.approved_by_id                  IS DISTINCT FROM OLD.approved_by_id
     OR NEW.approved_by_role             IS DISTINCT FROM OLD.approved_by_role
     OR NEW.approved_at                  IS DISTINCT FROM OLD.approved_at
     OR NEW.rejected_by_id               IS DISTINCT FROM OLD.rejected_by_id
     OR NEW.rejected_by_role             IS DISTINCT FROM OLD.rejected_by_role
     OR NEW.rejected_at                  IS DISTINCT FROM OLD.rejected_at
     OR NEW.rejection_reason             IS DISTINCT FROM OLD.rejection_reason
     OR NEW.clarification_requested_by_id   IS DISTINCT FROM OLD.clarification_requested_by_id
     OR NEW.clarification_requested_by_role IS DISTINCT FROM OLD.clarification_requested_by_role
     OR NEW.clarification_requested_at      IS DISTINCT FROM OLD.clarification_requested_at
  THEN
    RAISE EXCEPTION
      'Who decided a recognition cannot be edited.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.guard_nomination_decision_integrity() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS guard_nomination_decision_integrity ON nominations;
CREATE TRIGGER guard_nomination_decision_integrity
  BEFORE UPDATE ON nominations
  FOR EACH ROW EXECUTE FUNCTION public.guard_nomination_decision_integrity();


-- ============================================================
-- PART G -- the approval queue, scoped by the caller's own role
--
-- Takes NO ARGUMENTS, for the same reason managed_projects() (040) takes none:
-- the identity a queue is scoped by must not be a value in the request.
-- getPendingApprovals() took an approver id from the browser; there was nothing
-- to gain by changing it (the policies refused), but there was nothing to read
-- either that said so.
--
--   manager      assigned_approver_id = me   -- what 029/030 routed to them
--   hr_admin     every recognition
--   super_admin  every recognition
--   anyone else  nothing
--
-- SECURITY INVOKER, so the policies quoted in the header still decide and this
-- can only ever NARROW them. If nominations_read_approver is tightened later,
-- this narrows with it.
--
-- WHY HANDLED ONES ARE INCLUDED
-- -----------------------------
-- A recognition that disappears from HR's queue the moment a Manager approves
-- it looks like a recognition that vanished. Recently decided rows stay, with
-- the decision attached, so every authority can see what happened and who did
-- it. `can_act` is false on those, and the database refuses them regardless.
--
-- Bounded by time rather than by count so the queue cannot grow without limit;
-- the full history remains in My Recognitions, the feed and the audit log.
-- ============================================================

CREATE OR REPLACE FUNCTION public.recognition_approval_queue()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
  -- COALESCE so an empty queue is [] rather than NULL: the page distinguishes
  -- "nothing to review" from "could not load".
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',                       n.id,
        'status',                   n.status,
        'submitted_at',             n.submitted_at,
        'created_at',               n.created_at,
        'what_happened',            n.what_happened,
        'what_impact',              n.what_impact,
        'snapshot_core_value_name', n.snapshot_core_value_name,
        'snapshot_behaviour_name',  n.snapshot_behaviour_name,
        'snapshot_project_name',    n.snapshot_project_name,
        'nominator', jsonb_build_object(
          'id', nr.id, 'full_name', nr.full_name, 'avatar_url', nr.avatar_url, 'role', nr.role),
        'nominee', jsonb_build_object(
          'id', ne.id, 'full_name', ne.full_name, 'avatar_url', ne.avatar_url, 'role', ne.role),
        'core_value', jsonb_build_object(
          'id', cv.id, 'name', cv.name, 'slug', cv.slug,
          'accent_color', cv.accent_color, 'icon', cv.icon),
        'behaviour', CASE WHEN b.id IS NULL THEN NULL
                          ELSE jsonb_build_object('id', b.id, 'name', b.name) END,
        'project',   CASE WHEN p.id IS NULL THEN NULL
                          ELSE jsonb_build_object('id', p.id, 'name', p.name) END,
        -- Who it was ROUTED to, which is not necessarily who decided it.
        'assigned_approver', CASE WHEN ap.id IS NULL THEN NULL
                          ELSE jsonb_build_object(
                            'id', ap.id, 'full_name', ap.full_name, 'role', ap.role) END,
        'decision',  public.nomination_decision(n.id),
        -- The SAME rule the decision function enforces, so the buttons and the
        -- database can never disagree. Advisory: Part E refuses anyway.
        'can_act',   public.nomination_decision_authority(n.id, public.employee_id()) = 'ok'
      )
      -- Waiting first, oldest first: a queue is worked front to back. Handled
      -- ones follow, most recent first.
      ORDER BY (n.status <> 'pending'),
               CASE WHEN n.status = 'pending' THEN n.submitted_at END ASC,
               COALESCE(n.approved_at, n.rejected_at, n.clarification_requested_at) DESC
    ),
    '[]'::jsonb
  )
  FROM nominations n
  JOIN employees   nr ON nr.id = n.nominator_id
  JOIN employees   ne ON ne.id = n.nominee_id
  JOIN core_values cv ON cv.id = n.core_value_id
  LEFT JOIN behaviours b  ON b.id  = n.behaviour_id
  LEFT JOIN projects   p  ON p.id  = n.project_id
  LEFT JOIN employees  ap ON ap.id = n.assigned_approver_id

  WHERE n.status IN ('pending', 'approved', 'rejected', 'clarification_requested')
    AND (
      n.status = 'pending'
      OR COALESCE(n.approved_at, n.rejected_at, n.clarification_requested_at)
         >= now() - interval '30 days'
    )
    -- The scoping. From the session, never from an argument.
    AND CASE public.current_employee_role()
          WHEN 'manager'     THEN n.assigned_approver_id = public.employee_id()
          WHEN 'hr_admin'    THEN true
          WHEN 'super_admin' THEN true
          ELSE false
        END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.recognition_approval_queue() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.recognition_approval_queue() TO authenticated;

COMMENT ON FUNCTION public.recognition_approval_queue() IS
  'Recognitions the CALLER may review: a Manager''s are those routed to them by project, HR''s and a Super Admin''s are organisation-wide. Takes no arguments. Recently decided ones are included, with who decided them. SECURITY INVOKER -- the nominations policies still decide.';


-- ============================================================
-- PART H -- tell all three authorities a recognition is waiting
--
-- Redefines notify_nomination_submitted() (009). The existing behaviour is kept
-- byte for byte -- the assigned approver still gets the same 'approval_required'
-- notification, with the same title and body -- and the HR Admins and Super
-- Admins are added alongside.
--
-- NO NEW NOTIFICATION TYPE: 'approval_required' is what this is, for all of
-- them, and the type column is a CHECK constraint that a new value would have
-- to be added to.
--
-- Who is deliberately NOT notified:
--   the assigned approver, twice          they are the first insert
--   the nominator and the nominee         they cannot decide it (Part C), so
--                                         asking them to review it is noise
--   inactive accounts                     nobody is waiting on them
--
-- Cost: one row per active HR Admin and Super Admin per submission. That is the
-- requirement -- all three authorities receive the request -- and it is bounded
-- by how many administrators exist, not by anything that grows.
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_nomination_submitted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  nominator_name text;
  value_name     text;
  title          text := 'A recognition needs your review';
  body           text;
BEGIN
  -- Drafts have not been submitted to anyone yet.
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO nominator_name FROM employees WHERE id = NEW.nominator_id;
  value_name := COALESCE(NEW.snapshot_core_value_name, 'a Core Value');

  body := COALESCE(nominator_name, 'A colleague')
          || ' submitted a recognition for ' || value_name || '.';

  -- 1. The approver it was ROUTED to. Unchanged from 009, including the
  --    assigned_approver_id IS NULL guard that used to sit in the early return.
  IF NEW.assigned_approver_id IS NOT NULL THEN
    INSERT INTO notifications (recipient_id, type, title, body, related_id, related_type)
    VALUES (NEW.assigned_approver_id, 'approval_required', title, body, NEW.id, 'nomination');
  END IF;

  -- 2. The organisation-wide authorities.
  INSERT INTO notifications (recipient_id, type, title, body, related_id, related_type)
  SELECT e.id, 'approval_required', title, body, NEW.id, 'nomination'
    FROM employees e
   WHERE e.role IN ('hr_admin', 'super_admin')
     AND e.is_active
     AND e.id IS DISTINCT FROM NEW.assigned_approver_id
     AND e.id <> NEW.nominator_id
     AND e.id <> NEW.nominee_id;

  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.notify_nomination_submitted() FROM PUBLIC;

-- The trigger itself is unchanged (AFTER INSERT, 009). Recreated only so this
-- migration is safe to run against a database where it was dropped.
DROP TRIGGER IF EXISTS notify_nomination_submitted ON nominations;
CREATE TRIGGER notify_nomination_submitted
  AFTER INSERT ON nominations
  FOR EACH ROW EXECUTE FUNCTION public.notify_nomination_submitted();


NOTIFY pgrst, 'reload schema';


-- ============================================================
-- Verification
--
-- Printed when the migration runs. Every boolean expected true.
-- ============================================================
SELECT '042 APPLIED' AS check,
       -- The actor columns exist.
       (SELECT count(*) = 4 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'nominations'
           AND column_name IN ('clarification_requested_by_id', 'approved_by_role',
                               'rejected_by_role', 'clarification_requested_by_role'))
                                                                      AS actor_columns_present,
       -- The queue takes no arguments: nothing in the request to steer it.
       (SELECT pronargs = 0 FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'recognition_approval_queue')                 AS queue_takes_no_arguments,
       -- ...and is INVOKER, so the nominations policies still decide.
       (SELECT NOT prosecdef FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'recognition_approval_queue')                 AS queue_is_security_invoker,
       -- The decision function locks the row. This is the concurrency rule.
       (SELECT pg_get_functiondef(oid) LIKE '%FOR UPDATE%' FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'record_nomination_decision')                 AS decision_locks_row,
       -- A browser cannot call the decision function at all.
       NOT has_function_privilege('authenticated',
         'public.record_nomination_decision(uuid,uuid,text,text,text)', 'EXECUTE')
                                                                      AS decision_not_callable_by_browser,
       has_function_privilege('service_role',
         'public.record_nomination_decision(uuid,uuid,text,text,text)', 'EXECUTE')
                                                                      AS decision_callable_by_edge_function,
       -- The forgery guard is attached.
       EXISTS (SELECT 1 FROM pg_trigger
                WHERE tgrelid = 'public.nominations'::regclass
                  AND tgname = 'guard_nomination_decision_integrity')  AS forgery_guard_attached,
       -- Routing is untouched: still the project's manager, never the nominee's.
       (SELECT pg_get_functiondef(oid) NOT LIKE '%e.manager_id%' FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'route_nomination_to_project_manager')        AS routing_untouched,
       -- 041's nominee rule is still in place.
       EXISTS (SELECT 1 FROM pg_trigger
                WHERE tgrelid = 'public.nominations'::regclass
                  AND tgname = 'check_nomination_eligibility')         AS nominee_rule_intact,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')  AS policies_untouched;
-- EXPECT every boolean true. No policy is created, altered or dropped here.


-- ============================================================
-- ROLLBACK
--
--   DROP TRIGGER  IF EXISTS guard_nomination_decision_integrity ON nominations;
--   DROP FUNCTION IF EXISTS public.guard_nomination_decision_integrity();
--   DROP FUNCTION IF EXISTS public.recognition_approval_queue();
--   DROP FUNCTION IF EXISTS public.record_nomination_decision(uuid,uuid,text,text,text);
--   DROP FUNCTION IF EXISTS public.nomination_decision(uuid);
--   DROP FUNCTION IF EXISTS public.nomination_decision_authority(uuid,uuid);
--   DROP FUNCTION IF EXISTS public.role_label(text);
--   -- and restore notify_nomination_submitted() from 009.
--
-- The four columns are deliberately NOT dropped by this rollback: they hold the
-- record of who decided what, which is the thing least safe to throw away.
-- ============================================================
