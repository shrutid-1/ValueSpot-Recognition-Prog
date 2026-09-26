-- ============================================================
-- 061 -- Team reports, report filters, Team Badges, project rosters
--
-- Additive. No table, column or policy is created, altered or dropped. One
-- function is replaced with a wider signature (employee_report gains an
-- optional p_filters); every other change is a new function or a
-- CREATE OR REPLACE with the same signature. Safe to run more than once.
-- Requires 001-060.
--
--
-- WHAT THIS ADDS
-- --------------
--   report_filters_clean()   one normalised shape for the eight report filters
--   report_row_matches()     the recognition-level half of those filters
--   report_scope_rows()      the recognitions a report may count (internal)
--   report_filter_options()  what the filter dropdowns may offer this caller
--   scoped_report()          the consolidated report: the organisation for HR
--                            and Super Admin, THE TEAM for a Manager -- with a
--                            row per employee, which is the "report of all my
--                            employees" a Manager could not produce before
--   recognition_extract()    the row-level extract, filtered and scoped
--   team_badges()            Team Badges, resolved in the database
--
-- and widens:
--
--   employee_report()        accepts the same filters
--   report_subjects()        also returns department_id and project_ids
--   managed_projects()       returns each member's employee ID, department,
--                            location and the date they joined the project
--
--
-- THE SCOPE RULE IS NOT NEW
-- -------------------------
-- Every function here decides WHO through may_report_on() (043), the one
-- definition the subject picker, both existing reports and the AI Edge
-- Function already share:
--
--     manager      the active members of the ACTIVE PROJECTS THEY MANAGE
--     hr_admin     every employee
--     super_admin  every employee
--     anyone else  nobody
--
-- A Manager's team report is therefore exactly as wide as their employee
-- picker, and nothing in any request can widen it: the caller is resolved from
-- the session by report_actor(), and a filter can only NARROW a scope, never
-- name a different one. An employee filter outside the caller's scope is
-- refused outright rather than answered with zeros.
--
--
-- THE FILTERS
-- -----------
--   period       p_start / p_end, IST calendar dates, as in 043
--   department   the RECIPIENT's department
--   employee     the RECIPIENT (on the employee report: the subject)
--   project      the project the recognition was filed against (030)
--   core value   the recognition's core value
--   behaviour    the recognition's behaviour
--   source       peer / manager / hr / leadership
--   status       pending / approved / rejected / clarification_requested
--
-- Department and employee describe the person recognised, so a department
-- report is "recognition received by Engineering" -- the reading every
-- department report in this product already has (the organisation report's
-- department table counts the nominee's department).
--
-- Removed recognitions (034) are excluded everywhere, as in 043: a moderator
-- removed them precisely so they would stop counting.
--
--
-- WHY TEAM BADGES MOVES INTO THE DATABASE
-- ---------------------------------------
-- The page assembled the team in the browser in three round trips and then
-- read employee_value_badges under evb_read_team (039). That policy tests
-- `auth.jwt()->>'user_role'`, a claim frozen into the access token when it was
-- issued. Somebody made a Manager while signed in carries 'employee' until the
-- token is refreshed, the policy filters every row away, and the page says
-- "No badges yet" -- with no error, because an RLS filter is not an error --
-- while My Projects, which reads a different claim, works. The same query also
-- read every annual period ever recorded (last year's badges beside this
-- year's, with colliding row keys), listed only people who already held a
-- badge, and could never show HR or a Super Admin anything, since neither can
-- manage a project (029).
--
-- team_badges() resolves the caller from the employees table, like every
-- report function, and returns every member with their standing in the
-- CURRENT annual period -- including the members who have not been recognised
-- yet, because "nobody on my team has a badge" and "the page is broken" must
-- not look the same.
--
--
-- WHY THESE ARE SECURITY DEFINER
-- ------------------------------
-- The reasoning of 043, unchanged: a Manager cannot read their team's
-- nomination rows (nominations_read_approver admits only rows assigned to
-- them), so an aggregate computed under their own policies would under-count
-- rather than refuse. Each function authorises first, through may_report_on(),
-- and returns counts and names.
--
-- recognition_extract() is the one function here that returns narrative text.
-- For HR and Super Admin that is what the existing extract already returned
-- (they can read every row). For a Manager the story and impact are included
-- only where the Manager could already read them -- an approved recognition,
-- which the whole company sees in the feed; one assigned to them to decide; or
-- one they wrote. Anything else is counted and listed with its narrative
-- withheld, and the rejection reason and clarification notes are never
-- returned to anyone.
-- ============================================================


-- ============================================================
-- PART A -- the filters
-- ============================================================

-- Unknown keys are dropped and malformed values ignored, so nothing
-- downstream ever casts a string it has not already checked. An empty object
-- means "no filters".
CREATE OR REPLACE FUNCTION public.report_filters_clean(p_filters jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN p_filters IS NULL OR jsonb_typeof(p_filters) <> 'object' THEN '{}'::jsonb
    ELSE jsonb_strip_nulls(jsonb_build_object(
      'department_id', CASE WHEN p_filters->>'department_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                            THEN lower(p_filters->>'department_id') END,
      'project_id',    CASE WHEN p_filters->>'project_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                            THEN lower(p_filters->>'project_id') END,
      'employee_id',   CASE WHEN p_filters->>'employee_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                            THEN lower(p_filters->>'employee_id') END,
      'core_value_id', CASE WHEN p_filters->>'core_value_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                            THEN lower(p_filters->>'core_value_id') END,
      'behaviour_id',  CASE WHEN p_filters->>'behaviour_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                            THEN lower(p_filters->>'behaviour_id') END,
      'source',        CASE WHEN p_filters->>'source' IN ('peer', 'manager', 'hr', 'leadership')
                            THEN p_filters->>'source' END,
      'status',        CASE WHEN p_filters->>'status' IN ('pending', 'approved', 'rejected', 'clarification_requested')
                            THEN p_filters->>'status' END
    ))
  END;
$fn$;

GRANT EXECUTE ON FUNCTION public.report_filters_clean(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.report_filters_clean(jsonb) IS
  'Normalises report filters: known keys only, uuids and enumerations validated. Returns {} for no filters.';


-- The recognition-level filters: project, core value, behaviour, source,
-- status. Takes CLEANED filters only (report_filters_clean), so its casts are
-- safe. Department and employee are about the recipient and are applied where
-- the recipient is joined.
CREATE OR REPLACE FUNCTION public.report_row_matches(
  f               jsonb,
  p_project_id    uuid,
  p_core_value_id uuid,
  p_behaviour_id  uuid,
  p_source        text,
  p_status        text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT (f->>'project_id'    IS NULL OR p_project_id    IS NOT DISTINCT FROM (f->>'project_id')::uuid)
     AND (f->>'core_value_id' IS NULL OR p_core_value_id IS NOT DISTINCT FROM (f->>'core_value_id')::uuid)
     AND (f->>'behaviour_id'  IS NULL OR p_behaviour_id  IS NOT DISTINCT FROM (f->>'behaviour_id')::uuid)
     AND (f->>'source'        IS NULL OR p_source        IS NOT DISTINCT FROM f->>'source')
     AND (f->>'status'        IS NULL OR p_status        IS NOT DISTINCT FROM f->>'status');
$fn$;

GRANT EXECUTE ON FUNCTION public.report_row_matches(jsonb, uuid, uuid, uuid, text, text)
  TO authenticated, service_role;


-- ============================================================
-- PART B -- the recognitions a consolidated report may count
--
-- INTERNAL. Returns whole nomination rows, narrative included, so it is
-- executable by nobody: only the SECURITY DEFINER report functions below call
-- it, as the owner. p_org is decided by those functions from the caller's
-- role; it is never a request parameter.
--
-- p_basis picks the date a recognition belongs to, as 043 does:
--   'submitted'  status mix -- what was put forward in the period
--   'approved'   achievements -- what was approved in the period
-- ============================================================

CREATE OR REPLACE FUNCTION public.report_scope_rows(
  p_actor   uuid,
  p_org     boolean,
  p_filters jsonb,
  p_start   date,
  p_end     date,
  p_basis   text
)
RETURNS SETOF nominations
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT n.*
    FROM nominations n
    JOIN employees ne ON ne.id = n.nominee_id
   WHERE p_start IS NOT NULL AND p_end IS NOT NULL
     AND n.status <> 'removed'
     AND (
       (p_basis = 'approved'
         AND n.status = 'approved'
         AND n.approved_at IS NOT NULL
         AND n.approved_at >= (p_start - 1)::timestamptz
         AND n.approved_at <  (p_end + 2)::timestamptz
         AND (n.approved_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_start AND p_end)
       OR
       (p_basis = 'submitted'
         AND n.submitted_at IS NOT NULL
         AND n.submitted_at >= (p_start - 1)::timestamptz
         AND n.submitted_at <  (p_end + 2)::timestamptz
         AND (n.submitted_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_start AND p_end)
     )
     AND public.report_row_matches(p_filters, n.project_id, n.core_value_id,
                                   n.behaviour_id, n.recognition_source, n.status)
     AND (p_filters->>'department_id' IS NULL OR ne.department_id = (p_filters->>'department_id')::uuid)
     AND (p_filters->>'employee_id'   IS NULL OR n.nominee_id     = (p_filters->>'employee_id')::uuid)
     AND (p_org OR public.may_report_on(p_actor, n.nominee_id));
$fn$;

REVOKE ALL ON FUNCTION public.report_scope_rows(uuid, boolean, jsonb, date, date, text)
  FROM PUBLIC, anon, authenticated;


-- ============================================================
-- PART C -- what the filter dropdowns may offer
--
-- Scoped like everything else. A Manager is offered the projects they manage,
-- the departments their team members belong to, and their team; HR and Super
-- Admin are offered the organisation. Offering a Manager another team's
-- project would grant nothing -- every report narrows by scope first -- but a
-- dropdown of options that always produce an empty report is not an option.
-- ============================================================

CREATE OR REPLACE FUNCTION public.report_filter_options()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  actor_id   uuid := public.report_actor();
  actor_role text;
  org        boolean;
BEGIN
  SELECT role INTO actor_role FROM employees WHERE id = actor_id AND is_active;

  IF actor_role IS NULL OR actor_role NOT IN ('manager', 'hr_admin', 'super_admin') THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  org := actor_role IN ('hr_admin', 'super_admin');

  RETURN jsonb_build_object(
    'status', 'ok',
    'scope',  CASE WHEN org THEN 'organization' ELSE 'team' END,

    'departments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.name)
        FROM departments d
       WHERE (org AND d.is_active)
          OR EXISTS (
               SELECT 1 FROM employees e
                WHERE e.department_id = d.id
                  AND e.is_active
                  AND public.may_report_on(actor_id, e.id)
             )
    ), '[]'::jsonb),

    'projects', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object('id', p.id, 'name', p.name, 'is_active', p.is_active)
               ORDER BY p.is_active DESC, p.name
             )
        FROM projects p
       WHERE org OR p.manager_id = actor_id
    ), '[]'::jsonb),

    'core_values', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object('id', cv.id, 'name', cv.name, 'slug', cv.slug)
               ORDER BY cv.display_order, cv.name
             )
        FROM core_values cv
       WHERE cv.is_active
    ), '[]'::jsonb),

    'behaviours', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object('id', b.id, 'name', b.name, 'core_value_id', b.core_value_id)
               ORDER BY cv.display_order, b.display_order, b.name
             )
        FROM behaviours b
        JOIN core_values cv ON cv.id = b.core_value_id
       WHERE b.is_active AND cv.is_active
    ), '[]'::jsonb),

    -- The same list, and the same scope, as the employee picker.
    'employees', public.report_subjects(NULL)
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.report_filter_options() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.report_filter_options() TO authenticated;

COMMENT ON FUNCTION public.report_filter_options() IS
  'Departments, projects, core values, behaviours and employees the CALLER may filter reports by. Scope from the session, as report_subjects().';


-- ============================================================
-- PART D -- the employee picker, with ids to filter on
--
-- 043's function with two more fields, so the page can narrow the list by the
-- department and project filters without matching on names. Same signature,
-- same scope rule, same one-row-per-employee.
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
        'id',            s.id,
        'full_name',     s.full_name,
        'employee_id',   s.employee_id,
        'email',         s.email,
        'role',          s.role,
        'avatar_url',    s.avatar_url,
        'department',    s.department_name,
        'department_id', s.department_id,
        'projects',      s.projects,
        'project_ids',   s.project_ids
      )
      ORDER BY s.full_name
    ),
    '[]'::jsonb
  )
  FROM (
    SELECT DISTINCT ON (e.id)
           e.id, e.full_name, e.employee_id, e.email, e.role, e.avatar_url,
           e.department_id,
           d.name AS department_name,
           COALESCE((
             SELECT jsonb_agg(p2.name ORDER BY p2.name)
               FROM project_members pm2
               JOIN projects p2 ON p2.id = pm2.project_id
              WHERE pm2.employee_id = e.id AND pm2.is_active AND p2.is_active
           ), '[]'::jsonb) AS projects,
           COALESCE((
             SELECT jsonb_agg(p3.id ORDER BY p3.name)
               FROM project_members pm3
               JOIN projects p3 ON p3.id = pm3.project_id
              WHERE pm3.employee_id = e.id AND pm3.is_active AND p3.is_active
           ), '[]'::jsonb) AS project_ids
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


-- ============================================================
-- PART E -- one employee's report, filterable
--
-- 043's employee_report() with one more, optional argument. The previous
-- signature is DROPPED rather than overloaded: two employee_report functions
-- that differ by a trailing defaulted argument make every named-argument call
-- -- which is how the AI Edge Function calls it -- ambiguous. With the old one
-- gone, that call (no p_filters) resolves here and returns exactly the report
-- it returned before.
--
-- The recognition-level filters (project, core value, behaviour, source,
-- status) narrow every count. Department and employee choose the SUBJECT on
-- this report and do not apply to its rows. A core value filter also narrows
-- the badge sections to that value; project and source cannot narrow a badge,
-- which is a running total across all of them, and the page says so.
-- ============================================================

DROP FUNCTION IF EXISTS public.employee_report(uuid, date, date, date, date, uuid);

CREATE OR REPLACE FUNCTION public.employee_report(
  p_employee_id       uuid,
  p_start             date,
  p_end               date,
  p_prev_start        date DEFAULT NULL,
  p_prev_end          date DEFAULT NULL,
  p_claimed_actor_id  uuid DEFAULT NULL,
  p_filters           jsonb DEFAULT NULL
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
  f           jsonb := public.report_filters_clean(p_filters) - 'department_id' - 'employee_id';
  cv_filter   uuid;
  emp         employees%ROWTYPE;
  span_days   integer;
  granularity text;
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

  cv_filter   := (f->>'core_value_id')::uuid;
  span_days   := (p_end - p_start) + 1;
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
       AND public.report_row_matches(f, n.project_id, n.core_value_id, n.behaviour_id, n.recognition_source, n.status)
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
       AND public.report_row_matches(f, n.project_id, n.core_value_id, n.behaviour_id, n.recognition_source, n.status)
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
       AND public.report_row_matches(f, n.project_id, n.core_value_id, n.behaviour_id, n.recognition_source, n.status)
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
  WITH period AS (
    SELECT n.*
      FROM nominations n
     WHERE n.nominee_id = p_employee_id
       AND n.status = 'approved'
       AND n.approved_at IS NOT NULL
       AND n.approved_at >= (p_start - 1)::timestamptz
       AND n.approved_at <  (p_end + 2)::timestamptz
       AND (n.approved_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end
       AND public.report_row_matches(f, n.project_id, n.core_value_id, n.behaviour_id, n.recognition_source, n.status)
  ),
  totals AS (SELECT count(*)::numeric AS n FROM period),
  per_value AS (
    SELECT cv.id, cv.name, cv.slug, cv.accent_color, cv.display_order,
           count(p.id) AS cnt
      FROM core_values cv
      LEFT JOIN period p ON p.core_value_id = cv.id
     WHERE cv.is_active
       AND (cv_filter IS NULL OR cv.id = cv_filter)
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
       AND public.report_row_matches(f, n.project_id, n.core_value_id, n.behaviour_id, n.recognition_source, n.status)
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
       AND public.report_row_matches(f, n.project_id, n.core_value_id, n.behaviour_id, n.recognition_source, n.status)
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
         AND (cv_filter IS NULL OR evb.core_value_id = cv_filter)
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
         AND (cv_filter IS NULL OR bh.core_value_id = cv_filter)
    ), '[]'::jsonb)
  ) INTO badges;

  -- ── Projects ──────────────────────────────────────────────
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
           AND public.report_row_matches(f, n.project_id, n.core_value_id, n.behaviour_id, n.recognition_source, n.status)
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
       AND public.report_row_matches(f, n.project_id, n.core_value_id, n.behaviour_id, n.recognition_source, n.status)
     GROUP BY e.id, e.full_name
     ORDER BY 3 DESC
     LIMIT 10
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
           count(*) FILTER (WHERE n.nominee_id   = p_employee_id) AS received,
           count(*) FILTER (WHERE n.nominator_id = p_employee_id) AS given
      FROM nominations n
     WHERE n.status = 'approved'
       AND n.approved_at IS NOT NULL
       AND n.approved_at >= (p_start - 1)::timestamptz
       AND n.approved_at <  (p_end + 2)::timestamptz
       AND (n.approved_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end
       AND (n.nominee_id = p_employee_id OR n.nominator_id = p_employee_id)
       AND public.report_row_matches(f, n.project_id, n.core_value_id, n.behaviour_id, n.recognition_source, n.status)
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
    'sufficient', (SELECT count(*) FROM counted) >= 3
  ) INTO trend
  FROM series s
  LEFT JOIN counted c ON c.bucket_start = s.bucket_start;

  RETURN jsonb_build_object(
    'status',       'ok',
    'generated_at', now(),
    'filters',      f,
    'period', jsonb_build_object(
      'start',          p_start,
      'end',            p_end,
      'previous_start', p_prev_start,
      'previous_end',   p_prev_end,
      'days',           span_days
    ),
    'employee',     profile,
    'recognition',  recognition,
    'core_values',  values_json,
    'behaviours',   behaviours,
    'badges',       badges,
    'projects',     projects,
    'contributors', contributors,
    'trend',        trend
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.employee_report(uuid, date, date, date, date, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.employee_report(uuid, date, date, date, date, uuid, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.employee_report(uuid, date, date, date, date, uuid, jsonb) IS
  'One employee''s factual recognition report for a period, optionally filtered by project, core value, behaviour, source and status. Authorises through may_report_on() before reading anything. Counts only -- no narrative text, no rejection reasons.';


-- ============================================================
-- PART F -- the consolidated report, for the organisation or for a team
--
-- One function, two scopes, chosen by the caller's ROLE and never by an
-- argument:
--
--   hr_admin / super_admin   the organisation (what organization_report()
--                            answers, plus filters and a row per employee)
--   manager                  their team -- every employee they may report on
--
-- THE POPULATION is the active employees in scope after the department,
-- employee and project filters (project here meaning current membership).
-- It is the denominator for participation and the list of rows in the
-- per-employee table, so an employee with no recognition at all still has a
-- row reading zero -- which is the point of a "report on everyone".
--
-- THE RECOGNITIONS are the ones received by someone in scope and matching
-- every filter. For the organisation that includes people who have since
-- left; for a team it is the current team, as everywhere else.
--
-- organization_report() is left exactly as it was: the AI Edge Function
-- reads it, and an unfiltered organisation report here counts the same
-- things the same way.
-- ============================================================

CREATE OR REPLACE FUNCTION public.scoped_report(
  p_start            date,
  p_end              date,
  p_prev_start       date DEFAULT NULL,
  p_prev_end         date DEFAULT NULL,
  p_filters          jsonb DEFAULT NULL,
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
  org         boolean;
  f           jsonb := public.report_filters_clean(p_filters);
  cv_filter   uuid;
  pop_ids     uuid[];
  -- False only for an unfiltered organisation report, which must count
  -- exactly what organization_report() counts: everyone, including people who
  -- have since left. Any narrower population restricts badges and
  -- participation to the people in it.
  pop_narrow  boolean;
  span_days   integer;
  granularity text;
  totals      jsonb;
  values_json jsonb;
  behaviours  jsonb;
  badges      jsonb;
  departments jsonb;
  projects    jsonb;
  trend       jsonb;
  people      jsonb;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN
    RETURN jsonb_build_object('status', 'invalid_period');
  END IF;

  SELECT role INTO actor_role FROM employees WHERE id = actor_id AND is_active;

  IF actor_role IS NULL OR actor_role NOT IN ('manager', 'hr_admin', 'super_admin') THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  org := actor_role IN ('hr_admin', 'super_admin');

  -- Naming somebody outside your scope is refused, not answered with zeros:
  -- a zero would be a claim about a person this caller may not see.
  IF f ? 'employee_id' AND NOT public.may_report_on(actor_id, (f->>'employee_id')::uuid) THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  cv_filter   := (f->>'core_value_id')::uuid;
  pop_narrow  := NOT org OR f ?| ARRAY['department_id', 'employee_id', 'project_id'];
  span_days   := (p_end - p_start) + 1;
  granularity := CASE WHEN span_days <= 62 THEN 'week' ELSE 'month' END;

  -- ── The population ────────────────────────────────────────
  SELECT COALESCE(array_agg(e.id), '{}')
    INTO pop_ids
    FROM employees e
   WHERE e.is_active
     AND (org OR public.may_report_on(actor_id, e.id))
     AND (f->>'department_id' IS NULL OR e.department_id = (f->>'department_id')::uuid)
     AND (f->>'employee_id'   IS NULL OR e.id = (f->>'employee_id')::uuid)
     AND (f->>'project_id'    IS NULL OR EXISTS (
            SELECT 1 FROM project_members pm
             WHERE pm.employee_id = e.id
               AND pm.project_id  = (f->>'project_id')::uuid
               AND pm.is_active
          ));

  -- ── Totals and participation ──────────────────────────────
  WITH period AS (
    SELECT * FROM public.report_scope_rows(actor_id, org, f, p_start, p_end, 'submitted')
  ),
  approved AS (SELECT * FROM period WHERE status = 'approved')
  SELECT jsonb_build_object(
    'employees_active',     cardinality(pop_ids),
    'employees_recognized', (SELECT count(DISTINCT nominee_id)   FROM approved),
    'employees_giving',     (SELECT count(DISTINCT nominator_id) FROM approved),
    -- Share of the POPULATION that received at least one approved
    -- recognition. Coverage of the recognition programme, not performance.
    'participation_pct', CASE WHEN cardinality(pop_ids) > 0
      THEN round(100 * (SELECT count(DISTINCT nominee_id) FROM approved
                          WHERE NOT pop_narrow OR nominee_id = ANY (pop_ids))::numeric
                 / cardinality(pop_ids), 1)
      ELSE 0 END,
    'recognitions', jsonb_build_object(
      'total',                   (SELECT count(*) FROM period),
      'approved',                (SELECT count(*) FROM period WHERE status = 'approved'),
      'pending',                 (SELECT count(*) FROM period WHERE status = 'pending'),
      'rejected',                (SELECT count(*) FROM period WHERE status = 'rejected'),
      'clarification_requested', (SELECT count(*) FROM period WHERE status = 'clarification_requested')
    ),
    'previous_approved', CASE WHEN p_prev_start IS NULL OR p_prev_end IS NULL THEN NULL ELSE (
      SELECT count(*) FROM public.report_scope_rows(actor_id, org, f, p_prev_start, p_prev_end, 'approved')
    ) END
  ) INTO totals;

  -- ── Core value distribution ───────────────────────────────
  WITH period AS (
    SELECT core_value_id FROM public.report_scope_rows(actor_id, org, f, p_start, p_end, 'approved')
  ),
  totals_cv AS (SELECT count(*)::numeric AS n FROM period),
  prev_cv AS (
    SELECT core_value_id, count(*) AS cnt
      FROM public.report_scope_rows(actor_id, org, f, p_prev_start, p_prev_end, 'approved')
     WHERE p_prev_start IS NOT NULL AND p_prev_end IS NOT NULL
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
  WHERE cv.is_active
    AND (cv_filter IS NULL OR cv.id = cv_filter);

  -- ── Behaviour distribution ────────────────────────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('name', t.bn, 'core_value', t.cvn, 'count', t.c)
    ORDER BY t.c DESC, t.bn
  ), '[]'::jsonb) INTO behaviours
  FROM (
    SELECT COALESCE(n.snapshot_behaviour_name, b.name) AS bn,
           COALESCE(n.snapshot_core_value_name, cv.name) AS cvn,
           count(*) AS c
      FROM public.report_scope_rows(actor_id, org, f, p_start, p_end, 'approved') n
      LEFT JOIN behaviours  b  ON b.id  = n.behaviour_id
      LEFT JOIN core_values cv ON cv.id = n.core_value_id
     WHERE COALESCE(n.snapshot_behaviour_name, b.name) IS NOT NULL
     GROUP BY 1, 2
     ORDER BY 3 DESC
     LIMIT 20
  ) t;

  -- ── Badge distribution, across the population ─────────────
  SELECT jsonb_build_object(
    'by_level', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'level',   bd.level,
          'name',    bd.name,
          'holders', (SELECT count(DISTINCT evb.employee_id)
                        FROM employee_value_badges evb
                       WHERE evb.badge_level = bd.level
                         AND evb.period_end >= p_start
                         AND (NOT pop_narrow OR evb.employee_id = ANY (pop_ids))
                         AND (cv_filter IS NULL OR evb.core_value_id = cv_filter))
        ) ORDER BY bd.level
      ) FROM badge_definitions bd WHERE bd.is_active
    ), '[]'::jsonb),
    'awarded_in_period', (
      SELECT count(*) FROM badge_history bh
       WHERE bh.achieved_at >= (p_start - 1)::timestamptz
         AND bh.achieved_at <  (p_end + 2)::timestamptz
         AND (bh.achieved_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end
         AND (NOT pop_narrow OR bh.employee_id = ANY (pop_ids))
         AND (cv_filter IS NULL OR bh.core_value_id = cv_filter)
    )
  ) INTO badges;

  -- ── Department and project distribution ───────────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('name', t.dept, 'recognitions', t.c, 'employees_recognized', t.e)
    ORDER BY t.c DESC, t.dept
  ), '[]'::jsonb) INTO departments
  FROM (
    SELECT COALESCE(n.snapshot_nominee_dept, 'Not recorded') AS dept,
           count(*) AS c,
           count(DISTINCT n.nominee_id) AS e
      FROM public.report_scope_rows(actor_id, org, f, p_start, p_end, 'approved') n
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
      FROM public.report_scope_rows(actor_id, org, f, p_start, p_end, 'approved') n
      LEFT JOIN projects p ON p.id = n.project_id
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
      FROM public.report_scope_rows(actor_id, org, f, p_start, p_end, 'approved') n
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

  -- ── One row per employee in the population ────────────────
  --
  -- The "report of all my employees". Every person in scope appears, the
  -- quiet ones included, each with the same counts their individual report
  -- would show under the same filters.
  WITH submitted AS (
    SELECT nominee_id, nominator_id, status
      FROM public.report_scope_rows(actor_id, org, f, p_start, p_end, 'submitted')
  ),
  received AS (
    SELECT nominee_id,
           count(*)                                                   AS total,
           count(*) FILTER (WHERE status = 'approved')                AS approved,
           count(*) FILTER (WHERE status = 'pending')                 AS pending,
           count(*) FILTER (WHERE status = 'rejected')                AS rejected,
           count(*) FILTER (WHERE status = 'clarification_requested') AS clarification,
           count(DISTINCT nominator_id) FILTER (WHERE status = 'approved') AS recognizers
      FROM submitted
     GROUP BY nominee_id
  ),
  gave AS (
    SELECT n.nominator_id, count(*) AS c
      FROM nominations n
     WHERE n.nominator_id = ANY (pop_ids)
       AND n.status = 'approved'
       AND n.submitted_at IS NOT NULL
       AND n.submitted_at >= (p_start - 1)::timestamptz
       AND n.submitted_at <  (p_end + 2)::timestamptz
       AND (n.submitted_at AT TIME ZONE tz)::date BETWEEN p_start AND p_end
       AND public.report_row_matches(f, n.project_id, n.core_value_id, n.behaviour_id, n.recognition_source, n.status)
     GROUP BY n.nominator_id
  ),
  top_value AS (
    SELECT DISTINCT ON (a.nominee_id) a.nominee_id, cv.name AS core_value, count(*) AS c
      FROM public.report_scope_rows(actor_id, org, f, p_start, p_end, 'approved') a
      JOIN core_values cv ON cv.id = a.core_value_id
     GROUP BY a.nominee_id, cv.name
     ORDER BY a.nominee_id, count(*) DESC, cv.name
  ),
  held AS (
    SELECT evb.employee_id,
           count(*)             AS badges,
           max(evb.badge_level) AS top_level
      FROM employee_value_badges evb
     WHERE evb.employee_id = ANY (pop_ids)
       AND evb.badge_level IS NOT NULL
       AND evb.period_end >= p_start
       AND (cv_filter IS NULL OR evb.core_value_id = cv_filter)
     GROUP BY evb.employee_id
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',                 e.id,
      'full_name',          e.full_name,
      'employee_id',        e.employee_id,
      'email',              e.email,
      'designation',        e.designation,
      'role',               e.role,
      'department',         d.name,
      'projects',           COALESCE((
                              SELECT jsonb_agg(p.name ORDER BY p.name)
                                FROM project_members pm
                                JOIN projects p ON p.id = pm.project_id
                               WHERE pm.employee_id = e.id AND pm.is_active AND p.is_active
                            ), '[]'::jsonb),
      'received', jsonb_build_object(
        'total',                   COALESCE(r.total, 0),
        'approved',                COALESCE(r.approved, 0),
        'pending',                 COALESCE(r.pending, 0),
        'rejected',                COALESCE(r.rejected, 0),
        'clarification_requested', COALESCE(r.clarification, 0)
      ),
      'given_approved',     COALESCE(g.c, 0),
      'unique_recognizers', COALESCE(r.recognizers, 0),
      'top_core_value',     tv.core_value,
      'badges_held',        COALESCE(h.badges, 0),
      'top_badge_level',    h.top_level,
      'top_badge_name',     (SELECT bd.name FROM badge_definitions bd WHERE bd.level = h.top_level)
    )
    ORDER BY COALESCE(r.approved, 0) DESC, e.full_name
  ), '[]'::jsonb) INTO people
  FROM employees e
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN received   r  ON r.nominee_id   = e.id
  LEFT JOIN gave       g  ON g.nominator_id = e.id
  LEFT JOIN top_value  tv ON tv.nominee_id  = e.id
  LEFT JOIN held       h  ON h.employee_id  = e.id
  WHERE e.id = ANY (pop_ids);

  RETURN jsonb_build_object(
    'status',       'ok',
    'generated_at', now(),
    'scope',        CASE WHEN org THEN 'organization' ELSE 'team' END,
    'filters',      f,
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
    'trend',       trend,
    'employees',   people
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.scoped_report(date, date, date, date, jsonb, uuid)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.scoped_report(date, date, date, date, jsonb, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.scoped_report(date, date, date, date, jsonb, uuid) IS
  'The consolidated recognition report, filtered: the organisation for HR and Super Admin, the caller''s own team for a Manager. Scope from the session through may_report_on(); filters only narrow it. Includes one row per employee in scope.';


-- ============================================================
-- PART G -- the recognition extract, one row per recognition
--
-- Replaces a browser query against `nominations`, which could only ever work
-- for HR (a Manager's policy admits only the rows assigned to them). Same
-- scope and filters as the reports; same IST dates.
--
-- The cap is the one the page already enforced: at most 5000 rows, the most
-- recent first, and `truncated` says when the period held more. The summary
-- counts ALL matching rows, so a truncated extract still reports the true
-- totals beside the rows it could return.
-- ============================================================

CREATE OR REPLACE FUNCTION public.recognition_extract(
  p_start   date,
  p_end     date,
  p_filters jsonb   DEFAULT NULL,
  p_limit   integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  actor_id   uuid := public.report_actor();
  actor_role text;
  org        boolean;
  f          jsonb := public.report_filters_clean(p_filters);
  lim        integer := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 5000);
  result     jsonb;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN
    RETURN jsonb_build_object('status', 'invalid_period');
  END IF;

  SELECT role INTO actor_role FROM employees WHERE id = actor_id AND is_active;

  IF actor_role IS NULL OR actor_role NOT IN ('manager', 'hr_admin', 'super_admin') THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  org := actor_role IN ('hr_admin', 'super_admin');

  IF f ? 'employee_id' AND NOT public.may_report_on(actor_id, (f->>'employee_id')::uuid) THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  WITH r AS (
    SELECT * FROM public.report_scope_rows(actor_id, org, f, p_start, p_end, 'submitted')
  ),
  kept AS (
    SELECT * FROM r ORDER BY submitted_at DESC, id LIMIT lim
  )
  SELECT jsonb_build_object(
    'status',  'ok',
    'scope',   CASE WHEN org THEN 'organization' ELSE 'team' END,
    'filters', f,
    'limit',   lim,
    'truncated', (SELECT count(*) FROM r) > lim,
    'summary', (
      SELECT jsonb_build_object(
        'total',                   count(*),
        'approved',                count(*) FILTER (WHERE status = 'approved'),
        'pending',                 count(*) FILTER (WHERE status = 'pending'),
        'rejected',                count(*) FILTER (WHERE status = 'rejected'),
        'clarification_requested', count(*) FILTER (WHERE status = 'clarification_requested')
      ) FROM r
    ),
    'rows', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',                  k.id,
          'submitted_at',        k.submitted_at,
          'approved_at',         k.approved_at,
          'status',              k.status,
          'source',              k.recognition_source,
          'nominator',           nr.full_name,
          'nominee',             ne.full_name,
          'nominee_employee_id', ne.employee_id,
          'core_value',          COALESCE(k.snapshot_core_value_name, cv.name),
          'behaviour',           COALESCE(k.snapshot_behaviour_name, b.name),
          'project',             COALESCE(k.snapshot_project_name, p.name),
          'nominator_dept',      k.snapshot_nominator_dept,
          'nominee_dept',        k.snapshot_nominee_dept,
          -- A Manager sees the story only where they could already read it.
          'narrative_withheld',  NOT (org OR k.status = 'approved'
                                      OR k.assigned_approver_id = actor_id
                                      OR k.nominator_id = actor_id),
          'what_happened',       CASE WHEN org OR k.status = 'approved'
                                           OR k.assigned_approver_id = actor_id
                                           OR k.nominator_id = actor_id
                                      THEN k.what_happened END,
          'what_impact',         CASE WHEN org OR k.status = 'approved'
                                           OR k.assigned_approver_id = actor_id
                                           OR k.nominator_id = actor_id
                                      THEN k.what_impact END
        )
        ORDER BY k.submitted_at DESC, k.id
      )
        FROM kept k
        JOIN employees ne ON ne.id = k.nominee_id
        LEFT JOIN employees   nr ON nr.id = k.nominator_id
        LEFT JOIN core_values cv ON cv.id = k.core_value_id
        LEFT JOIN behaviours  b  ON b.id  = k.behaviour_id
        LEFT JOIN projects    p  ON p.id  = k.project_id
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.recognition_extract(date, date, jsonb, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.recognition_extract(date, date, jsonb, integer) TO authenticated;

COMMENT ON FUNCTION public.recognition_extract(date, date, jsonb, integer) IS
  'Row-level recognition extract for a period, filtered and scoped like the reports. At most 5000 rows, newest first; the summary counts every matching row. A Manager receives narrative text only for approved recognitions and ones they wrote or decide.';


-- ============================================================
-- PART H -- Team Badges
--
-- Every member of the caller's scope, with their standing in each core value
-- for the annual period containing today. Members with no recognitions yet
-- are included with an empty list, so the page can say so about a person
-- rather than about itself.
--
-- The period is read from the stored rows (the one containing today) rather
-- than recomputed: badge rows are written by both the 044 trigger and the
-- calculate-badges Edge Function, and whichever wrote them, this reads the
-- current one and only the current one.
-- ============================================================

CREATE OR REPLACE FUNCTION public.team_badges()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  actor_id   uuid := public.report_actor();
  actor_role text;
  org        boolean;
  today      date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_start    date;
  v_end      date;
BEGIN
  SELECT role INTO actor_role FROM employees WHERE id = actor_id AND is_active;

  IF actor_role IS NULL OR actor_role NOT IN ('manager', 'hr_admin', 'super_admin') THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  org := actor_role IN ('hr_admin', 'super_admin');

  SELECT period_start, period_end INTO v_start, v_end FROM public.badge_period_bounds();

  RETURN jsonb_build_object(
    'status', 'ok',
    'scope',  CASE WHEN org THEN 'organization' ELSE 'team' END,
    'period', jsonb_build_object('start', v_start, 'end', v_end),

    'core_values', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object('id', cv.id, 'name', cv.name, 'slug', cv.slug,
                                  'accent_color', cv.accent_color)
               ORDER BY cv.display_order, cv.name
             )
        FROM core_values cv WHERE cv.is_active
    ), '[]'::jsonb),

    'levels', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object('level', bd.level, 'name', bd.name,
                                  'minimum_count', bd.minimum_count,
                                  'maximum_count', bd.maximum_count)
               ORDER BY bd.level
             )
        FROM badge_definitions bd WHERE bd.is_active
    ), '[]'::jsonb),

    'members', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',          e.id,
          'full_name',   e.full_name,
          'employee_id', e.employee_id,
          'email',       e.email,
          'designation', e.designation,
          'avatar_url',  e.avatar_url,
          'department',  d.name,
          'projects', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) ORDER BY p.name)
              FROM project_members pm
              JOIN projects p ON p.id = pm.project_id
             WHERE pm.employee_id = e.id
               AND pm.is_active
               AND p.is_active
               AND (org OR p.manager_id = actor_id)
          ), '[]'::jsonb),
          'badges', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'core_value_id',           evb.core_value_id,
                'badge_level',             evb.badge_level,
                'badge_name',              bd.name,
                'recognition_count',       evb.recognition_count,
                'unique_recognizer_count', evb.unique_recognizer_count,
                'next_level_at', (
                  SELECT min(nb.minimum_count)
                    FROM badge_definitions nb
                   WHERE nb.is_active AND nb.minimum_count > evb.recognition_count
                )
              )
            )
              FROM employee_value_badges evb
              JOIN core_values cv2 ON cv2.id = evb.core_value_id AND cv2.is_active
              LEFT JOIN badge_definitions bd ON bd.level = evb.badge_level
             WHERE evb.employee_id = e.id
               AND evb.period_type = 'annual'
               AND evb.period_start <= today
               AND evb.period_end   >= today
               AND evb.recognition_count > 0
          ), '[]'::jsonb)
        )
        ORDER BY e.full_name
      )
        FROM employees e
        LEFT JOIN departments d ON d.id = e.department_id
       WHERE e.is_active
         AND (org OR public.may_report_on(actor_id, e.id))
    ), '[]'::jsonb)
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.team_badges() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.team_badges() TO authenticated;

COMMENT ON FUNCTION public.team_badges() IS
  'Current-period badge standing for every member of the caller''s scope: the active members of the active projects a Manager runs, or the organisation for HR and Super Admin. Scope from the session, never from an argument.';


-- ============================================================
-- PART I -- My Projects: a roster, not a list of names
--
-- 054's managed_projects() with four more fields on each member. Everything
-- else -- SECURITY INVOKER, the caller read from the token, active projects
-- and active members only -- is unchanged.
-- ============================================================

CREATE OR REPLACE FUNCTION public.managed_projects()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',           p.id,
        'name',         p.name,
        'description',  p.description,
        'project_code', p.project_code,
        'is_active',    p.is_active,
        'members',      COALESCE(m.members, '[]'::jsonb),
        'member_count', COALESCE(jsonb_array_length(m.members), 0)
      )
      ORDER BY p.name
    ),
    '[]'::jsonb
  )
  FROM projects p
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
             jsonb_build_object(
               'id',                e.id,
               'full_name',         e.full_name,
               'email',             e.email,
               'role',              e.role,
               'designation',       e.designation,
               'avatar_url',        e.avatar_url,
               'employee_code',     e.employee_id,
               'department',        d.name,
               'location',          e.location,
               'project_joined_at', pm.joined_at
             )
             ORDER BY e.full_name
           ) AS members
      FROM project_members pm
      JOIN employees e ON e.id = pm.employee_id
      LEFT JOIN departments d ON d.id = e.department_id
     WHERE pm.project_id = p.id
       AND pm.is_active
       AND e.is_active
  ) m ON true
  WHERE p.manager_id = (auth.jwt()->>'employee_id')::uuid
    AND p.is_active;
$fn$;

REVOKE EXECUTE ON FUNCTION public.managed_projects() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.managed_projects() TO authenticated;


NOTIFY pgrst, 'reload schema';


-- ============================================================
-- Verification
--
-- Printed when the migration runs. Every boolean expected true.
-- ============================================================
SELECT '061 APPLIED' AS check,
       -- Exactly one employee_report, so named-argument calls stay unambiguous.
       (SELECT count(*) = 1 FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace AND proname = 'employee_report')
                                                                      AS one_employee_report,
       -- Every new report function decides scope through the shared rule.
       (SELECT bool_and(pg_get_functiondef(oid) LIKE '%may_report_on%')
          FROM pg_proc WHERE pronamespace = 'public'::regnamespace
           AND proname IN ('scoped_report', 'recognition_extract', 'team_badges',
                           'report_filter_options', 'report_scope_rows'))
                                                                      AS scope_rule_shared,
       -- ...and none of them takes a team, manager or role as an argument.
       (SELECT pronargs = 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
         AND proname = 'team_badges')                                 AS team_badges_takes_nothing,
       -- The internal row source is callable by nobody from outside.
       NOT has_function_privilege('authenticated',
             'public.report_scope_rows(uuid, boolean, jsonb, date, date, text)', 'EXECUTE')
                                                                      AS rows_are_internal,
       NOT has_function_privilege('anon', 'public.scoped_report(date, date, date, date, jsonb, uuid)', 'EXECUTE')
                                                                      AS anon_cannot_report,
       NOT has_function_privilege('anon', 'public.recognition_extract(date, date, jsonb, integer)', 'EXECUTE')
                                                                      AS anon_cannot_extract,
       NOT has_function_privilege('anon', 'public.team_badges()', 'EXECUTE')
                                                                      AS anon_cannot_read_badges,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policy_count;
-- EXPECT every boolean true. No policy is created, altered or dropped here.


-- ============================================================
-- ROLLBACK
--
--   DROP FUNCTION IF EXISTS public.team_badges();
--   DROP FUNCTION IF EXISTS public.recognition_extract(date, date, jsonb, integer);
--   DROP FUNCTION IF EXISTS public.scoped_report(date, date, date, date, jsonb, uuid);
--   DROP FUNCTION IF EXISTS public.report_filter_options();
--   DROP FUNCTION IF EXISTS public.report_scope_rows(uuid, boolean, jsonb, date, date, text);
--   DROP FUNCTION IF EXISTS public.employee_report(uuid, date, date, date, date, uuid, jsonb);
--   -- then re-run PART D of 043 (employee_report), PART C of 043
--   -- (report_subjects) and PART of 054 that defines managed_projects().
--   DROP FUNCTION IF EXISTS public.report_row_matches(jsonb, uuid, uuid, uuid, text, text);
--   DROP FUNCTION IF EXISTS public.report_filters_clean(jsonb);
-- ============================================================
