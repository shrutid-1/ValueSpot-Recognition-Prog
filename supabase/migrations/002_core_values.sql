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
