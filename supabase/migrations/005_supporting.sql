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
