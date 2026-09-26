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
