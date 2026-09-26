-- ============================================================
-- Migration 006: Views and Auth Hook
-- ============================================================

-- Recognition Feed View (approved nominations only)
CREATE OR REPLACE VIEW v_recognition_feed AS
SELECT
  n.id,
  n.approved_at,
  n.published_at,
  n.what_happened,
  n.what_impact,
  n.recognition_source,

  -- Nominator
  nominator.id             AS nominator_id,
  nominator.full_name      AS nominator_name,
  nominator.avatar_url     AS nominator_avatar,

  -- Nominee
  nominee.id               AS nominee_id,
  nominee.full_name        AS nominee_name,
  nominee.avatar_url       AS nominee_avatar,

  -- Core Value
  cv.id                    AS core_value_id,
  cv.name                  AS core_value_name,
  cv.accent_color          AS core_value_color,
  cv.icon                  AS core_value_icon,

  -- Use snapshot fields first, fall back to live data
  COALESCE(n.snapshot_behaviour_name, b.name) AS behaviour_name,
  COALESCE(n.snapshot_scenario_name, s.name)  AS scenario_name,
  COALESCE(n.snapshot_project_name, p.name)   AS project_name,
  n.project_id,

  -- Appreciation count
  (SELECT COUNT(*) FROM nomination_appreciations na WHERE na.nomination_id = n.id)::integer AS appreciation_count

FROM nominations n
JOIN employees nominator ON n.nominator_id = nominator.id
JOIN employees nominee   ON n.nominee_id = nominee.id
JOIN core_values cv       ON n.core_value_id = cv.id
LEFT JOIN behaviours b    ON n.behaviour_id = b.id
LEFT JOIN scenarios s     ON n.scenario_id = s.id
LEFT JOIN projects p      ON n.project_id = p.id

WHERE n.status = 'approved';

-- Grant access to the view for authenticated users
GRANT SELECT ON v_recognition_feed TO authenticated;

-- ============================================================
-- Custom JWT Claims Hook
-- Adds user_role and employee_id to the JWT token
-- ============================================================
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  claims jsonb;
  emp_role text;
  emp_id uuid;
BEGIN
  SELECT role, id INTO emp_role, emp_id
  FROM public.employees
  WHERE auth_user_id = (event->>'user_id')::uuid;

  claims := event->'claims';

  IF emp_role IS NOT NULL THEN
    claims := jsonb_set(claims, '{user_role}', to_jsonb(emp_role));
  ELSE
    claims := jsonb_set(claims, '{user_role}', '"employee"');
  END IF;

  IF emp_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{employee_id}', to_jsonb(emp_id::text));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- Grant the function execution to the supabase_auth_admin role
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;

-- ============================================================
-- Helper RLS functions
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((auth.jwt()->>'user_role')::text, 'employee');
$$;

CREATE OR REPLACE FUNCTION public.employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT (auth.jwt()->>'employee_id')::uuid;
$$;
