# ValueSpot Mock Data Seeding

This directory contains the seeding system for populating ValueSpot database with mock data from `src/data/valuespot-mock-data.json`.

## Files

- **seedService.ts** — Main orchestration service
- **departmentSeeder.ts** — Department seeding logic
- **coreValueSeeder.ts** — Core values, behaviours, and scenarios seeding
- **projectSeeder.ts** — Project seeding logic
- **employeeSeeder.ts** — Employee seeding with UUID mapping and manager backfill
- **projectMemberSeeder.ts** — Project membership seeding
- **nominationSeeder.ts** — Nominations and appreciations seeding
- **utils.ts** — Shared utilities (UUID generation, date parsing, logging)
- **seed.ts** — CLI entry point

## Quick Start

### 1. Ensure .env is configured

```bash
# .env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

### 2. Run the seeding script

```bash
# Using ts-node
npx ts-node src/data/seeders/seed.ts

# Or using npm script (if configured in package.json)
npm run seed:dev
```

### 3. Monitor the output

The seeding process logs each step with counts:

```
[2024-09-01T10:30:45.123Z] DEPARTMENTS: Starting department seeding...
[2024-09-01T10:30:45.234Z] DEPARTMENTS: Inserted Platform
[2024-09-01T10:30:45.345Z] ✅ DEPARTMENTS: Department seeding complete { inserted: 6, updated: 0, skipped: 0 }
...
============================================================
SEEDING SUMMARY
============================================================
  departments          │ ✏️  6 inserted, 🔄 0 updated, ⏭️  0 skipped
  core_values          │ ✏️  5 inserted, 🔄 0 updated, ⏭️  0 skipped
  ...
============================================================
Status: ✅ SUCCESS
Duration: 5234ms
============================================================
```

## Seeding Order & Dependencies

The seeders run in this order to respect foreign key dependencies:

1. **Departments** ← No dependencies
2. **Core Values** ← No dependencies
3. **Behaviours** ← Depends on Core Values
4. **Scenarios** ← Depends on Behaviours
5. **Projects** ← No dependencies
6. **Employees** ← Depends on Departments
7. **Manager Backfill** ← Depends on Employees
8. **Project Members** ← Depends on Projects, Employees
9. **Nominations** ← Depends on Employees, Core Values, Behaviours, Projects
10. **Appreciations** ← Depends on Nominations, Employees

## Key Features

### Idempotency

All seeders use UPSERT logic (INSERT ON CONFLICT ... DO UPDATE), making the process safe to run multiple times:

- **Departments**: UPSERT ON `name`
- **Core Values**: UPSERT ON `slug`
- **Behaviours**: UPSERT ON `(core_value_id, name)`
- **Projects**: UPSERT ON `project_code`
- **Employees**: UPSERT ON `employee_id`
- **Nominations**: UPSERT ON `idempotency_key`

Running the seeding multiple times will:
- Insert new records
- Skip existing records
- Not create duplicates

### UUID Mapping

Mock data uses string IDs (e.g., `amit`, `priya`). The seeding system maps these to deterministic UUIDs:

```typescript
// Mock ID: "amit"
// Maps to UUID: consistent UUID generated from namespace + "employees:amit"
// Same ID always produces same UUID (idempotent across runs)
```

This ensures:
- Consistent UUIDs across multiple seeding runs
- No collisions between tables
- Proper foreign key resolution

### Email Generation

Employee emails are generated from full names:

```
"Amit Deshpande" → "amit.deshpande@touchcoresystems.com"
"Priya Nair" → "priya.nair@touchcoresystems.com"
```

### Manager Relationship Inference

The seeding system infers manager relationships from:
- Job title (contains "Manager" → system role = "manager")
- Department membership (employees in manager's department → manager_id = manager)

### Snapshot Fields

When seeding nominations, the system captures snapshot fields at insertion time:

```sql
snapshot_nominator_dept      -- Nominator's department name at time of nomination
snapshot_nominee_dept        -- Nominee's department name
snapshot_nominee_manager_id  -- Nominee's manager at time of nomination
snapshot_core_value_name     -- Core Value name
snapshot_behaviour_name      -- Behaviour name
snapshot_project_name        -- Project name
```

These fields are immutable and preserve historical accuracy.

### Appreciation Counts

Mock data includes appreciation counts per nomination. The seeding system:

1. Parses the appreciation count from mock feed
2. Generates synthetic appreciation records
3. Randomly selects employees as appreciators
4. Creates nomination_appreciations entries

## Error Handling

The seeding process:

- Collects errors throughout execution
- Logs detailed error messages for debugging
- Continues processing (doesn't stop on first error)
- Reports all errors in final summary
- Returns non-zero exit code if any critical errors occur

## Verification

After seeding completes successfully:

1. **Check record counts** in each table
2. **Verify FK relationships** resolve correctly
3. **Query feed view** to ensure nominations are visible
4. **Test RLS policies** (employee can see only own recognitions)
5. **Check badge calculations** if implemented

Example queries to verify:

```sql
-- Count records per table
SELECT 'departments' as table_name, COUNT(*) FROM departments
UNION ALL
SELECT 'employees', COUNT(*) FROM employees
UNION ALL
SELECT 'nominations', COUNT(*) FROM nominations
UNION ALL
SELECT 'nomination_appreciations', COUNT(*) FROM nomination_appreciations;

-- Verify feed view
SELECT COUNT(*) FROM v_recognition_feed;

-- Check snapshot fields
SELECT snapshot_core_value_name, COUNT(*)
FROM nominations
GROUP BY snapshot_core_value_name;
```

## Troubleshooting

### Missing Supabase credentials

**Error**: `Missing Supabase credentials`

**Solution**: Ensure `.env` file has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`

### Mock data not found

**Error**: `Mock data file not found`

**Solution**: Ensure `src/data/valuespot-mock-data.json` exists

### Database connection failed

**Error**: `Failed to connect to Supabase`

**Solution**: 
- Verify Supabase project URL is correct
- Verify anonymous key is valid
- Check network connectivity
- Verify Supabase project is active

### Foreign key violations

**Error**: `violates foreign key constraint`

**Solution**: 
- Ensure seeders run in correct order (handled by seedService)
- Verify dependencies exist before referencing
- Check that lookups (departments, core_values) returned data

### Duplicate key violations

**Error**: `duplicate key value violates unique constraint`

**Solution**: 
- This is expected behavior when re-running seeding
- The seeder will skip existing records (logged as "Skipped")
- Check logs to see which records were skipped

## Performance

Seeding typically takes **5-10 seconds** depending on:
- Number of mock records
- Database response time
- Network latency

## Next Steps

After successful seeding:

1. **Verify in UI**: Log in to the application and confirm data is visible
2. **Test RLS**: Verify employees can only see appropriate data
3. **Calculate Badges**: Run badge calculation Edge Function if not automatic
4. **Load Test**: Verify performance with seeded data

## Development

To add new seeders:

1. Create new file: `src/data/seeders/newSeeder.ts`
2. Implement seeding function following existing patterns
3. Add to seedService.ts in appropriate dependency order
4. Update this README with new step

Example seeder template:

```typescript
import { SupabaseClient } from '@supabase/supabase-js'
import { logStep, logSuccess, logError, formatCounts } from './utils'

export async function seedNewThing(
  supabase: SupabaseClient,
  mockData: MockData
): Promise<Record<string, number>> {
  logStep('NEW_THING', 'Starting new thing seeding...')

  let inserted = 0
  let updated = 0
  let skipped = 0

  // Implementation...

  const counts = formatCounts(inserted, updated, skipped)
  logSuccess('NEW_THING', 'New thing seeding complete', counts)

  return counts
}
```
