# Touchcore ValueSpot — Database Schema

## Schema Design Principles

1. All timestamps stored in UTC
2. Soft deletes via `is_active` or `archived_at` flags — never hard delete historical data
3. Historical snapshot fields on nominations to preserve accuracy after relationship changes
4. UUID primary keys throughout
5. Foreign key constraints with appropriate cascade rules
6. Check constraints on enum-like fields
7. Indexes on all frequently-queried and joined columns

---

## Tables

### `departments`
```sql
CREATE TABLE departments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL UNIQUE,
  description  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### `employees`
```sql
CREATE TABLE employees (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id      UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  employee_id       TEXT UNIQUE NOT NULL,  -- e.g. TC001
  full_name         TEXT NOT NULL,
  email             TEXT UNIQUE NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('employee', 'manager', 'hr_admin', 'super_admin')),
  department_id     UUID REFERENCES departments(id),
  manager_id        UUID REFERENCES employees(id),
  avatar_url        TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  joined_at         DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_employees_auth_user_id ON employees(auth_user_id);
CREATE INDEX idx_employees_department_id ON employees(department_id);
CREATE INDEX idx_employees_manager_id ON employees(manager_id);
CREATE INDEX idx_employees_role ON employees(role);
CREATE INDEX idx_employees_is_active ON employees(is_active);
```

---

### `projects`
```sql
CREATE TABLE projects (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  description    TEXT,
  project_code   TEXT UNIQUE,
  manager_id     UUID REFERENCES employees(id),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  archived_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### `project_members`
```sql
CREATE TABLE project_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id),
  employee_id  UUID NOT NULL REFERENCES employees(id),
  joined_at    DATE NOT NULL DEFAULT CURRENT_DATE,
  left_at      DATE,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, employee_id, joined_at)
);

CREATE INDEX idx_project_members_project_id ON project_members(project_id);
CREATE INDEX idx_project_members_employee_id ON project_members(employee_id);
```

---

### `core_values`
```sql
CREATE TABLE core_values (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL UNIQUE,
  slug            TEXT NOT NULL UNIQUE,  -- 'adaptable', 'transparent', etc.
  definition      TEXT NOT NULL,
  icon            TEXT NOT NULL,          -- Lucide icon name
  accent_color    TEXT NOT NULL,          -- hex colour
  display_order   INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### `behaviours`
```sql
CREATE TABLE behaviours (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  core_value_id   UUID NOT NULL REFERENCES core_values(id),
  name            TEXT NOT NULL,
  description     TEXT,
  examples        TEXT[],                -- array of example strings
  display_order   INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(core_value_id, name)
);

CREATE INDEX idx_behaviours_core_value_id ON behaviours(core_value_id);
```

---

### `scenarios`
```sql
CREATE TABLE scenarios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  behaviour_id    UUID NOT NULL REFERENCES behaviours(id),
  core_value_id   UUID NOT NULL REFERENCES core_values(id),
  name            TEXT NOT NULL,
  description     TEXT,
  examples        TEXT[],
  display_order   INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenarios_behaviour_id ON scenarios(behaviour_id);
CREATE INDEX idx_scenarios_core_value_id ON scenarios(core_value_id);
```

---

### `nominations`
The core recognition record. Carries historical snapshot data.

```sql
CREATE TABLE nominations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Participants
  nominator_id                UUID NOT NULL REFERENCES employees(id),
  nominee_id                  UUID NOT NULL REFERENCES employees(id),
  
  -- Core Value reference
  core_value_id               UUID NOT NULL REFERENCES core_values(id),
  behaviour_id                UUID REFERENCES behaviours(id),
  scenario_id                 UUID REFERENCES scenarios(id),
  
  -- Recognition content
  what_happened               TEXT NOT NULL,
  what_impact                 TEXT NOT NULL,
  project_id                  UUID REFERENCES projects(id),
  
  -- Historical snapshots (denormalized for data integrity)
  snapshot_nominator_dept     TEXT,
  snapshot_nominee_dept       TEXT,
  snapshot_nominee_manager_id UUID,
  snapshot_core_value_name    TEXT NOT NULL,
  snapshot_behaviour_name     TEXT,
  snapshot_scenario_name      TEXT,
  snapshot_project_name       TEXT,
  
  -- Recognition source classification
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
  rejection_reason            TEXT,
  
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
  
  -- Constraints
  CONSTRAINT no_self_nomination CHECK (nominator_id != nominee_id)
);

CREATE INDEX idx_nominations_nominator_id ON nominations(nominator_id);
CREATE INDEX idx_nominations_nominee_id ON nominations(nominee_id);
CREATE INDEX idx_nominations_core_value_id ON nominations(core_value_id);
CREATE INDEX idx_nominations_status ON nominations(status);
CREATE INDEX idx_nominations_assigned_approver_id ON nominations(assigned_approver_id);
CREATE INDEX idx_nominations_approved_at ON nominations(approved_at);
CREATE INDEX idx_nominations_submitted_at ON nominations(submitted_at);
CREATE INDEX idx_nominations_project_id ON nominations(project_id);
```

---

### `nomination_appreciations`
```sql
CREATE TABLE nomination_appreciations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nomination_id  UUID NOT NULL REFERENCES nominations(id) ON DELETE CASCADE,
  employee_id    UUID NOT NULL REFERENCES employees(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(nomination_id, employee_id)
);

CREATE INDEX idx_appreciations_nomination_id ON nomination_appreciations(nomination_id);
```

---

### `badge_definitions`
```sql
CREATE TABLE badge_definitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level           INTEGER NOT NULL UNIQUE CHECK (level BETWEEN 1 AND 5),
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  minimum_count   INTEGER NOT NULL,
  maximum_count   INTEGER,               -- NULL for B5 (no upper bound)
  icon            TEXT NOT NULL,          -- Lucide icon name or emoji
  accent_color    TEXT NOT NULL,
  display_order   INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed data
INSERT INTO badge_definitions (level, name, description, minimum_count, maximum_count, icon, accent_color, display_order) VALUES
(1, 'Cheers',           'A Core Value behaviour has been recognized.',                          1,  2,    'star',       '#F59E0B', 1),
(2, 'Applause',         'The behaviour is being recognized repeatedly.',                        3,  5,    'hand-clap',  '#3B82F6', 2),
(3, 'Kudos',            'Strong recurring recognition.',                                        6,  10,   'award',      '#7C3AED', 3),
(4, 'Spotlight',        'Consistent recognition for the Core Value.',                          11,  15,   'zap',        '#EA580C', 4),
(5, 'Value Ambassador', 'Strong and sustained recognition for the Core Value.',                16,  NULL, 'trophy',     '#16A34A', 5);
```

---

### `employee_value_badges`
Current badge state per employee × Core Value × period.

```sql
CREATE TABLE employee_value_badges (
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

CREATE INDEX idx_evb_employee_id ON employee_value_badges(employee_id);
CREATE INDEX idx_evb_core_value_id ON employee_value_badges(core_value_id);
CREATE INDEX idx_evb_period ON employee_value_badges(period_type, period_start, period_end);
CREATE INDEX idx_evb_badge_level ON employee_value_badges(badge_level);
```

---

### `badge_history`
Immutable record of each badge level change.

```sql
CREATE TABLE badge_history (
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

CREATE INDEX idx_badge_history_employee_id ON badge_history(employee_id);
CREATE INDEX idx_badge_history_core_value_id ON badge_history(core_value_id);
CREATE INDEX idx_badge_history_achieved_at ON badge_history(achieved_at);
```

---

### `notifications`
```sql
CREATE TABLE notifications (
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
  related_id    UUID,              -- nomination_id, badge_history_id, etc.
  related_type  TEXT,              -- 'nomination', 'badge', 'report'
  is_read       BOOLEAN NOT NULL DEFAULT false,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_recipient_id ON notifications(recipient_id);
CREATE INDEX idx_notifications_is_read ON notifications(recipient_id, is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
```

---

### `audit_logs`
```sql
CREATE TABLE audit_logs (
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

CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
```

---

### `reciprocal_recognition_flags`
Internal HR-only tracking. Never visible to employees.

```sql
CREATE TABLE reciprocal_recognition_flags (
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
```

---

### `app_config`
All configurable values. Nothing is hard-coded.

```sql
CREATE TABLE app_config (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES employees(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed configuration
INSERT INTO app_config (key, value, description) VALUES
('rate_limit_daily',            '5',                       'Max recognitions per employee per day'),
('rate_limit_monthly',          '20',                      'Max recognitions per employee per month'),
('anti_gaming_window_days',     '30',                      'Days before same nominator can re-recognize same nominee+value'),
('duplicate_detection_hours',   '24',                      'Hours to check for duplicate recognition content'),
('badge_period_type',           '"annual"',                'Default badge calculation period (annual)'),
('badge_period_start_month',    '1',                       'Annual badge period start month (1=January)'),
('financial_year_q1_start',     '4',                       'Financial year Q1 start month (4=April)'),
('timezone',                    '"Asia/Kolkata"',           'Display timezone'),
('hr_fallback_employee_id',     'null',                    'HR employee to receive escalated approvals'),
('reciprocal_flag_threshold',   '3',                       'Number of reciprocal recognitions before flagging'),
('recognition_feed_page_size',  '20',                      'Number of recognitions per feed page');
```

---

### `rewards`
```sql
CREATE TABLE rewards (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  description           TEXT,
  frequency             TEXT,              -- 'monthly', 'quarterly', 'annual', 'ad-hoc'
  eligibility_criteria  TEXT,
  value_description     TEXT,
  requires_approval     BOOLEAN NOT NULL DEFAULT true,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### `reward_assignments`
```sql
CREATE TABLE reward_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id     UUID NOT NULL REFERENCES rewards(id),
  employee_id   UUID NOT NULL REFERENCES employees(id),
  assigned_by   UUID NOT NULL REFERENCES employees(id),
  nomination_id UUID REFERENCES nominations(id),
  notes         TEXT,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## Views

### `v_recognition_feed`
```sql
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
  
  -- Behaviour / Scenario (snapshot-first, fallback to live)
  COALESCE(n.snapshot_behaviour_name, b.name) AS behaviour_name,
  COALESCE(n.snapshot_scenario_name, s.name)  AS scenario_name,
  
  -- Project (snapshot-first)
  COALESCE(n.snapshot_project_name, p.name)   AS project_name,
  n.project_id,
  
  -- Appreciations count
  (SELECT COUNT(*) FROM nomination_appreciations na WHERE na.nomination_id = n.id) AS appreciation_count

FROM nominations n
JOIN employees nominator ON n.nominator_id = nominator.id
JOIN employees nominee   ON n.nominee_id = nominee.id
JOIN core_values cv       ON n.core_value_id = cv.id
LEFT JOIN behaviours b    ON n.behaviour_id = b.id
LEFT JOIN scenarios s     ON n.scenario_id = s.id
LEFT JOIN projects p      ON n.project_id = p.id

WHERE n.status = 'approved';
```

---

## RLS Policies Summary

Detailed RLS implementation is in `security-model.md`. The following table summarizes access intent:

| Table | Employee | Manager | HR Admin | Super Admin |
|---|---|---|---|---|
| employees | Read self + search active | Read self + team | Full CRUD | Full |
| nominations | Read own (not rejected others) | Read own + team pending | Full | Full |
| v_recognition_feed | Read all approved | Read all approved | Full | Full |
| notifications | Read/write own | Read/write own | Full | Full |
| badge_definitions | Read | Read | Full CRUD | Full |
| employee_value_badges | Read own | Read own + team | Full | Full |
| badge_history | Read own | Read own + team | Full | Full |
| audit_logs | None | None | Read | Full |
| app_config | None | None | Read + Write | Full |
| reciprocal_recognition_flags | None | None | Full | Full |
| core_values | Read active | Read active | Full CRUD | Full |
| behaviours | Read active | Read active | Full CRUD | Full |
| scenarios | Read active | Read active | Full CRUD | Full |
| rewards | None | None | Full CRUD | Full |
| departments | Read | Read | Full CRUD | Full |
| projects | Read | Read | Full CRUD | Full |
