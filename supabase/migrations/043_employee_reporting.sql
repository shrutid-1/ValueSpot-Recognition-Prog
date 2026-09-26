-- ============================================================
-- 043 -- Employee reporting: scope, aggregates, and an AI insight cache
--
-- Additive. One table, six functions. No policy is altered or dropped. Safe to
-- run more than once. Requires 001-042.
--
--
-- WHAT THIS ADDS
-- --------------
--   report_actor()          who is asking, resolved from the session
--   may_report_on()         whether they may report on a given employee
--   report_subjects()       the employees they may choose from
--   employee_report()       one employee's whole factual report, in ONE call
--   organization_report()   the consolidated organisation report, in ONE call
--   report_ai_insights      the cache the AI interpretation layer writes to
--
--
-- THE SCOPE RULE, WHICH IS THE WHOLE SECURITY STORY
-- ------------------------------------------------
--     manager      the active members of the ACTIVE PROJECTS THEY MANAGE
--     hr_admin     every employee
--     super_admin  every employee
--     anyone else  nobody
--
-- The manager definition is copied from nowhere and shared with everything:
-- it is the same expression as evb_read_team (039), listTeamMemberIds() and
-- managed_projects() (040) --
--
--     project_members -> projects.manager_id
--
-- employees.manager_id is NOT consulted and must not be (030). A report is
-- exactly as scoped as Team Badges already is.
--
--
-- WHY THE REPORTS ARE SECURITY DEFINER
-- ------------------------------------
-- This is the one place in this migration that widens anything, so it is worth
-- being precise about what and why.
--
-- A Manager cannot READ a team member's nomination rows: nominations_read_
-- approver (003/022) only admits rows assigned to them. So an aggregate built
-- under the caller's own policies would silently under-count -- a manager would
-- see "3 recognitions" for someone who received 11, which is worse than
-- refusing outright.
--
-- The report functions therefore run as definer and do their OWN authorization
-- first, through may_report_on(). What they return is aggregates and names:
-- counts by status, core-value tallies, badge levels, contributor names. They
-- deliberately do NOT return narrative text (what_happened / what_impact), the
-- rejection reason (003 records it as internal), or clarification notes.
--
-- Most of what they aggregate is already company-visible: v_recognition_feed
-- shows every approved recognition to every verified employee. The genuinely
-- new disclosure is the per-employee status mix -- how many of someone's
-- recognitions were rejected or are pending -- to a manager who already
-- approves their team's recognitions, and to HR who already sees every row.
--
--
-- NO NEW REPORT DATA IS STORED
-- ----------------------------
-- Reports are computed on demand from the existing tables. Nothing is
-- materialised, so a report can never disagree with the data it describes, and
-- a project-membership change takes effect on the next request rather than on
-- the next rebuild. The ONE thing persisted is the AI interpretation, because
-- regenerating that costs money rather than milliseconds.
--
--
-- PERIOD BOUNDS ARE IST CALENDAR DATES
-- ------------------------------------
-- Every timestamp is stored in UTC and bucketed in Asia/Kolkata, matching
-- recognition_monthly_trend() (028) and the formatIST() the whole UI displays
-- through. A recognition approved at 02:00 IST on 1 October belongs to October,
-- not to 20:30 UTC on 30 September. The UTC pre-filters beside each date test
-- exist only so the indexes on approved_at / submitted_at stay usable.
-- ============================================================


-- ============================================================
-- PART A -- who is asking
--
-- The claimed id is honoured ONLY for identity-less callers: the Edge Function
-- running under the service role, migrations, the SQL editor. Same escape
-- hatch as 026/029/041/042. For a browser session auth.uid() is set, the
-- claimed id is ignored entirely, and the answer comes from the employees
-- table gated on the emailed second factor -- so passing somebody else's id
-- from the network tab changes nothing.
-- ============================================================

CREATE OR REPLACE FUNCTION public.report_actor(p_claimed_actor_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN p_claimed_actor_id
    ELSE (
      SELECT e.id
        FROM employees e
       WHERE e.auth_user_id = auth.uid()
         AND e.is_active
         AND public.session_second_factor_ok()
       LIMIT 1
    )
  END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.report_actor(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.report_actor(uuid) TO authenticated;

COMMENT ON FUNCTION public.report_actor(uuid) IS
  'The employee a report request is made by. The claimed id is honoured only for identity-less callers (the Edge Function under the service role); a browser session resolves from auth.uid() and the second factor.';


-- ============================================================
-- PART B -- may this person report on that employee
--
-- One definition, used by the subject list, both report functions and the AI
-- Edge Function. A second copy is how a selector and a report end up
-- disagreeing about who is in scope.
-- ============================================================

CREATE OR REPLACE FUNCTION public.may_report_on(
  p_actor_id    uuid,
  p_employee_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  actor_role text;
BEGIN
  IF p_actor_id IS NULL OR p_employee_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT role INTO actor_role
    FROM employees
   WHERE id = p_actor_id AND is_active;

  IF actor_role IS NULL THEN
    RETURN false;
  END IF;

  IF actor_role IN ('hr_admin', 'super_admin') THEN
    RETURN true;
  END IF;

  IF actor_role = 'manager' THEN
    /*
      The team, defined exactly as evb_read_team (039) and listTeamMemberIds()
      define it: the active members of the ACTIVE projects this person manages.
      Both is_active tests matter -- an archived project is not a team any
      more, and somebody who has left the project is not on it.

      EXISTS, so an employee on three of this manager's projects is in scope
      once rather than three times.
    */
    RETURN EXISTS (
      SELECT 1
        FROM project_members pm
        JOIN projects p ON p.id = pm.project_id
       WHERE pm.employee_id = p_employee_id
         AND pm.is_active
         AND p.manager_id = p_actor_id
         AND p.is_active
    );
  END IF;

  -- Employees have no reporting scope at all, including over themselves.
  RETURN false;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.may_report_on(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.may_report_on(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.may_report_on(uuid, uuid) IS
  'Whether an actor may see reports for an employee. Managers are scoped to the active members of the active projects they manage (project_members -> projects.manager_id, never employees.manager_id); HR and Super Admin are organisation-wide.';


-- ============================================================
-- PART C -- the employees this caller may choose from
--
-- The report subject picker. Takes a search term and nothing else: the scope
-- comes from the session, so there is no parameter that would let a Manager
-- ask for somebody else's team. Same shape of argument-lessness as
-- recognition_candidates() (041) and recognition_approval_queue() (042).
--
-- Deliberately DISTINCT: an employee on two of a manager's projects is one
-- person to report on, listed once.
-- ============================================================

CREATE OR REPLACE FUNCTION public.report_subjects(p_search text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',          s.id,
        'full_name',   s.full_name,
        'employee_id', s.employee_id,
        'email',       s.email,
        'role',        s.role,
        'avatar_url',  s.avatar_url,
        'department',  s.department_name,
        'projects',    s.projects
      )
      ORDER BY s.full_name
    ),
    '[]'::jsonb
  )
  FROM (
    SELECT DISTINCT ON (e.id)
           e.id, e.full_name, e.employee_id, e.email, e.role, e.avatar_url,
           d.name AS department_name,
           COALESCE((
             SELECT jsonb_agg(p2.name ORDER BY p2.name)
               FROM project_members pm2
               JOIN projects p2 ON p2.id = pm2.project_id
              WHERE pm2.employee_id = e.id AND pm2.is_active AND p2.is_active
           ), '[]'::jsonb) AS projects
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.is_active
       AND public.may_report_on(public.report_actor(), e.id)
       AND (
         p_search IS NULL
         OR length(btrim(p_search)) < 2
         OR e.full_name   ILIKE '%' || btrim(p_search) || '%'
         OR e.email       ILIKE '%' || btrim(p_search) || '%'
         OR e.employee_id ILIKE '%' || btrim(p_search) || '%'
       )
     ORDER BY e.id, e.full_name
  ) s;
$fn$;

REVOKE EXECUTE ON FUNCTION public.report_subjects(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.report_subjects(text) TO authenticated;

COMMENT ON FUNCTION public.report_subjects(text) IS
  'Employees the CALLER may report on, optionally filtered by a search term. Scope comes from the session, never from an argument. One row per employee however many of the manager''s projects they are on.';


-- ============================================================
-- PART D -- one employee's factual report
--
-- ONE call returns the whole thing. Not one call per section and emphatically
-- not one call per core value: the alternative that this replaces is a page
-- issuing a query per badge, per value and per contributor, which is the N+1
-- this whole function exists to avoid.
--
-- Everything here is COUNTED FROM THE DATABASE. Nothing in this function
-- interprets, ranks by quality, or scores. The words "strength" and
-- "improvement" do not appear in its output, because recognition counts are
-- evidence of recognition, not of performance -- the interpretation layer is
-- separate, clearly labelled, and downstream of this.
-- ============================================================

CREATE OR REPLACE FUNCTION public.employee_report(
  p_employee_id       uuid,
  p_start             date,
  p_end               date,
  p_prev_start        date DEFAULT NULL,
  p_prev_end          date DEFAULT NULL,
  p_claimed_actor_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  tz          text := 'Asia/Kolkata';
  actor_id    uuid := public.report_actor(p_claimed_actor_id);
  emp         employees%ROWTYPE;
  span_days   integer;
  granularity text;
  result      jsonb;
  profile     jsonb;
  recognition jsonb;
  values_json jsonb;
  behaviours  jsonb;
  badges      jsonb;
  projects    jsonb;
  contributors jsonb;
  trend       jsonb;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN
    RETURN jsonb_build_object('status', 'invalid_period');
  END IF;

  IF NOT public.may_report_on(actor_id, p_employee_id) THEN
    -- One answer for "not allowed" and "no such employee", so the report
    -- cannot be used to discover who exists outside the caller's scope.
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  SELECT * INTO emp FROM employees WHERE id = p_employee_id;
  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  span_days   := (p_end - p_start) + 1;
  -- A month reads week by week; anything longer reads month by month. Chosen
  -- from the span rather than from the report type so a custom range still
  -- buckets sensibly.
  granularity := CASE WHEN span_days <= 62 THEN 'week' ELSE 'month' END;

  -- ── Profile ───────────────────────────────────────────────
  SELECT jsonb_build_object(
    'id',          emp.id,
    'full_name',   emp.full_name,
    'employee_id', emp.employee_id,
    'role',        emp.role,
    'department',  (SELECT d.name FROM departments d WHERE d.id = emp.department_id),
    'joined_at',   emp.joined_at,
    'is_active',   emp.is_active
    -- Email, auth identity and the deprecated manager_id are deliberately
    -- absent: a performance report has no use for them.
  ) INTO profile;

  -- ── Recognition summary ───────────────────────────────────
  WITH received AS (
    SELECT n.status, n.nominator_id
      FROM nominations n
     WHERE n.nominee_id = p_employee_id
       AND n.status <> 'removed'
       AND n.submitted_at IS NOT NULL
       AND n.submitted_at >= (p_start - 1)::timestamptz
       AND n.submitted_at <  (p_end + 2)::timestamptz
       AND (n.submitted_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end
  ),
  given AS (
    SELECT n.status
      FROM nominations n
     WHERE n.nominator_id = p_employee_id
       AND n.status <> 'removed'
       AND n.submitted_at IS NOT NULL
       AND n.submitted_at >= (p_start - 1)::timestamptz
       AND n.submitted_at <  (p_end + 2)::timestamptz
       AND (n.submitted_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end
  ),
  prev AS (
    SELECT
      count(*) FILTER (WHERE n.nominee_id = p_employee_id)   AS received_approved,
      count(*) FILTER (WHERE n.nominator_id = p_employee_id) AS given_approved
      FROM nominations n
     WHERE p_prev_start IS NOT NULL AND p_prev_end IS NOT NULL
       AND n.status = 'approved'
       AND n.approved_at IS NOT NULL
       AND n.approved_at >= (p_prev_start - 1)::timestamptz
       AND n.approved_at <  (p_prev_end + 2)::timestamptz
       AND (n.approved_at AT TIME ZONE tz)::date BETWEEN p_prev_start AND p_prev_end
       AND (n.nominee_id = p_employee_id OR n.nominator_id = p_employee_id)
  )
  SELECT jsonb_build_object(
    'received', jsonb_build_object(
      'total',                   (SELECT count(*) FROM received),
      'approved',                (SELECT count(*) FROM received WHERE status = 'approved'),
      'pending',                 (SELECT count(*) FROM received WHERE status = 'pending'),
      'rejected',                (SELECT count(*) FROM received WHERE status = 'rejected'),
      'clarification_requested', (SELECT count(*) FROM received WHERE status = 'clarification_requested')
    ),
    'given', jsonb_build_object(
      'total',                   (SELECT count(*) FROM given),
      'approved',                (SELECT count(*) FROM given WHERE status = 'approved'),
      'pending',                 (SELECT count(*) FROM given WHERE status = 'pending'),
      'rejected',                (SELECT count(*) FROM given WHERE status = 'rejected'),
      'clarification_requested', (SELECT count(*) FROM given WHERE status = 'clarification_requested')
    ),
    -- How many DIFFERENT colleagues recognised them: one person recognising
    -- somebody nine times is a different fact from nine people doing it once.
    'unique_recognizers', (SELECT count(DISTINCT nominator_id) FROM received WHERE status = 'approved'),
    'previous', CASE
      WHEN p_prev_start IS NULL THEN NULL
      ELSE jsonb_build_object(
        'received_approved', (SELECT received_approved FROM prev),
        'given_approved',    (SELECT given_approved FROM prev)
      )
    END
  ) INTO recognition;

  -- ── Core values, with their behaviours and scenarios ───────
  --
  -- Every ACTIVE core value appears, including the ones with no recognitions.
  -- A value missing from the list would read as "not applicable"; a value
  -- present with a count of zero reads as what it is -- no recognition
  -- recorded against it in this period, which is a fact about the RECOGNITION
  -- DATA and not about the person.
  WITH period AS (
    SELECT n.*
      FROM nominations n
     WHERE n.nominee_id = p_employee_id
       AND n.status = 'approved'
       AND n.approved_at IS NOT NULL
       AND n.approved_at >= (p_start - 1)::timestamptz
       AND n.approved_at <  (p_end + 2)::timestamptz
       AND (n.approved_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end
  ),
  totals AS (SELECT count(*)::numeric AS n FROM period),
  per_value AS (
    SELECT cv.id, cv.name, cv.slug, cv.accent_color, cv.display_order,
           count(p.id) AS cnt
      FROM core_values cv
      LEFT JOIN period p ON p.core_value_id = cv.id
     WHERE cv.is_active
     GROUP BY cv.id, cv.name, cv.slug, cv.accent_color, cv.display_order
  ),
  prev_value AS (
    SELECT n.core_value_id, count(*) AS cnt
      FROM nominations n
     WHERE p_prev_start IS NOT NULL AND p_prev_end IS NOT NULL
       AND n.nominee_id = p_employee_id
       AND n.status = 'approved'
       AND n.approved_at IS NOT NULL
       AND n.approved_at >= (p_prev_start - 1)::timestamptz
       AND n.approved_at <  (p_prev_end + 2)::timestamptz
       AND (n.approved_at AT TIME ZONE tz)::date BETWEEN p_prev_start AND p_prev_end
     GROUP BY n.core_value_id
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',            v.id,
      'name',          v.name,
      'slug',          v.slug,
      'accent_color',  v.accent_color,
      'count',         v.cnt,
      'share_pct',     CASE WHEN (SELECT n FROM totals) > 0
                            THEN round(100 * v.cnt / (SELECT n FROM totals), 1)
                            ELSE 0 END,
      'previous_count', COALESCE((SELECT cnt FROM prev_value pv WHERE pv.core_value_id = v.id), 0),
      'behaviours', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('name', t.bn, 'count', t.c) ORDER BY t.c DESC, t.bn)
          FROM (
            SELECT COALESCE(p.snapshot_behaviour_name, b.name) AS bn, count(*) AS c
              FROM period p
              LEFT JOIN behaviours b ON b.id = p.behaviour_id
             WHERE p.core_value_id = v.id
               AND COALESCE(p.snapshot_behaviour_name, b.name) IS NOT NULL
             GROUP BY 1
             ORDER BY 2 DESC
             LIMIT 5
          ) t
      ), '[]'::jsonb),
      'scenarios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('name', t.sn, 'count', t.c) ORDER BY t.c DESC, t.sn)
          FROM (
            SELECT COALESCE(p.snapshot_scenario_name, s.name) AS sn, count(*) AS c
              FROM period p
              LEFT JOIN scenarios s ON s.id = p.scenario_id
             WHERE p.core_value_id = v.id
               AND COALESCE(p.snapshot_scenario_name, s.name) IS NOT NULL
             GROUP BY 1
             ORDER BY 2 DESC
             LIMIT 5
          ) t
      ), '[]'::jsonb)
    )
    ORDER BY v.cnt DESC, v.display_order
  ), '[]'::jsonb) INTO values_json
  FROM per_value v;

  -- ── Behaviours, across all values ─────────────────────────
  WITH period AS (
    SELECT n.behaviour_id, n.snapshot_behaviour_name, n.core_value_id,
           n.snapshot_core_value_name
      FROM nominations n
     WHERE n.nominee_id = p_employee_id
       AND n.status = 'approved'
       AND n.approved_at IS NOT NULL
       AND n.approved_at >= (p_start - 1)::timestamptz
       AND n.approved_at <  (p_end + 2)::timestamptz
       AND (n.approved_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('name', t.bn, 'core_value', t.cvn, 'count', t.c)
    ORDER BY t.c DESC, t.bn
  ), '[]'::jsonb) INTO behaviours
  FROM (
    SELECT COALESCE(p.snapshot_behaviour_name, b.name) AS bn,
           COALESCE(p.snapshot_core_value_name, cv.name) AS cvn,
           count(*) AS c
      FROM period p
      LEFT JOIN behaviours  b  ON b.id  = p.behaviour_id
      LEFT JOIN core_values cv ON cv.id = p.core_value_id
     WHERE COALESCE(p.snapshot_behaviour_name, b.name) IS NOT NULL
     GROUP BY 1, 2
     ORDER BY 3 DESC
     LIMIT 15
  ) t;

  -- ── Badges ────────────────────────────────────────────────
  --
  -- Two different facts, kept apart. `current` is where the employee stands
  -- now, which is a running annual total and is NOT confined to the report
  -- period -- reporting a level as if it were earned this month would be
  -- wrong. `earned_in_period` is what actually changed inside the period,
  -- read from badge_history, which is the immutable record of level changes.
  SELECT jsonb_build_object(
    'current', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'core_value',              cv.name,
          'core_value_slug',         cv.slug,
          'badge_level',             evb.badge_level,
          'badge_name',              bd.name,
          'badge_description',       bd.description,
          'badge_icon',              bd.icon,
          'recognition_count',       evb.recognition_count,
          'unique_recognizer_count', evb.unique_recognizer_count,
          'period_type',             evb.period_type,
          'period_start',            evb.period_start,
          'period_end',              evb.period_end,
          'next_level_at',           (
            SELECT min(nb.minimum_count)
              FROM badge_definitions nb
             WHERE nb.is_active
               AND nb.minimum_count > evb.recognition_count
          )
        )
        ORDER BY evb.badge_level DESC NULLS LAST, cv.display_order
      )
        FROM employee_value_badges evb
        JOIN core_values cv ON cv.id = evb.core_value_id
        LEFT JOIN badge_definitions bd ON bd.level = evb.badge_level
       WHERE evb.employee_id = p_employee_id
         AND evb.badge_level IS NOT NULL
         AND evb.period_end >= p_start
    ), '[]'::jsonb),
    'earned_in_period', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'core_value',     cv.name,
          'previous_level', bh.previous_level,
          'new_level',      bh.new_level,
          'badge_name',     bd.name,
          'achieved_at',    bh.achieved_at
        )
        ORDER BY bh.achieved_at
      )
        FROM badge_history bh
        JOIN core_values cv ON cv.id = bh.core_value_id
        LEFT JOIN badge_definitions bd ON bd.level = bh.new_level
       WHERE bh.employee_id = p_employee_id
         AND bh.achieved_at >= (p_start - 1)::timestamptz
         AND bh.achieved_at <  (p_end + 2)::timestamptz
         AND (bh.achieved_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end
    ), '[]'::jsonb)
  ) INTO badges;

  -- ── Projects ──────────────────────────────────────────────
  --
  -- Their active memberships, each with the recognitions FILED AGAINST that
  -- project in the period. The recognition's project is the one the recognizer
  -- chose (030), so this is "work recognised on project X", not "recognitions
  -- by someone assigned to X".
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',           p.id,
      'name',         p.name,
      'joined_at',    pm.joined_at,
      'recognitions', (
        SELECT count(*)
          FROM nominations n
         WHERE n.nominee_id = p_employee_id
           AND n.project_id = p.id
           AND n.status = 'approved'
           AND n.approved_at IS NOT NULL
           AND n.approved_at >= (p_start - 1)::timestamptz
           AND n.approved_at <  (p_end + 2)::timestamptz
           AND (n.approved_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end
      )
    )
    ORDER BY p.name
  ), '[]'::jsonb) INTO projects
  FROM project_members pm
  JOIN projects p ON p.id = pm.project_id
  WHERE pm.employee_id = p_employee_id
    AND pm.is_active
    AND p.is_active;

  -- ── Contributors ──────────────────────────────────────────
  --
  -- Who recognised this person, and how often. Approved only: a pending or
  -- rejected recognition is not something its author has said publicly, and
  -- naming them for it would expose a submission that was never published.
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('id', t.id, 'full_name', t.full_name, 'count', t.c)
    ORDER BY t.c DESC, t.full_name
  ), '[]'::jsonb) INTO contributors
  FROM (
    SELECT e.id, e.full_name, count(*) AS c
      FROM nominations n
      JOIN employees e ON e.id = n.nominator_id
     WHERE n.nominee_id = p_employee_id
       AND n.status = 'approved'
       AND n.approved_at IS NOT NULL
       AND n.approved_at >= (p_start - 1)::timestamptz
       AND n.approved_at <  (p_end + 2)::timestamptz
       AND (n.approved_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end
     GROUP BY e.id, e.full_name
     ORDER BY 3 DESC
     LIMIT 10
  ) t;

  -- ── Trend ─────────────────────────────────────────────────
  --
  -- Every bucket in the period is emitted, including the empty ones -- a chart
  -- that silently drops quiet weeks misrepresents the shape of the data.
  -- `sufficient` says whether there is enough to read a direction from; the
  -- UI and the AI layer both refuse to call it a trend when it is false.
  WITH series AS (
    SELECT generate_series(
             CASE WHEN granularity = 'week'
                  THEN date_trunc('week', p_start::timestamp)
                  ELSE date_trunc('month', p_start::timestamp) END,
             p_end::timestamp,
             CASE WHEN granularity = 'week'
                  THEN '1 week'::interval ELSE '1 month'::interval END
           )::date AS bucket_start
  ),
  counted AS (
    SELECT date_trunc(granularity, (n.approved_at AT TIME ZONE tz))::date AS bucket_start,
           count(*) FILTER (WHERE n.nominee_id   = p_employee_id) AS received,
           count(*) FILTER (WHERE n.nominator_id = p_employee_id) AS given
      FROM nominations n
     WHERE n.status = 'approved'
       AND n.approved_at IS NOT NULL
       AND n.approved_at >= (p_start - 1)::timestamptz
       AND n.approved_at <  (p_end + 2)::timestamptz
       AND (n.approved_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end
       AND (n.nominee_id = p_employee_id OR n.nominator_id = p_employee_id)
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'granularity', granularity,
    'buckets', COALESCE(jsonb_agg(
      jsonb_build_object(
        'start',    s.bucket_start,
        'label',    CASE WHEN granularity = 'week'
                         THEN to_char(s.bucket_start, 'DD Mon')
                         ELSE to_char(s.bucket_start, 'Mon YYYY') END,
        'received', COALESCE(c.received, 0),
        'given',    COALESCE(c.given, 0)
      ) ORDER BY s.bucket_start
    ), '[]'::jsonb),
    -- Two buckets is a line, not a trend. Three non-empty buckets is the
    -- minimum this report is willing to describe as a direction.
    'sufficient', (SELECT count(*) FROM counted) >= 3
  ) INTO trend
  FROM series s
  LEFT JOIN counted c ON c.bucket_start = s.bucket_start;

  result := jsonb_build_object(
    'status',       'ok',
    'generated_at', now(),
    'period', jsonb_build_object(
      'start',          p_start,
      'end',            p_end,
      'previous_start', p_prev_start,
      'previous_end',   p_prev_end,
      'days',           span_days
    ),
    'employee',    profile,
    'recognition', recognition,
    'core_values', values_json,
    'behaviours',  behaviours,
    'badges',      badges,
    'projects',    projects,
    'contributors', contributors,
    'trend',       trend
  );

  RETURN result;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.employee_report(uuid, date, date, date, date, uuid)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.employee_report(uuid, date, date, date, date, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.employee_report(uuid, date, date, date, date, uuid) IS
  'One employee''s factual recognition report for a period, in a single call. Authorises through may_report_on() before reading anything. Counts only -- no narrative text, no rejection reasons, no interpretation.';


-- ============================================================
-- PART E -- the consolidated organisation report
--
-- HR and Super Admin only. Genuinely aggregate: it counts across the
-- organisation rather than assembling per-employee reports and adding them up,
-- which is both slower and a different number (an employee with no activity
-- still counts towards participation).
-- ============================================================

CREATE OR REPLACE FUNCTION public.organization_report(
  p_start            date,
  p_end              date,
  p_prev_start       date DEFAULT NULL,
  p_prev_end         date DEFAULT NULL,
  p_claimed_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  tz          text := 'Asia/Kolkata';
  actor_id    uuid := public.report_actor(p_claimed_actor_id);
  actor_role  text;
  span_days   integer;
  granularity text;
  totals      jsonb;
  values_json jsonb;
  behaviours  jsonb;
  badges      jsonb;
  departments jsonb;
  projects    jsonb;
  trend       jsonb;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN
    RETURN jsonb_build_object('status', 'invalid_period');
  END IF;

  SELECT role INTO actor_role FROM employees WHERE id = actor_id AND is_active;

  -- Organisation-wide reporting is HR's and a Super Admin's alone. A Manager
  -- has an employee report for their own project members and no consolidated
  -- view, which is the requested rule and also the one may_report_on() implies.
  IF actor_role IS NULL OR actor_role NOT IN ('hr_admin', 'super_admin') THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  span_days   := (p_end - p_start) + 1;
  granularity := CASE WHEN span_days <= 62 THEN 'week' ELSE 'month' END;

  -- ── Totals and participation ──────────────────────────────
  WITH period AS (
    SELECT n.*
      FROM nominations n
     WHERE n.status <> 'removed'
       AND n.submitted_at IS NOT NULL
       AND n.submitted_at >= (p_start - 1)::timestamptz
       AND n.submitted_at <  (p_end + 2)::timestamptz
       AND (n.submitted_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end
  ),
  approved AS (SELECT * FROM period WHERE status = 'approved'),
  headcount AS (SELECT count(*)::numeric AS n FROM employees WHERE is_active)
  SELECT jsonb_build_object(
    'employees_active',     (SELECT n FROM headcount),
    'employees_recognized', (SELECT count(DISTINCT nominee_id)   FROM approved),
    'employees_giving',     (SELECT count(DISTINCT nominator_id) FROM approved),
    -- What share of the organisation received at least one approved
    -- recognition. Coverage of the RECOGNITION PROGRAMME, not of performance.
    'participation_pct', CASE WHEN (SELECT n FROM headcount) > 0
      THEN round(100 * (SELECT count(DISTINCT nominee_id) FROM approved) / (SELECT n FROM headcount), 1)
      ELSE 0 END,
    'recognitions', jsonb_build_object(
      'total',                   (SELECT count(*) FROM period),
      'approved',                (SELECT count(*) FROM period WHERE status = 'approved'),
      'pending',                 (SELECT count(*) FROM period WHERE status = 'pending'),
      'rejected',                (SELECT count(*) FROM period WHERE status = 'rejected'),
      'clarification_requested', (SELECT count(*) FROM period WHERE status = 'clarification_requested')
    ),
    'previous_approved', CASE WHEN p_prev_start IS NULL THEN NULL ELSE (
      SELECT count(*) FROM nominations n
       WHERE n.status = 'approved'
         AND n.approved_at IS NOT NULL
         AND n.approved_at >= (p_prev_start - 1)::timestamptz
         AND n.approved_at <  (p_prev_end + 2)::timestamptz
         AND (n.approved_at AT TIME ZONE tz)::date BETWEEN p_prev_start AND p_prev_end
    ) END
  ) INTO totals;

  -- ── Core value distribution ───────────────────────────────
  WITH period AS (
    SELECT n.core_value_id
      FROM nominations n
     WHERE n.status = 'approved'
       AND n.approved_at IS NOT NULL
       AND n.approved_at >= (p_start - 1)::timestamptz
       AND n.approved_at <  (p_end + 2)::timestamptz
       AND (n.approved_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end
  ),
  totals_cv AS (SELECT count(*)::numeric AS n FROM period),
  prev_cv AS (
    SELECT n.core_value_id, count(*) AS cnt
      FROM nominations n
     WHERE p_prev_start IS NOT NULL
       AND n.status = 'approved'
       AND n.approved_at IS NOT NULL
       AND n.approved_at >= (p_prev_start - 1)::timestamptz
       AND n.approved_at <  (p_prev_end + 2)::timestamptz
       AND (n.approved_at AT TIME ZONE tz)::date BETWEEN p_prev_start AND p_prev_end
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',             cv.id,
      'name',           cv.name,
      'slug',           cv.slug,
      'accent_color',   cv.accent_color,
      'count',          t.cnt,
      'share_pct',      CASE WHEN (SELECT n FROM totals_cv) > 0
                             THEN round(100 * t.cnt / (SELECT n FROM totals_cv), 1)
                             ELSE 0 END,
      'previous_count', COALESCE((SELECT cnt FROM prev_cv pc WHERE pc.core_value_id = cv.id), 0)
    ) ORDER BY t.cnt DESC, cv.display_order
  ), '[]'::jsonb) INTO values_json
  FROM core_values cv
  JOIN LATERAL (SELECT count(p.core_value_id) AS cnt FROM period p WHERE p.core_value_id = cv.id) t ON true
  WHERE cv.is_active;

  -- ── Behaviour distribution ────────────────────────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('name', t.bn, 'core_value', t.cvn, 'count', t.c)
    ORDER BY t.c DESC, t.bn
  ), '[]'::jsonb) INTO behaviours
  FROM (
    SELECT COALESCE(n.snapshot_behaviour_name, b.name) AS bn,
           COALESCE(n.snapshot_core_value_name, cv.name) AS cvn,
           count(*) AS c
      FROM nominations n
      LEFT JOIN behaviours  b  ON b.id  = n.behaviour_id
      LEFT JOIN core_values cv ON cv.id = n.core_value_id
     WHERE n.status = 'approved'
       AND n.approved_at IS NOT NULL
       AND n.approved_at >= (p_start - 1)::timestamptz
       AND n.approved_at <  (p_end + 2)::timestamptz
       AND (n.approved_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end
       AND COALESCE(n.snapshot_behaviour_name, b.name) IS NOT NULL
     GROUP BY 1, 2
     ORDER BY 3 DESC
     LIMIT 20
  ) t;

  -- ── Badge distribution ────────────────────────────────────
  SELECT jsonb_build_object(
    'by_level', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'level',   bd.level,
          'name',    bd.name,
          'holders', (SELECT count(DISTINCT evb.employee_id)
                        FROM employee_value_badges evb
                       WHERE evb.badge_level = bd.level
                         AND evb.period_end >= p_start)
        ) ORDER BY bd.level
      ) FROM badge_definitions bd WHERE bd.is_active
    ), '[]'::jsonb),
    'awarded_in_period', (
      SELECT count(*) FROM badge_history bh
       WHERE bh.achieved_at >= (p_start - 1)::timestamptz
         AND bh.achieved_at <  (p_end + 2)::timestamptz
         AND (bh.achieved_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end
    )
  ) INTO badges;

  -- ── Department and project distribution ───────────────────
  --
  -- Departments come from the SNAPSHOT taken at submission, not from the
  -- employee's department today: a report about September should not move
  -- because somebody transferred in November.
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('name', t.dept, 'recognitions', t.c, 'employees_recognized', t.e)
    ORDER BY t.c DESC, t.dept
  ), '[]'::jsonb) INTO departments
  FROM (
    SELECT COALESCE(n.snapshot_nominee_dept, 'Not recorded') AS dept,
           count(*) AS c,
           count(DISTINCT n.nominee_id) AS e
      FROM nominations n
     WHERE n.status = 'approved'
       AND n.approved_at IS NOT NULL
       AND n.approved_at >= (p_start - 1)::timestamptz
       AND n.approved_at <  (p_end + 2)::timestamptz
       AND (n.approved_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end
     GROUP BY 1
     ORDER BY 2 DESC
     LIMIT 20
  ) t;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('name', t.proj, 'recognitions', t.c, 'employees_recognized', t.e)
    ORDER BY t.c DESC, t.proj
  ), '[]'::jsonb) INTO projects
  FROM (
    SELECT COALESCE(n.snapshot_project_name, p.name, 'Not recorded') AS proj,
           count(*) AS c,
           count(DISTINCT n.nominee_id) AS e
      FROM nominations n
      LEFT JOIN projects p ON p.id = n.project_id
     WHERE n.status = 'approved'
       AND n.approved_at IS NOT NULL
       AND n.approved_at >= (p_start - 1)::timestamptz
       AND n.approved_at <  (p_end + 2)::timestamptz
       AND (n.approved_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end
     GROUP BY 1
     ORDER BY 2 DESC
     LIMIT 20
  ) t;

  -- ── Trend ─────────────────────────────────────────────────
  WITH series AS (
    SELECT generate_series(
             CASE WHEN granularity = 'week'
                  THEN date_trunc('week', p_start::timestamp)
                  ELSE date_trunc('month', p_start::timestamp) END,
             p_end::timestamp,
             CASE WHEN granularity = 'week'
                  THEN '1 week'::interval ELSE '1 month'::interval END
           )::date AS bucket_start
  ),
  counted AS (
    SELECT date_trunc(granularity, (n.approved_at AT TIME ZONE tz))::date AS bucket_start,
           count(*) AS c,
           count(DISTINCT n.nominee_id) AS people
      FROM nominations n
     WHERE n.status = 'approved'
       AND n.approved_at IS NOT NULL
       AND n.approved_at >= (p_start - 1)::timestamptz
       AND n.approved_at <  (p_end + 2)::timestamptz
       AND (n.approved_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'granularity', granularity,
    'buckets', COALESCE(jsonb_agg(
      jsonb_build_object(
        'start',                s.bucket_start,
        'label',                CASE WHEN granularity = 'week'
                                     THEN to_char(s.bucket_start, 'DD Mon')
                                     ELSE to_char(s.bucket_start, 'Mon YYYY') END,
        'recognitions',         COALESCE(c.c, 0),
        'employees_recognized', COALESCE(c.people, 0)
      ) ORDER BY s.bucket_start
    ), '[]'::jsonb),
    'sufficient', (SELECT count(*) FROM counted) >= 3
  ) INTO trend
  FROM series s
  LEFT JOIN counted c ON c.bucket_start = s.bucket_start;

  RETURN jsonb_build_object(
    'status',       'ok',
    'generated_at', now(),
    'period', jsonb_build_object(
      'start',          p_start,
      'end',            p_end,
      'previous_start', p_prev_start,
      'previous_end',   p_prev_end,
      'days',           span_days
    ),
    'totals',      totals,
    'core_values', values_json,
    'behaviours',  behaviours,
    'badges',      badges,
    'departments', departments,
    'projects',    projects,
    'trend',       trend
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.organization_report(date, date, date, date, uuid)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.organization_report(date, date, date, date, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.organization_report(date, date, date, date, uuid) IS
  'The consolidated organisation recognition report for a period. HR and Super Admin only. Genuinely aggregate -- it counts across the organisation rather than summing per-employee reports.';


-- ============================================================
-- PART F -- the AI insight cache
--
-- The ONLY thing this feature persists. Reports themselves are computed on
-- demand; an interpretation of one costs money to produce, so it is kept.
--
-- WHAT IS AND IS NOT STORED
-- -------------------------
-- Stored: the generated prose, which subject and period it describes, the
-- model that wrote it, when, and a HASH of the facts it was given.
--
-- Not stored: the facts themselves. The context is reproducible from
-- employee_report() at any time, and keeping a second copy of somebody's
-- recognition history in a cache table would be a copy nothing invalidates.
--
-- THE HASH IS THE CACHE KEY, AND THAT IS THE POINT
-- ------------------------------------------------
-- Keying on (subject, period) alone would serve a stale interpretation after a
-- recognition is approved inside the period. Keying on the hash of the facts
-- means the cache is automatically correct: same facts, same answer, no call;
-- any change to the facts is a different key and a fresh generation.
--
-- NO POLICIES, ON PURPOSE
-- -----------------------
-- RLS is enabled and NO policy is created, so the table is unreachable from
-- any browser session -- reads and writes both. The generate-report-insights
-- Edge Function, under the service role, is the only door, and it authorises
-- every request through may_report_on() before it returns a row. Same posture
-- as recognition_support_requests (034): "no write policy -- every write is an
-- RPC".
-- ============================================================

CREATE TABLE IF NOT EXISTS report_ai_insights (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 'employee' insights name a subject; 'organization' ones do not.
  scope         TEXT NOT NULL CHECK (scope IN ('employee', 'organization')),
  subject_id    UUID REFERENCES employees(id) ON DELETE CASCADE,

  period_type   TEXT NOT NULL CHECK (period_type IN ('monthly', 'quarterly', 'annual')),
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,

  /*
    A digest of the exact facts handed to the model. Two requests with the same
    hash describe the same data and reuse the same answer; one byte of change
    in the metrics is a different hash and a new generation.
  */
  context_hash  TEXT NOT NULL,

  /** The generated sections. Prose only -- never metrics. */
  insight       JSONB NOT NULL,

  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  /** Who caused it to be generated. Auditability, not authorship. */
  generated_by  UUID REFERENCES employees(id),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

/*
  One cached answer per (scope, subject, period, facts).

  An expression index rather than a table constraint because subject_id is NULL
  for organisation insights, and NULLs are distinct in a UNIQUE constraint --
  every organisation report would get its own row and the cache would never hit.
*/
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_ai_insights_identity
  ON report_ai_insights (
    scope,
    COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid),
    period_start,
    period_end,
    context_hash
  );

CREATE INDEX IF NOT EXISTS idx_report_ai_insights_subject
  ON report_ai_insights (subject_id, period_start DESC);

ALTER TABLE report_ai_insights ENABLE ROW LEVEL SECURITY;

-- Deliberately no policies. See the header: the Edge Function is the only door.

COMMENT ON TABLE public.report_ai_insights IS
  'Cached AI interpretations of reports, keyed by a hash of the facts they were generated from. RLS enabled with NO policies: unreachable from a browser, written and read only by the generate-report-insights Edge Function under the service role.';


NOTIFY pgrst, 'reload schema';


-- ============================================================
-- Verification
--
-- Printed when the migration runs. Every boolean expected true.
-- ============================================================
SELECT '043 APPLIED' AS check,
       EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                AND proname = 'may_report_on')                        AS scope_rule_installed,
       EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                AND proname = 'employee_report')                      AS employee_report_installed,
       EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                AND proname = 'organization_report')                  AS organization_report_installed,
       -- The manager scope is project-based, never the retired line manager.
       (SELECT pg_get_functiondef(oid) LIKE '%p.manager_id = p_actor_id%'
          FROM pg_proc WHERE pronamespace = 'public'::regnamespace
           AND proname = 'may_report_on')                             AS scope_is_project_based,
       (SELECT pg_get_functiondef(oid) NOT LIKE '%e.manager_id%'
          FROM pg_proc WHERE pronamespace = 'public'::regnamespace
           AND proname = 'may_report_on')                             AS no_line_manager,
       -- The subject picker takes a search term and nothing that names a team.
       (SELECT pronargs = 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
         AND proname = 'report_subjects')                             AS subjects_take_only_a_term,
       -- The insight cache is unreachable from a browser session.
       (SELECT relrowsecurity FROM pg_class
         WHERE oid = 'public.report_ai_insights'::regclass)           AS insight_cache_rls_enabled,
       (SELECT count(*) = 0 FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'report_ai_insights')
                                                                      AS insight_cache_has_no_policies,
       NOT has_table_privilege('authenticated', 'public.report_ai_insights', 'SELECT')
         OR (SELECT count(*) = 0 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'report_ai_insights')
                                                                      AS insight_cache_unreadable,
       -- Nothing from 041/042 moved.
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.nominations'::regclass
                AND tgname = 'check_nomination_eligibility')          AS nominee_rule_intact,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.nominations'::regclass
                AND tgname = 'guard_nomination_decision_integrity')   AS decision_guard_intact,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policy_count;
-- EXPECT every boolean true. No existing policy is created, altered or dropped
-- here; policy_count is printed so it can be compared across migrations.


-- ============================================================
-- ROLLBACK
--
--   DROP FUNCTION IF EXISTS public.organization_report(date,date,date,date,uuid);
--   DROP FUNCTION IF EXISTS public.employee_report(uuid,date,date,date,date,uuid);
--   DROP FUNCTION IF EXISTS public.report_subjects(text);
--   DROP FUNCTION IF EXISTS public.may_report_on(uuid,uuid);
--   DROP FUNCTION IF EXISTS public.report_actor(uuid);
--   DROP TABLE    IF EXISTS public.report_ai_insights;
--
-- Dropping the cache table loses generated prose only; every factual report is
-- recomputed from the existing tables and nothing else is stored.
-- ============================================================
