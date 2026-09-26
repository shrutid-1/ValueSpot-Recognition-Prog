# Touchcore ValueSpot — Security Model

## Security Philosophy

1. **Defense in depth**: Frontend routing is UX convenience. RLS is the real security layer.
2. **Least privilege**: Each role sees only what they need.
3. **Server-enforced**: No security logic relies on client-side code.
4. **Audit everything**: All significant state changes are logged.
5. **Privacy by default**: Sensitive information (rejections, HR notes, flags) is never surfaced to employees.

---

## Role Definitions

| Role | Supabase Custom Claim | Description |
|---|---|---|
| `employee` | `user_role: 'employee'` | Standard employee |
| `manager` | `user_role: 'manager'` | Can approve team nominations |
| `hr_admin` | `user_role: 'hr_admin'` | Full HR and analytics access |
| `super_admin` | `user_role: 'super_admin'` | Technical system administration |

Role is stored in the `employees` table and also added as a custom JWT claim via a Supabase Auth hook (DB function triggered on sign-in).

---

## JWT Custom Claims

A Postgres function adds the employee's role and employee_id to the JWT on each auth:

```sql
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  claims jsonb;
  emp_role text;
  emp_id uuid;
BEGIN
  SELECT role, id INTO emp_role, emp_id
  FROM public.employees
  WHERE auth_user_id = (event->>'user_id')::uuid;

  claims := event->'claims';
  claims := jsonb_set(claims, '{user_role}', to_jsonb(emp_role));
  claims := jsonb_set(claims, '{employee_id}', to_jsonb(emp_id::text));
  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;
```

This allows RLS policies to use `(auth.jwt()->'user_role')::text` without additional lookups.

---

## Helper Functions for RLS

```sql
-- Get current employee's role from JWT
CREATE OR REPLACE FUNCTION auth.user_role() 
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT (auth.jwt()->>'user_role')::text;
$$;

-- Get current employee's ID from JWT
CREATE OR REPLACE FUNCTION public.employee_id() 
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (auth.jwt()->>'employee_id')::uuid;
$$;

-- Check if current user is HR or above
CREATE OR REPLACE FUNCTION auth.is_hr_or_above() 
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT auth.user_role() IN ('hr_admin', 'super_admin');
$$;

-- Check if current user is manager or above
CREATE OR REPLACE FUNCTION auth.is_manager_or_above() 
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT auth.user_role() IN ('manager', 'hr_admin', 'super_admin');
$$;
```

---

## Row Level Security Policies

### `employees` table

```sql
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- All authenticated users can search active employees (for recognition)
CREATE POLICY "employees_read_active" ON employees
  FOR SELECT USING (
    auth.role() = 'authenticated' AND (
      is_active = true OR id = public.employee_id()
    )
  );

-- Employees can update their own profile fields only
CREATE POLICY "employees_update_own" ON employees
  FOR UPDATE USING (id = public.employee_id())
  WITH CHECK (
    id = public.employee_id() AND
    -- Prevent self-role-elevation
    role = (SELECT role FROM employees WHERE id = public.employee_id())
  );

-- HR and Super Admin have full access
CREATE POLICY "employees_hr_admin" ON employees
  FOR ALL USING (auth.is_hr_or_above());
```

---

### `nominations` table

```sql
ALTER TABLE nominations ENABLE ROW LEVEL SECURITY;

-- Employees can read nominations they submitted or received (only approved for received)
CREATE POLICY "nominations_read_own" ON nominations
  FOR SELECT USING (
    nominator_id = public.employee_id() OR
    (nominee_id = public.employee_id() AND status = 'approved') OR
    (nominee_id = public.employee_id() AND status = 'clarification_requested')
  );

-- Managers can read nominations assigned to them for approval
CREATE POLICY "nominations_read_approver" ON nominations
  FOR SELECT USING (
    auth.is_manager_or_above() AND
    assigned_approver_id = public.employee_id()
  );

-- HR and above can read all
CREATE POLICY "nominations_hr_read_all" ON nominations
  FOR SELECT USING (auth.is_hr_or_above());

-- Any authenticated employee can create a nomination (rate limits enforced at Edge Function level)
CREATE POLICY "nominations_insert" ON nominations
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND
    nominator_id = public.employee_id() AND
    nominator_id != nominee_id
  );

-- Nominator can update their own pending or clarification-requested nominations
CREATE POLICY "nominations_update_own" ON nominations
  FOR UPDATE USING (
    nominator_id = public.employee_id() AND
    status IN ('draft', 'clarification_requested')
  );

-- Approvers can update nominations assigned to them
CREATE POLICY "nominations_update_approver" ON nominations
  FOR UPDATE USING (
    auth.is_manager_or_above() AND
    assigned_approver_id = public.employee_id() AND
    status = 'pending'
  );

-- HR can update any nomination
CREATE POLICY "nominations_hr_update" ON nominations
  FOR UPDATE USING (auth.is_hr_or_above());
```

---

### `notifications` table

```sql
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notifications
CREATE POLICY "notifications_own" ON notifications
  FOR ALL USING (recipient_id = public.employee_id());

-- HR can see all notifications
CREATE POLICY "notifications_hr" ON notifications
  FOR SELECT USING (auth.is_hr_or_above());
```

---

### `employee_value_badges` table

```sql
ALTER TABLE employee_value_badges ENABLE ROW LEVEL SECURITY;

-- Employees can read their own badges
CREATE POLICY "evb_read_own" ON employee_value_badges
  FOR SELECT USING (employee_id = public.employee_id());

-- Managers can read their direct reports' badges
CREATE POLICY "evb_read_team" ON employee_value_badges
  FOR SELECT USING (
    auth.is_manager_or_above() AND
    employee_id IN (
      SELECT id FROM employees WHERE manager_id = public.employee_id()
    )
  );

-- HR can read all
CREATE POLICY "evb_hr_read_all" ON employee_value_badges
  FOR SELECT USING (auth.is_hr_or_above());

-- Only Edge Functions (service role) can write badge data
-- No direct INSERT/UPDATE/DELETE from frontend
```

---

### `badge_history` table

```sql
ALTER TABLE badge_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "badge_history_read_own" ON badge_history
  FOR SELECT USING (employee_id = public.employee_id());

CREATE POLICY "badge_history_read_team" ON badge_history
  FOR SELECT USING (
    auth.is_manager_or_above() AND
    employee_id IN (
      SELECT id FROM employees WHERE manager_id = public.employee_id()
    )
  );

CREATE POLICY "badge_history_hr" ON badge_history
  FOR SELECT USING (auth.is_hr_or_above());
```

---

### `audit_logs` table

```sql
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Only HR Admin and Super Admin can read audit logs
CREATE POLICY "audit_logs_hr_only" ON audit_logs
  FOR SELECT USING (auth.is_hr_or_above());

-- Only service role (Edge Functions) can insert audit logs
-- No INSERT policy for authenticated users
```

---

### `reciprocal_recognition_flags` table

```sql
ALTER TABLE reciprocal_recognition_flags ENABLE ROW LEVEL SECURITY;

-- Only HR Admin and above can see flags
CREATE POLICY "flags_hr_only" ON reciprocal_recognition_flags
  FOR ALL USING (auth.is_hr_or_above());
```

---

### `app_config` table

```sql
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

-- HR Admin and above can read config
CREATE POLICY "config_read_hr" ON app_config
  FOR SELECT USING (auth.is_hr_or_above());

-- Only HR Admin and above can modify config
CREATE POLICY "config_write_hr" ON app_config
  FOR ALL USING (auth.is_hr_or_above());
```

---

### `core_values`, `behaviours`, `scenarios` tables

```sql
-- All authenticated users can read active values/behaviours/scenarios
CREATE POLICY "cv_read_active" ON core_values
  FOR SELECT USING (auth.role() = 'authenticated' AND is_active = true);

CREATE POLICY "cv_hr_full" ON core_values
  FOR ALL USING (auth.is_hr_or_above());

-- Same pattern for behaviours and scenarios
```

---

### `badge_definitions` table

```sql
-- All authenticated users can read badge definitions
CREATE POLICY "bd_read_all" ON badge_definitions
  FOR SELECT USING (auth.role() = 'authenticated');

-- Only HR Admin can modify
CREATE POLICY "bd_hr_write" ON badge_definitions
  FOR ALL USING (auth.is_hr_or_above());
```

---

## Data Privacy Rules

### What employees CANNOT see:
- `nominations.rejection_reason` for their own rejections (stored but not surfaced in UI)
- `nominations` records in `rejected` status for nominations they submitted (stored for audit)
- `nominations` where they are the nominee in `pending` or `rejected` status
- `reciprocal_recognition_flags` records
- `audit_logs`
- Other employees' badge history
- HR analytics or reports

### What managers CAN see:
- Their own team's nomination records in `pending` status (to approve/reject)
- Their own team's `employee_value_badges` for dashboard analytics
- Recognition feed (same as employees)

### What HR Admin can see:
- All nominations in all states
- All audit logs
- All reciprocal flags
- All employees, departments, projects
- All badge data
- All config

---

## Edge Function Security

Edge Functions use the Supabase service role key (via environment variable, never in frontend).

All Edge Functions:
1. Validate the caller's JWT before processing
2. Extract role from JWT claims
3. Validate the caller has permission for the requested operation
4. Use service role only for operations that require bypassing RLS (e.g., badge calculation, audit log writes)

```typescript
// Pattern for Edge Function auth validation
const authHeader = req.headers.get('Authorization')
const { data: { user }, error } = await supabase.auth.getUser(
  authHeader?.replace('Bearer ', '') ?? ''
)
if (!user) return new Response('Unauthorized', { status: 401 })
```

---

## Frontend Security Rules

1. Never store sensitive data in localStorage (use Supabase session management)
2. Never hardcode any Supabase keys except `VITE_SUPABASE_ANON_KEY`
3. Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend code
4. Route guards are UX only — never trust them for authorization
5. All API calls use the anon key; RLS handles access control
6. Sanitize all user-provided text before rendering (use React's built-in XSS protection)

---

## Sensitive Data Handling

| Field | Who can see it | Where stored |
|---|---|---|
| Rejection reason | HR only (not nominee) | `nominations.rejection_reason` |
| Clarification note | Nominator + HR | `nominations.clarification_note` |
| HR anomaly flags | HR only | `reciprocal_recognition_flags` |
| Audit log data | HR Admin + Super Admin | `audit_logs` |
| Manager notes | Manager + HR | In approval records (future) |
| Employee salary | Not in this system | N/A |

---

## Rate Limiting

Rate limiting is enforced at the Edge Function level (not purely frontend):

```
check-rate-limits function:
  1. Count nominations created by this employee today
  2. Count nominations created by this employee this month
  3. Compare against app_config values
  4. Return allowed: true/false with reason
  5. Frontend shows appropriate message
  6. Frontend cannot bypass this — Edge Function must approve before INSERT
```
