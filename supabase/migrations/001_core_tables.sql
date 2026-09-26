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
