---
inclusion: always
---

# Touchcore ValueSpot — Database Conventions

## Schema: `public`

All application tables are in the `public` schema. Supabase Auth tables are in the `auth` schema.

## Naming Conventions

- Tables: snake_case, plural (`employees`, `nominations`, `badge_definitions`)
- Columns: snake_case (`full_name`, `core_value_id`, `approved_at`)
- Primary keys: always `id UUID DEFAULT gen_random_uuid()`
- Foreign keys: `[referenced_table_singular]_id` (e.g., `employee_id`, `core_value_id`)
- Boolean flags: `is_*` prefix (`is_active`, `is_read`)
- Timestamps: always `TIMESTAMPTZ`, stored UTC, suffix `_at` (`created_at`, `approved_at`)
- Date-only fields: `DATE` type, suffix `_date` or just descriptive (`joined_at`, `period_start`)
- Enum-like text fields: always have CHECK constraints

## Timestamp Pattern

Every table has:
```sql
created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

Use a trigger to auto-update `updated_at`:
```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON [table_name]
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

## Soft Deletes

Never hard-delete records that could be referenced by historical data:
- Use `is_active BOOLEAN DEFAULT true` for employees, Core Values, behaviours, scenarios
- Use `archived_at TIMESTAMPTZ` for projects, Core Values
- Never use `deleted_at` — use the above patterns

Hard deletes are only permitted for:
- Draft nominations (not yet submitted)
- Test/seed data cleanup

## Foreign Key Rules

Reference table structure:
```sql
-- Always include ON DELETE rule explicitly
core_value_id UUID NOT NULL REFERENCES core_values(id) ON DELETE RESTRICT
employee_id   UUID REFERENCES employees(id) ON DELETE SET NULL
```

Use `ON DELETE RESTRICT` for data integrity (nominations cannot be deleted if Core Value exists)
Use `ON DELETE CASCADE` only for clearly dependent records (nomination_appreciations when nomination deleted)
Use `ON DELETE SET NULL` for optional relationships

## Indexes

Always index:
- All foreign key columns
- All columns used in WHERE clauses
- `status` columns
- `is_active` columns combined with other query predicates
- `created_at` / `approved_at` for range queries (DESC)

## Historical Snapshot Pattern

The `nominations` table carries snapshot fields. These are populated at INSERT time and NEVER updated:
```sql
snapshot_nominator_dept     TEXT  -- dept name at time of nomination
snapshot_nominee_dept       TEXT  -- dept name at time of nomination
snapshot_nominee_manager_id UUID  -- manager at time of nomination
snapshot_core_value_name    TEXT  -- CV name at time of nomination
snapshot_behaviour_name     TEXT  -- behaviour name at time of nomination
snapshot_scenario_name      TEXT  -- scenario name at time of nomination
snapshot_project_name       TEXT  -- project name at time of nomination
```

When displaying historical recognition, use snapshot fields first:
```sql
COALESCE(snapshot_behaviour_name, b.name) AS behaviour_name
```

## Migrations

- All schema changes through migration files in `supabase/migrations/`
- File naming: `YYYYMMDDHHMMSS_description.sql`
- Each migration is idempotent where possible (use `CREATE TABLE IF NOT EXISTS`)
- Never modify existing migrations — create new ones

## Seed Data

- Badge definitions seed: `supabase/seed/001_badge_definitions.sql`
- App config seed: `supabase/seed/002_app_config.sql`
- Demo data: `supabase/seed/003_demo_data.sql`

Demo data is clearly commented:
```sql
-- DEVELOPMENT SEED DATA ONLY
-- Do NOT run this in production
```

## Configuration Table Pattern

All runtime-configurable values are in `app_config`:
```sql
SELECT value FROM app_config WHERE key = 'rate_limit_daily'
```

Never hard-code these values in application code:
- `rate_limit_daily`
- `rate_limit_monthly`
- `anti_gaming_window_days`
- `badge_period_start_month`
- `financial_year_q1_start`
- `hr_fallback_employee_id`

## RLS Requirement

Every table MUST have RLS enabled:
```sql
ALTER TABLE [table_name] ENABLE ROW LEVEL SECURITY;
```

No table is exempt. If a table has no RLS policies, it defaults to deny-all for non-service-role users.

## View Convention

Prefix views with `v_`:
- `v_recognition_feed`
- `v_badge_summary` (future)

Views should not be writable — all writes go through base tables.
