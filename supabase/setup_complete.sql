-- ====================================================
-- COMPLETE SUPABASE INITIALIZATION FOR TOUCHCORE VALUESPOT
-- Run this entire script in Supabase Dashboard -> SQL Editor
-- ====================================================

-- ====================================================
-- FILE: supabase/migrations/001_core_tables.sql
-- ====================================================
-- ============================================================
-- Migration 001: Core Tables
-- departments, employees, projects, project_members
-- ============================================================

-- Auto-update updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Departments
CREATE TABLE IF NOT EXISTS departments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_departments_updated_at
  BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "departments_read_authenticated" ON departments
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "departments_hr_write" ON departments
  FOR ALL USING (
    (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

-- Employees
CREATE TABLE IF NOT EXISTS employees (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  employee_id   TEXT UNIQUE NOT NULL,
  full_name     TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('employee', 'manager', 'hr_admin', 'super_admin')),
  department_id UUID REFERENCES departments(id),
  manager_id    UUID REFERENCES employees(id),
  avatar_url    TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  joined_at     DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_employees_auth_user_id   ON employees(auth_user_id);
CREATE INDEX idx_employees_department_id  ON employees(department_id);
CREATE INDEX idx_employees_manager_id     ON employees(manager_id);
CREATE INDEX idx_employees_role           ON employees(role);
CREATE INDEX idx_employees_is_active      ON employees(is_active);

CREATE TRIGGER set_employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employees_read_active" ON employees
  FOR SELECT USING (
    auth.role() = 'authenticated' AND (
      is_active = true OR id = (auth.jwt()->>'employee_id')::uuid
    )
  );

CREATE POLICY "employees_update_own" ON employees
  FOR UPDATE USING (id = (auth.jwt()->>'employee_id')::uuid)
  WITH CHECK (
    id = (auth.jwt()->>'employee_id')::uuid AND
    role = (SELECT role FROM employees WHERE id = (auth.jwt()->>'employee_id')::uuid)
  );

CREATE POLICY "employees_hr_full" ON employees
  FOR ALL USING (
    (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  description  TEXT,
  project_code TEXT UNIQUE,
  manager_id   UUID REFERENCES employees(id),
  is_active    BOOLEAN NOT NULL DEFAULT true,
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_read_authenticated" ON projects
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "projects_hr_write" ON projects
  FOR ALL USING (
    (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

-- Project Members
CREATE TABLE IF NOT EXISTS project_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id),
  employee_id UUID NOT NULL REFERENCES employees(id),
  joined_at   DATE NOT NULL DEFAULT CURRENT_DATE,
  left_at     DATE,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, employee_id, joined_at)
);

CREATE INDEX idx_project_members_project_id  ON project_members(project_id);
CREATE INDEX idx_project_members_employee_id ON project_members(employee_id);

ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_members_read_authenticated" ON project_members
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "project_members_hr_write" ON project_members
  FOR ALL USING (
    (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );


-- ====================================================
-- FILE: supabase/migrations/002_core_values.sql
-- ====================================================
-- ============================================================
-- Migration 002: Core Values, Behaviours, Scenarios
-- ============================================================

CREATE TABLE IF NOT EXISTS core_values (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  slug          TEXT NOT NULL UNIQUE,
  definition    TEXT NOT NULL,
  icon          TEXT NOT NULL DEFAULT 'star',
  accent_color  TEXT NOT NULL DEFAULT '#2563EB',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  archived_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_core_values_updated_at
  BEFORE UPDATE ON core_values
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE core_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "core_values_read_active" ON core_values
  FOR SELECT USING (
    auth.role() = 'authenticated' AND (is_active = true OR (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'))
  );

CREATE POLICY "core_values_hr_write" ON core_values
  FOR ALL USING ((auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'));

-- Behaviours
CREATE TABLE IF NOT EXISTS behaviours (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  core_value_id UUID NOT NULL REFERENCES core_values(id) ON DELETE RESTRICT,
  name          TEXT NOT NULL,
  description   TEXT,
  examples      TEXT[],
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  archived_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(core_value_id, name)
);

CREATE INDEX idx_behaviours_core_value_id ON behaviours(core_value_id);
CREATE INDEX idx_behaviours_is_active ON behaviours(is_active);

CREATE TRIGGER set_behaviours_updated_at
  BEFORE UPDATE ON behaviours
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE behaviours ENABLE ROW LEVEL SECURITY;

CREATE POLICY "behaviours_read_active" ON behaviours
  FOR SELECT USING (
    auth.role() = 'authenticated' AND (is_active = true OR (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'))
  );

CREATE POLICY "behaviours_hr_write" ON behaviours
  FOR ALL USING ((auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'));

-- Scenarios
CREATE TABLE IF NOT EXISTS scenarios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  behaviour_id  UUID NOT NULL REFERENCES behaviours(id) ON DELETE RESTRICT,
  core_value_id UUID NOT NULL REFERENCES core_values(id) ON DELETE RESTRICT,
  name          TEXT NOT NULL,
  description   TEXT,
  examples      TEXT[],
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  archived_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenarios_behaviour_id  ON scenarios(behaviour_id);
CREATE INDEX idx_scenarios_core_value_id ON scenarios(core_value_id);
CREATE INDEX idx_scenarios_is_active     ON scenarios(is_active);

CREATE TRIGGER set_scenarios_updated_at
  BEFORE UPDATE ON scenarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scenarios_read_active" ON scenarios
  FOR SELECT USING (
    auth.role() = 'authenticated' AND (is_active = true OR (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'))
  );

CREATE POLICY "scenarios_hr_write" ON scenarios
  FOR ALL USING ((auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'));


-- ====================================================
-- FILE: supabase/migrations/003_nominations.sql
-- ====================================================
-- ============================================================
-- Migration 003: Nominations + Appreciations
-- ============================================================

CREATE TABLE IF NOT EXISTS nominations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Participants
  nominator_id                UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  nominee_id                  UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,

  -- Core Value reference
  core_value_id               UUID NOT NULL REFERENCES core_values(id) ON DELETE RESTRICT,
  behaviour_id                UUID REFERENCES behaviours(id),
  scenario_id                 UUID REFERENCES scenarios(id),

  -- Recognition content
  what_happened               TEXT NOT NULL,
  what_impact                 TEXT NOT NULL,
  project_id                  UUID REFERENCES projects(id),

  -- Historical snapshots (populated at INSERT time, never updated)
  snapshot_nominator_dept     TEXT,
  snapshot_nominee_dept       TEXT,
  snapshot_nominee_manager_id UUID,
  snapshot_core_value_name    TEXT NOT NULL,
  snapshot_behaviour_name     TEXT,
  snapshot_scenario_name      TEXT,
  snapshot_project_name       TEXT,

  -- Classification
  recognition_source          TEXT NOT NULL CHECK (recognition_source IN ('peer', 'manager', 'hr', 'leadership')),

  -- Workflow
  status                      TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('draft', 'pending', 'clarification_requested', 'approved', 'rejected')),
  assigned_approver_id        UUID REFERENCES employees(id),
  escalation_level            INTEGER NOT NULL DEFAULT 0,

  -- Approval
  approved_by_id              UUID REFERENCES employees(id),
  approved_at                 TIMESTAMPTZ,

  -- Rejection
  rejected_by_id              UUID REFERENCES employees(id),
  rejected_at                 TIMESTAMPTZ,
  rejection_reason            TEXT,  -- HR only, not exposed to nominee

  -- Clarification
  clarification_requested_at  TIMESTAMPTZ,
  clarification_note          TEXT,
  clarification_responded_at  TIMESTAMPTZ,

  -- Feed
  published_at                TIMESTAMPTZ,

  -- Idempotency
  idempotency_key             TEXT UNIQUE,

  -- Timestamps
  submitted_at                TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Database-enforced constraints
  CONSTRAINT no_self_nomination CHECK (nominator_id != nominee_id)
);

CREATE INDEX idx_nominations_nominator_id         ON nominations(nominator_id);
CREATE INDEX idx_nominations_nominee_id           ON nominations(nominee_id);
CREATE INDEX idx_nominations_core_value_id        ON nominations(core_value_id);
CREATE INDEX idx_nominations_status               ON nominations(status);
CREATE INDEX idx_nominations_assigned_approver_id ON nominations(assigned_approver_id);
CREATE INDEX idx_nominations_approved_at          ON nominations(approved_at DESC);
CREATE INDEX idx_nominations_submitted_at         ON nominations(submitted_at DESC);
CREATE INDEX idx_nominations_project_id           ON nominations(project_id);

CREATE TRIGGER set_nominations_updated_at
  BEFORE UPDATE ON nominations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE nominations ENABLE ROW LEVEL SECURITY;

-- Employees can read their own nominations (given or received, with privacy rules)
CREATE POLICY "nominations_read_nominator" ON nominations
  FOR SELECT USING (nominator_id = (auth.jwt()->>'employee_id')::uuid);

CREATE POLICY "nominations_read_nominee_approved" ON nominations
  FOR SELECT USING (
    nominee_id = (auth.jwt()->>'employee_id')::uuid AND
    status IN ('approved', 'clarification_requested')
  );

-- Approvers can read nominations assigned to them
CREATE POLICY "nominations_read_approver" ON nominations
  FOR SELECT USING (
    (auth.jwt()->>'user_role')::text IN ('manager', 'hr_admin', 'super_admin') AND
    assigned_approver_id = (auth.jwt()->>'employee_id')::uuid
  );

-- HR sees all
CREATE POLICY "nominations_hr_read_all" ON nominations
  FOR SELECT USING ((auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'));

-- Any authenticated employee can create a nomination (rate limits enforced at Edge Function)
CREATE POLICY "nominations_insert" ON nominations
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND
    nominator_id = (auth.jwt()->>'employee_id')::uuid AND
    nominator_id != nominee_id
  );

-- Nominator can update pending or clarification-requested nominations
CREATE POLICY "nominations_update_nominator" ON nominations
  FOR UPDATE USING (
    nominator_id = (auth.jwt()->>'employee_id')::uuid AND
    status IN ('draft', 'clarification_requested')
  );

-- Approvers can update assigned pending nominations
CREATE POLICY "nominations_update_approver" ON nominations
  FOR UPDATE USING (
    (auth.jwt()->>'user_role')::text IN ('manager', 'hr_admin', 'super_admin') AND
    assigned_approver_id = (auth.jwt()->>'employee_id')::uuid AND
    status = 'pending'
  );

-- HR can update any
CREATE POLICY "nominations_hr_update" ON nominations
  FOR UPDATE USING ((auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'));

-- Nomination Appreciations
CREATE TABLE IF NOT EXISTS nomination_appreciations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nomination_id UUID NOT NULL REFERENCES nominations(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL REFERENCES employees(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(nomination_id, employee_id)
);

CREATE INDEX idx_appreciations_nomination_id ON nomination_appreciations(nomination_id);

ALTER TABLE nomination_appreciations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "appreciations_read_all_authenticated" ON nomination_appreciations
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "appreciations_insert_own" ON nomination_appreciations
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND
    employee_id = (auth.jwt()->>'employee_id')::uuid
  );


-- ====================================================
-- FILE: supabase/migrations/004_badges.sql
-- ====================================================
-- ============================================================
-- Migration 004: Badge System
-- badge_definitions, employee_value_badges, badge_history
-- ============================================================

CREATE TABLE IF NOT EXISTS badge_definitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level         INTEGER NOT NULL UNIQUE CHECK (level BETWEEN 1 AND 5),
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  minimum_count INTEGER NOT NULL CHECK (minimum_count >= 1),
  maximum_count INTEGER,  -- NULL means no upper bound (B5)
  icon          TEXT NOT NULL DEFAULT 'star',
  accent_color  TEXT NOT NULL DEFAULT '#F59E0B',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_badge_definitions_updated_at
  BEFORE UPDATE ON badge_definitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE badge_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "badge_defs_read_authenticated" ON badge_definitions
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "badge_defs_hr_write" ON badge_definitions
  FOR ALL USING ((auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'));

-- Employee Value Badges — current state per employee × core value × period
CREATE TABLE IF NOT EXISTS employee_value_badges (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             UUID NOT NULL REFERENCES employees(id),
  core_value_id           UUID NOT NULL REFERENCES core_values(id),
  period_type             TEXT NOT NULL CHECK (period_type IN ('annual', 'quarterly')),
  period_start            DATE NOT NULL,
  period_end              DATE NOT NULL,
  recognition_count       INTEGER NOT NULL DEFAULT 0,
  unique_recognizer_count INTEGER NOT NULL DEFAULT 0,
  badge_level             INTEGER REFERENCES badge_definitions(level),
  last_updated            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(employee_id, core_value_id, period_type, period_start)
);

CREATE INDEX idx_evb_employee_id  ON employee_value_badges(employee_id);
CREATE INDEX idx_evb_core_value   ON employee_value_badges(core_value_id);
CREATE INDEX idx_evb_period       ON employee_value_badges(period_type, period_start, period_end);
CREATE INDEX idx_evb_badge_level  ON employee_value_badges(badge_level);

ALTER TABLE employee_value_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "evb_read_own" ON employee_value_badges
  FOR SELECT USING (employee_id = (auth.jwt()->>'employee_id')::uuid);

CREATE POLICY "evb_read_team" ON employee_value_badges
  FOR SELECT USING (
    (auth.jwt()->>'user_role')::text IN ('manager', 'hr_admin', 'super_admin') AND
    employee_id IN (
      SELECT id FROM employees WHERE manager_id = (auth.jwt()->>'employee_id')::uuid
    )
  );

CREATE POLICY "evb_hr_read_all" ON employee_value_badges
  FOR SELECT USING ((auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'));

-- Badge History — immutable record of each level change
CREATE TABLE IF NOT EXISTS badge_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL REFERENCES employees(id),
  core_value_id     UUID NOT NULL REFERENCES core_values(id),
  previous_level    INTEGER,
  new_level         INTEGER NOT NULL REFERENCES badge_definitions(level),
  recognition_count INTEGER NOT NULL,
  achieved_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_type       TEXT NOT NULL CHECK (period_type IN ('annual', 'quarterly')),
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL
);

CREATE INDEX idx_badge_history_employee_id  ON badge_history(employee_id);
CREATE INDEX idx_badge_history_cv_id        ON badge_history(core_value_id);
CREATE INDEX idx_badge_history_achieved_at  ON badge_history(achieved_at DESC);

ALTER TABLE badge_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "badge_history_read_own" ON badge_history
  FOR SELECT USING (employee_id = (auth.jwt()->>'employee_id')::uuid);

CREATE POLICY "badge_history_read_team" ON badge_history
  FOR SELECT USING (
    (auth.jwt()->>'user_role')::text IN ('manager', 'hr_admin', 'super_admin') AND
    employee_id IN (
      SELECT id FROM employees WHERE manager_id = (auth.jwt()->>'employee_id')::uuid
    )
  );

CREATE POLICY "badge_history_hr" ON badge_history
  FOR SELECT USING ((auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'));


-- ====================================================
-- FILE: supabase/migrations/005_supporting.sql
-- ====================================================
-- ============================================================
-- Migration 005: Notifications, Audit Logs, App Config,
--               Rewards, Reciprocal Flags
-- ============================================================

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id  UUID NOT NULL REFERENCES employees(id),
  type          TEXT NOT NULL CHECK (type IN (
                  'nomination_submitted',
                  'approval_required',
                  'clarification_requested',
                  'nomination_approved',
                  'nomination_rejected',
                  'recognition_received',
                  'team_recognition_published',
                  'badge_unlocked',
                  'monthly_report_ready'
                )),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  related_id    UUID,
  related_type  TEXT,
  is_read       BOOLEAN NOT NULL DEFAULT false,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_recipient   ON notifications(recipient_id);
CREATE INDEX idx_notifications_unread      ON notifications(recipient_id, is_read) WHERE is_read = false;
CREATE INDEX idx_notifications_created_at  ON notifications(created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_own" ON notifications
  FOR ALL USING (recipient_id = (auth.jwt()->>'employee_id')::uuid);

CREATE POLICY "notifications_hr_read" ON notifications
  FOR SELECT USING ((auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'));

-- Audit Logs (append-only, service role inserts)
CREATE TABLE IF NOT EXISTS audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id        UUID REFERENCES employees(id),
  actor_email     TEXT,
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       UUID,
  previous_value  JSONB,
  new_value       JSONB,
  ip_address      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_actor_id    ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_entity      ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at  ON audit_logs(created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_hr_read" ON audit_logs
  FOR SELECT USING ((auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'));
-- No INSERT policy for authenticated users — inserts done via service role in Edge Functions

-- App Config (all runtime-configurable values live here)
CREATE TABLE IF NOT EXISTS app_config (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES employees(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_config_hr_read" ON app_config
  FOR SELECT USING ((auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'));

CREATE POLICY "app_config_hr_write" ON app_config
  FOR ALL USING ((auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'));

-- Rewards
CREATE TABLE IF NOT EXISTS rewards (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  description          TEXT,
  frequency            TEXT,
  eligibility_criteria TEXT,
  value_description    TEXT,
  requires_approval    BOOLEAN NOT NULL DEFAULT true,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_rewards_updated_at
  BEFORE UPDATE ON rewards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rewards_hr_full" ON rewards
  FOR ALL USING ((auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'));

-- Reward Assignments
CREATE TABLE IF NOT EXISTS reward_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id     UUID NOT NULL REFERENCES rewards(id),
  employee_id   UUID NOT NULL REFERENCES employees(id),
  assigned_by   UUID NOT NULL REFERENCES employees(id),
  nomination_id UUID REFERENCES nominations(id),
  notes         TEXT,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE reward_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reward_assignments_read_own" ON reward_assignments
  FOR SELECT USING (employee_id = (auth.jwt()->>'employee_id')::uuid);

CREATE POLICY "reward_assignments_hr_full" ON reward_assignments
  FOR ALL USING ((auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'));

-- Reciprocal Recognition Flags (HR-only internal tracking)
CREATE TABLE IF NOT EXISTS reciprocal_recognition_flags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_a_id   UUID NOT NULL REFERENCES employees(id),
  employee_b_id   UUID NOT NULL REFERENCES employees(id),
  count           INTEGER NOT NULL DEFAULT 1,
  last_flagged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_reviewed     BOOLEAN NOT NULL DEFAULT false,
  reviewed_by_id  UUID REFERENCES employees(id),
  reviewed_at     TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE reciprocal_recognition_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flags_hr_only" ON reciprocal_recognition_flags
  FOR ALL USING ((auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin'));


-- ====================================================
-- FILE: supabase/migrations/006_views_and_auth.sql
-- ====================================================
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


-- ====================================================
-- FILE: supabase/seed/001_badge_definitions.sql
-- ====================================================
-- Badge Definitions Seed (production-safe, always needed)
INSERT INTO badge_definitions (level, name, description, minimum_count, maximum_count, icon, accent_color, display_order) VALUES
(1, 'Cheers',           'A Core Value behaviour has been recognized.',              1,  2,    'star',    '#F59E0B', 1),
(2, 'Applause',         'The behaviour is being recognized repeatedly.',            3,  5,    'thumbs-up','#3B82F6', 2),
(3, 'Kudos',            'Strong recurring recognition.',                            6,  10,   'award',   '#7C3AED', 3),
(4, 'Spotlight',        'Consistent recognition for the Core Value.',              11,  15,   'zap',     '#EA580C', 4),
(5, 'Value Ambassador', 'Strong and sustained recognition for the Core Value.',   16,  NULL, 'trophy',  '#16A34A', 5)
ON CONFLICT (level) DO NOTHING;


-- ====================================================
-- FILE: supabase/seed/002_app_config.sql
-- ====================================================
-- App Configuration Seed (production-safe defaults)
INSERT INTO app_config (key, value, description) VALUES
('rate_limit_daily',            '5',                 'Max recognitions an employee can submit per day'),
('rate_limit_monthly',          '20',                'Max recognitions an employee can submit per month'),
('anti_gaming_window_days',     '30',                'Days before same nominator can have another approved recognition for same nominee + same Core Value'),
('duplicate_detection_hours',   '24',                'Hours to check for substantially similar recognition content'),
('badge_period_type',           '"annual"',          'Badge calculation period type'),
('badge_period_start_month',    '1',                 'Annual badge period start month (1=January)'),
('financial_year_q1_start',     '4',                 'Financial year Q1 start month (4=April)'),
('timezone',                    '"Asia/Kolkata"',     'Display timezone for all date/time values'),
('hr_fallback_employee_id',     'null',              'Employee ID to receive escalated approvals when no manager is found'),
('reciprocal_flag_threshold',   '3',                 'Number of reciprocal recognitions before creating an HR flag'),
('recognition_feed_page_size',  '20',                'Number of recognitions per page in the feed')
ON CONFLICT (key) DO NOTHING;


-- ====================================================
-- FILE: supabase/seed/003_core_values.sql
-- ====================================================
-- Core Values Seed (production-safe — these are Touchcore's actual values)
INSERT INTO core_values (name, slug, definition, icon, accent_color, display_order) VALUES
('Adaptable',     'adaptable',     'Adjusts positively and effectively to changing requirements, priorities, technologies, situations and business needs.', 'refresh-cw', '#2563EB', 1),
('Transparent',   'transparent',   'Communicates openly, honestly and responsibly.',                                                                       'eye',        '#14B8A6', 2),
('Collaborative', 'collaborative', 'Works effectively with others and prioritizes collective success.',                                                     'users',      '#7C3AED', 3),
('Innovative',    'innovative',    'Challenges existing approaches and creates better ways of working.',                                                    'lightbulb',  '#EA580C', 4),
('Accountable',   'accountable',   'Takes ownership of commitments, responsibilities, actions and outcomes.',                                              'check-circle','#16A34A', 5)
ON CONFLICT (slug) DO NOTHING;

-- Behaviours for Adaptable
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Quickly adapts to changing client requirements', 'Responds effectively when client needs shift mid-project', 1 FROM core_values WHERE slug = 'adaptable' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Learns new tools or processes', 'Proactively picks up new technology or methodology', 2 FROM core_values WHERE slug = 'adaptable' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Remains effective during uncertainty', 'Maintains quality output when circumstances are unclear', 3 FROM core_values WHERE slug = 'adaptable' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Helps others adapt to change', 'Supports colleagues through transitions and new processes', 4 FROM core_values WHERE slug = 'adaptable' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Adjusts priorities when business needs change', 'Reprioritises workload in response to business direction', 5 FROM core_values WHERE slug = 'adaptable' ON CONFLICT DO NOTHING;

-- Behaviours for Transparent
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Shares important information proactively', 'Does not wait to be asked — surfaces relevant information early', 1 FROM core_values WHERE slug = 'transparent' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Communicates risks early', 'Flags blockers and risks before they escalate', 2 FROM core_values WHERE slug = 'transparent' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Owns mistakes', 'Acknowledges errors and takes responsibility', 3 FROM core_values WHERE slug = 'transparent' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Gives honest and constructive feedback', 'Shares views directly and with respect', 4 FROM core_values WHERE slug = 'transparent' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Communicates clearly with stakeholders', 'Keeps stakeholders informed with clear and timely updates', 5 FROM core_values WHERE slug = 'transparent' ON CONFLICT DO NOTHING;

-- Behaviours for Collaborative
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Supports colleagues', 'Goes beyond their role to help others succeed', 1 FROM core_values WHERE slug = 'collaborative' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Shares knowledge', 'Actively shares expertise with the team', 2 FROM core_values WHERE slug = 'collaborative' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Helps solve cross-functional problems', 'Contributes beyond team boundaries to solve shared problems', 3 FROM core_values WHERE slug = 'collaborative' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Gives credit to others', 'Recognizes and acknowledges the contribution of colleagues', 4 FROM core_values WHERE slug = 'collaborative' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Prioritizes team success', 'Puts collective outcomes above individual recognition', 5 FROM core_values WHERE slug = 'collaborative' ON CONFLICT DO NOTHING;

-- Behaviours for Innovative
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Introduces new solutions', 'Brings fresh approaches to persistent problems', 1 FROM core_values WHERE slug = 'innovative' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Automates repetitive work', 'Identifies and eliminates manual, time-consuming processes', 2 FROM core_values WHERE slug = 'innovative' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Suggests process improvements', 'Proactively proposes ways to work better', 3 FROM core_values WHERE slug = 'innovative' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Experiments with technology', 'Tries new tools and approaches to find better outcomes', 4 FROM core_values WHERE slug = 'innovative' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Challenges inefficient processes constructively', 'Raises process problems with proposed alternatives', 5 FROM core_values WHERE slug = 'innovative' ON CONFLICT DO NOTHING;

-- Behaviours for Accountable
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Delivers on commitments', 'Follows through on what was agreed, on time', 1 FROM core_values WHERE slug = 'accountable' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Takes responsibility for mistakes', 'Owns errors without deflecting blame', 2 FROM core_values WHERE slug = 'accountable' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Escalates risks appropriately', 'Raises blockers to the right person at the right time', 3 FROM core_values WHERE slug = 'accountable' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Takes ownership beyond immediate responsibilities', 'Steps in when something needs doing even if not explicitly their role', 4 FROM core_values WHERE slug = 'accountable' ON CONFLICT DO NOTHING;
INSERT INTO behaviours (core_value_id, name, description, display_order)
SELECT id, 'Keeps stakeholders informed', 'Provides timely updates without being asked', 5 FROM core_values WHERE slug = 'accountable' ON CONFLICT DO NOTHING;

-- ============================================================
-- SCENARIO SEED DATA
-- One scenario file is inserted per behaviour.
-- All scenarios have "A different situation" as fallback via
-- the frontend (not stored in DB — always shown in Step 4).
-- ============================================================

-- Scenarios for Adaptable → Quickly adapts to changing client requirements
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Client changed requirements mid-sprint', 'Scope or requirements changed after development had started', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'adaptable' AND b.name = 'Quickly adapts to changing client requirements'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Emergency pivot due to business change', 'The business direction changed and required a rapid response', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'adaptable' AND b.name = 'Quickly adapts to changing client requirements'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Last-minute client feedback incorporated', 'Client provided feedback close to deadline that required changes', 3
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'adaptable' AND b.name = 'Quickly adapts to changing client requirements'
ON CONFLICT DO NOTHING;

-- Scenarios for Adaptable → Learns new tools or processes
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Picked up a new technology for a project', 'The project required a tool or language not previously used', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'adaptable' AND b.name = 'Learns new tools or processes'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Adopted a new internal process or methodology', 'A new way of working was introduced and adopted quickly', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'adaptable' AND b.name = 'Learns new tools or processes'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Self-taught a skill to unblock the team', 'Learned independently to remove a blocker for the wider team', 3
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'adaptable' AND b.name = 'Learns new tools or processes'
ON CONFLICT DO NOTHING;

-- Scenarios for Transparent → Communicates risks early
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Flagged a delivery risk before it escalated', 'Raised a potential problem early enough for the team to act', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'transparent' AND b.name = 'Communicates risks early'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Raised a technical concern during planning', 'Highlighted a technical risk at the design or planning stage', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'transparent' AND b.name = 'Communicates risks early'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Proactively flagged a dependency risk', 'Identified and communicated a third-party or team dependency risk', 3
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'transparent' AND b.name = 'Communicates risks early'
ON CONFLICT DO NOTHING;

-- Scenarios for Transparent → Shares important information proactively
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Shared critical update without being asked', 'Surfaced important information before stakeholders requested it', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'transparent' AND b.name = 'Shares important information proactively'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Kept the team informed during a difficult situation', 'Maintained clear and regular communication during uncertainty', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'transparent' AND b.name = 'Shares important information proactively'
ON CONFLICT DO NOTHING;

-- Scenarios for Collaborative → Helps solve cross-functional problems
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Resolved a cross-team technical blocker', 'Helped another team unblock a technical issue that was holding them back', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'collaborative' AND b.name = 'Helps solve cross-functional problems'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Supported another team during a critical deadline', 'Stepped in to help a different team meet a time-sensitive delivery', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'collaborative' AND b.name = 'Helps solve cross-functional problems'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Volunteered expertise to another department', 'Shared specialist knowledge with colleagues outside their own team', 3
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'collaborative' AND b.name = 'Helps solve cross-functional problems'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Helped bridge a communication gap between teams', 'Facilitated understanding between two groups who were misaligned', 4
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'collaborative' AND b.name = 'Helps solve cross-functional problems'
ON CONFLICT DO NOTHING;

-- Scenarios for Collaborative → Supports colleagues
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Mentored or onboarded a new team member', 'Invested time helping someone new get up to speed', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'collaborative' AND b.name = 'Supports colleagues'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Stepped in to support an overwhelmed colleague', 'Helped a team member who was struggling with workload or complexity', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'collaborative' AND b.name = 'Supports colleagues'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Provided support during a difficult project phase', 'Offered help during a high-pressure or challenging time', 3
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'collaborative' AND b.name = 'Supports colleagues'
ON CONFLICT DO NOTHING;

-- Scenarios for Collaborative → Shares knowledge
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Ran a knowledge sharing session or brown-bag', 'Organized or led a session to share expertise with the wider team', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'collaborative' AND b.name = 'Shares knowledge'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Documented process or knowledge for the team', 'Created documentation that reduced knowledge silos', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'collaborative' AND b.name = 'Shares knowledge'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Proactively shared expertise in code review or design', 'Offered knowledge and guidance during technical review', 3
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'collaborative' AND b.name = 'Shares knowledge'
ON CONFLICT DO NOTHING;

-- Scenarios for Innovative → Introduces new solutions
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Proposed a better technical architecture or approach', 'Suggested a fundamentally different way to build or solve something', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'innovative' AND b.name = 'Introduces new solutions'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Introduced a new tool or technology that improved outcomes', 'Brought in a tool that meaningfully improved quality or speed', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'innovative' AND b.name = 'Introduces new solutions'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Found a creative solution to a persistent problem', 'Resolved a long-standing challenge with a fresh approach', 3
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'innovative' AND b.name = 'Introduces new solutions'
ON CONFLICT DO NOTHING;

-- Scenarios for Innovative → Automates repetitive work
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Automated a manual, time-consuming process', 'Built a script, tool, or workflow that eliminated repetitive manual work', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'innovative' AND b.name = 'Automates repetitive work'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Created a reusable tool or template for the team', 'Built something that saves time for the whole team, not just themselves', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'innovative' AND b.name = 'Automates repetitive work'
ON CONFLICT DO NOTHING;

-- Scenarios for Accountable → Delivers on commitments
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Delivered on time despite unexpected challenges', 'Met a commitment even when obstacles arose during the work', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'accountable' AND b.name = 'Delivers on commitments'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Took on additional responsibility and followed through', 'Voluntarily took ownership of more and delivered on it', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'accountable' AND b.name = 'Delivers on commitments'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Delivered a high-quality result under pressure', 'Maintained quality and met commitments in a high-pressure situation', 3
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'accountable' AND b.name = 'Delivers on commitments'
ON CONFLICT DO NOTHING;

-- Scenarios for Accountable → Takes responsibility for mistakes
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Owned a production issue and led the resolution', 'Took full ownership of a live problem and drove it to resolution', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'accountable' AND b.name = 'Takes responsibility for mistakes'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Acknowledged an error and took corrective action', 'Proactively admitted a mistake and made it right', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'accountable' AND b.name = 'Takes responsibility for mistakes'
ON CONFLICT DO NOTHING;

-- Scenarios for Accountable → Escalates risks appropriately
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Escalated a risk at exactly the right time', 'Raised a concern to the right person at the right moment', 1
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'accountable' AND b.name = 'Escalates risks appropriately'
ON CONFLICT DO NOTHING;

INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT cv.id, b.id, 'Flagged a compliance or legal risk proactively', 'Identified and escalated a risk with regulatory or legal implications', 2
FROM core_values cv JOIN behaviours b ON b.core_value_id = cv.id
WHERE cv.slug = 'accountable' AND b.name = 'Escalates risks appropriately'
ON CONFLICT DO NOTHING;


-- ====================================================
-- AUTO-LINK EMPLOYEES TRIGGER
-- Automatically links auth.users to public.employees by email
-- ====================================================
CREATE OR REPLACE FUNCTION public.handle_auth_user_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.employees
  SET auth_user_id = NEW.id
  WHERE lower(email) = lower(NEW.email);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_auth_user_created();

-- ====================================================
-- CREATE DEFAULT TEST EMPLOYEES
-- ====================================================
INSERT INTO public.employees (employee_id, full_name, email, role, is_active) VALUES
('TC001', 'Admin User', 'admin@test.com', 'super_admin', true),
('TC002', 'Meera Nair', 'hr@test.com', 'hr_admin', true),
('TC003', 'Rohan Desai', 'manager@test.com', 'manager', true),
('TC004', 'Amit Sharma', 'employee@test.com', 'employee', true)
ON CONFLICT (email) DO UPDATE SET
  role = EXCLUDED.role,
  is_active = true;

-- Link any users that already exist in auth.users
UPDATE public.employees e
SET auth_user_id = u.id
FROM auth.users u
WHERE lower(e.email) = lower(u.email);



-- ====================================================
-- FILE: supabase/migrations/007_rate_limits_and_config_access.sql
-- ====================================================
-- ============================================================
-- Migration 007: Server-side rate limiting + config read access
--
-- Fixes two defects in the original schema:
--   1. Recognition rate limits (REQ-010-02 / REQ-010-03) were only checked by
--      the frontend before INSERT, so any caller holding the anon key could
--      skip the check entirely. They are now enforced by a trigger.
--   2. `app_config` was readable by hr_admin/super_admin only, so the approver
--      routing in the recognition wizard could never read
--      `hr_fallback_employee_id` and silently fell back to "first HR admin".
-- ============================================================

-- ── 1. Rate limiting ────────────────────────────────────────

/**
 * Read a scalar app_config value as text.
 *
 * `#>> '{}'` unwraps a jsonb scalar whether it was stored as a JSON number (5)
 * or as a JSON string ("5"), which the Settings page currently writes.
 */
CREATE OR REPLACE FUNCTION public.app_config_text(config_key text, fallback text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT NULLIF(value #>> '{}', 'null') FROM app_config WHERE key = config_key),
    fallback
  );
$$;

-- SECURITY DEFINER bypasses RLS on app_config, so only the trigger below (which
-- runs as definer itself) may call it — never a client.
REVOKE EXECUTE ON FUNCTION public.app_config_text(text, text) FROM PUBLIC;

/**
 * Enforce per-employee daily and monthly recognition limits.
 *
 * Day and month boundaries are evaluated in the configured display timezone
 * (NFR-006) rather than UTC, so "today" means the same thing here as it does
 * in the UI. Drafts do not count — only submitted nominations.
 */
CREATE OR REPLACE FUNCTION public.enforce_nomination_rate_limits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tz            text;
  daily_limit   integer;
  monthly_limit integer;
  daily_count   integer;
  monthly_count integer;
BEGIN
  -- Rate limits are a product rule for people using the app. The service role
  -- (seeders, Edge Functions) and direct SQL are administrative paths and are
  -- exempt — without this, `npm run seed` would trip the daily limit.
  IF COALESCE(auth.role(), 'service_role') <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  -- Drafts are not submissions and do not consume quota.
  IF NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;

  tz            := public.app_config_text('timezone', 'Asia/Kolkata');
  daily_limit   := public.app_config_text('rate_limit_daily', '5')::integer;
  monthly_limit := public.app_config_text('rate_limit_monthly', '20')::integer;

  SELECT count(*) INTO daily_count
  FROM nominations
  WHERE nominator_id = NEW.nominator_id
    AND status <> 'draft'
    AND (created_at AT TIME ZONE tz)::date = (now() AT TIME ZONE tz)::date;

  IF daily_count >= daily_limit THEN
    RAISE EXCEPTION
      'Daily recognition limit of % reached. Please come back tomorrow.', daily_limit
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO monthly_count
  FROM nominations
  WHERE nominator_id = NEW.nominator_id
    AND status <> 'draft'
    AND date_trunc('month', created_at AT TIME ZONE tz)
        = date_trunc('month', now() AT TIME ZONE tz);

  IF monthly_count >= monthly_limit THEN
    RAISE EXCEPTION
      'Monthly recognition limit of % reached. Your limit resets next month.', monthly_limit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_nomination_rate_limits() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_nomination_rate_limits ON nominations;
CREATE TRIGGER enforce_nomination_rate_limits
  BEFORE INSERT ON nominations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_nomination_rate_limits();

-- ── 2. Config read access ───────────────────────────────────

-- Operational, non-sensitive keys every signed-in user's UI needs. RLS policies
-- are OR'd, so the existing HR-only policies still grant full access; this only
-- widens SELECT for this specific allowlist.
DROP POLICY IF EXISTS "app_config_read_operational" ON app_config;
CREATE POLICY "app_config_read_operational" ON app_config
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND key IN (
      'hr_fallback_employee_id',
      'recognition_feed_page_size',
      'timezone',
      'badge_period_type',
      'badge_period_start_month',
      'financial_year_q1_start'
    )
  );


-- ====================================================
-- FILE: supabase/migrations/008_signup_throttle.sql
-- ====================================================
-- ============================================================
-- Migration 008: Signup attempt throttling
--
-- Supports the eligibility-gated account creation flow implemented in the
-- `signup` Edge Function. Account creation is only ever performed by that
-- function using the service role; this table lets it throttle attempts so a
-- caller cannot brute-force Company ID / name combinations.
--
-- IMPORTANT: this table is written only by the service role. RLS is enabled
-- with NO policies, which denies all access to anon and authenticated roles.
-- ============================================================

CREATE TABLE IF NOT EXISTS signup_attempts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The company email that was attempted. Not a foreign key: attempts against
  -- non-existent employees are exactly what we need to record.
  attempted_identifier TEXT,
  ip_address           TEXT,
  succeeded            BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signup_attempts_ip
  ON signup_attempts (ip_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signup_attempts_identifier
  ON signup_attempts (attempted_identifier, created_at DESC);

ALTER TABLE signup_attempts ENABLE ROW LEVEL SECURITY;
-- No policies by design: service role only.

/**
 * Purge throttling rows older than the retention window.
 *
 * Attempts are only interesting for the throttle window; keeping them longer
 * turns a rate-limit aid into an unnecessary log of who tried to register.
 */
CREATE OR REPLACE FUNCTION public.purge_old_signup_attempts()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM signup_attempts WHERE created_at < now() - interval '24 hours';
$$;

REVOKE EXECUTE ON FUNCTION public.purge_old_signup_attempts() FROM PUBLIC;


-- ====================================================
-- FILE: supabase/migrations/009_approval_notifications_and_clarification.sql
-- ====================================================
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


-- ====================================================
-- FILE: supabase/migrations/010_signup_gate_and_invitations.sql
-- ====================================================
-- ============================================================
-- Migration 010: Database-enforced signup gate + invitations
--
-- Replaces the `signup` Edge Function as the eligibility gate.
--
-- Why the change: the Edge Function could only gate signups that went *through*
-- it. Anyone could still call auth.signUp() directly with the public key, so the
-- gate depended on also disabling public signup. Enforcing eligibility in a
-- trigger on auth.users inverts that: signup can stay open, because every route
-- into auth.users — the browser SDK, the REST API, curl — passes through this
-- check. It also removes the Edge Function deployment (and its CORS/JWT setup)
-- from the critical path for creating an account.
--
-- The gate is two independent factors:
--   1. This trigger: the address must belong to an active, unregistered employee.
--   2. Supabase email confirmation: the person must open a link in that mailbox.
-- ============================================================

-- ── 1. Auto-assign Company IDs ──────────────────────────────

/**
 * Fill employee_id when HR does not supply one.
 *
 * HR now invites people by email address, so requiring them to invent a unique
 * Company ID for every new hire is friction with no benefit. Runs BEFORE INSERT,
 * so the NOT NULL constraint still sees a value.
 */
CREATE OR REPLACE FUNCTION public.assign_employee_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num integer;
BEGIN
  IF NEW.employee_id IS NULL OR btrim(NEW.employee_id) = '' THEN
    -- Highest numeric suffix currently in use, regardless of prefix.
    SELECT COALESCE(MAX(NULLIF(regexp_replace(employee_id, '\D', '', 'g'), '')::integer), 0) + 1
      INTO next_num
      FROM employees;

    NEW.employee_id := 'TC' || lpad(next_num::text, 3, '0');
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_employee_id() FROM PUBLIC;

DROP TRIGGER IF EXISTS assign_employee_id ON employees;
CREATE TRIGGER assign_employee_id
  BEFORE INSERT ON employees
  FOR EACH ROW EXECUTE FUNCTION public.assign_employee_id();


-- ── 2. Eligibility check for the signup form ────────────────

/**
 * Tell the signup form whether an address may register, without leaking staff data.
 *
 * This exists purely so the UI can show a useful message. It is NOT the security
 * boundary — the trigger below is, and it runs whether or not this was called.
 *
 * Returns one of: 'eligible', 'already_registered', 'not_eligible'.
 *
 * 'not_eligible' deliberately covers unknown address, inactive employee and name
 * mismatch alike. Both the address and the exact full name must match before the
 * function will admit that a record exists, so it cannot be used to enumerate
 * staff by email alone.
 */
CREATE OR REPLACE FUNCTION public.check_signup_eligibility(
  p_email     text,
  p_full_name text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp employees%ROWTYPE;
BEGIN
  IF p_email IS NULL OR p_full_name IS NULL THEN
    RETURN 'not_eligible';
  END IF;

  SELECT * INTO emp
  FROM employees
  WHERE lower(email) = lower(btrim(p_email))
  LIMIT 1;

  IF emp.id IS NULL OR NOT emp.is_active THEN
    RETURN 'not_eligible';
  END IF;

  IF lower(regexp_replace(btrim(emp.full_name), '\s+', ' ', 'g'))
     IS DISTINCT FROM
     lower(regexp_replace(btrim(p_full_name), '\s+', ' ', 'g'))
  THEN
    RETURN 'not_eligible';
  END IF;

  IF emp.auth_user_id IS NOT NULL THEN
    RETURN 'already_registered';
  END IF;

  RETURN 'eligible';
END;
$$;

-- The signup form is used by people who are not signed in yet.
GRANT EXECUTE ON FUNCTION public.check_signup_eligibility(text, text) TO anon, authenticated;


-- ── 3. The actual gate: trigger on auth.users ───────────────

/**
 * Reject account creation for anyone who is not an eligible employee, and link
 * the new auth user to their employee record.
 *
 * Runs inside the INSERT's transaction, so raising here aborts the signup and no
 * auth user is left behind — which is also what makes a separate compensating
 * "delete the orphaned user" step unnecessary.
 *
 * The role is never taken from signup metadata. It lives on employees.role and
 * reaches the JWT through custom_access_token_hook, so a caller cannot promote
 * themselves by passing a role at signup.
 */
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp          employees%ROWTYPE;
  claimed_name text := NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), '');
  linked       integer;
BEGIN
  SELECT * INTO emp
  FROM employees
  WHERE lower(email) = lower(btrim(NEW.email))
  LIMIT 1;

  IF emp.id IS NULL THEN
    RAISE EXCEPTION 'This email address is not registered as a Touchcore employee.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT emp.is_active THEN
    RAISE EXCEPTION 'This employee record is not active. Please contact HR.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF emp.auth_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'An account already exists for this email address.'
      USING ERRCODE = 'unique_violation';
  END IF;

  IF claimed_name IS NOT NULL
     AND lower(regexp_replace(claimed_name, '\s+', ' ', 'g'))
         IS DISTINCT FROM
         lower(regexp_replace(btrim(emp.full_name), '\s+', ' ', 'g'))
  THEN
    RAISE EXCEPTION 'The name provided does not match our records.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Guarded so two concurrent signups for one employee cannot both link.
  UPDATE employees
     SET auth_user_id = NEW.id
   WHERE id = emp.id
     AND auth_user_id IS NULL;

  GET DIAGNOSTICS linked = ROW_COUNT;
  IF linked = 0 THEN
    RAISE EXCEPTION 'An account already exists for this email address.'
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();


-- ── 4. Repair accounts created before this migration ────────
--
-- Any account created while the gate did not exist is in auth.users but was
-- never linked to an employee row, so signing in resolves to "no employee" and
-- the app bounces the person back to the login page with no explanation.
--
-- Link them by email. Only rows that are still unclaimed on both sides are
-- touched, so this is safe to re-run and cannot steal an existing link.
UPDATE employees e
   SET auth_user_id = u.id
  FROM auth.users u
 WHERE e.auth_user_id IS NULL
   AND lower(e.email) = lower(u.email)
   AND NOT EXISTS (
         SELECT 1 FROM employees other WHERE other.auth_user_id = u.id
       );

-- ── 5. A note on deactivation ───────────────────────────────
--
-- Deactivating an employee deliberately does NOT clear auth_user_id.
--
-- Clearing it looks tidy but strands the person: their row in auth.users still
-- holds the address, so they cannot register again, while the missing link means
-- reactivating them would not restore access either.
--
-- Leaving the link in place is both simpler and correct. Deactivation already
-- removes access — AuthContext only loads employees WHERE is_active, so the
-- session resolves to no employee and the route guards send them to login, and
-- every RLS policy keys off an employee_id claim they no longer resolve to.
-- Reactivation then restores access with no re-registration.
