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
