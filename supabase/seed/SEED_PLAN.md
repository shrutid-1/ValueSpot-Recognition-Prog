# ValueSpot Mock Data Seeding Plan

## Overview

Seed ValueSpot database with mock data from `src/data/valuespot-mock-data.json` using a TypeScript seeding service.

## Architecture

```
src/
  └── data/
      └── seeders/
          ├── seedService.ts          # Main seeding orchestration
          ├── departmentSeeder.ts     # Department logic
          ├── coreValueSeeder.ts      # Core values, behaviours, scenarios
          ├── projectSeeder.ts        # Projects logic
          ├── employeeSeeder.ts       # Employees with UUID mapping
          ├── nominationSeeder.ts     # Nominations & appreciations
          └── utils.ts                # Helpers (UUID maps, IDL generation, etc.)
```

## Seeding Sequence (Dependency Order)

1. **Departments** ← No dependencies
2. **Core Values** ← No dependencies
3. **Behaviours** ← Depends on Core Values
4. **Scenarios** ← Depends on Behaviours, Core Values
5. **Projects** ← No dependencies
6. **Employees** ← Depends on Departments (backfill manager_id later)
7. **Backfill Manager Relationships** ← Depends on Employees
8. **Project Members** ← Depends on Projects, Employees
9. **Nominations** ← Depends on Employees, Core Values, Behaviours, Scenarios, Projects
10. **Nomination Appreciations** ← Depends on Nominations, Employees
11. **Employee Value Badges** ← Calculate post-nomination (via Edge Function or query)
12. **Badge History** ← Calculate post-nomination (via Edge Function or query)

## Idempotency Strategy

All seeders use **upsert logic** (INSERT ON CONFLICT ... DO UPDATE) to make seeding safe to run multiple times:

- **Departments**: `UPSERT ON name`
- **Core Values**: `UPSERT ON slug`
- **Behaviours**: `UPSERT ON (core_value_id, name)`
- **Projects**: `UPSERT ON project_code`
- **Employees**: `UPSERT ON employee_id`
- **Nominations**: `UPSERT ON idempotency_key` (deterministic generation from mock ID)

## UUID Mapping

Mock data uses **string IDs** (e.g., `amit`, `priya`). Database uses **UUIDs**.

**Strategy**:
- Generate deterministic UUIDs using v5 namespace:
  - Namespace: `550e8400-e29b-41d4-a716-446655440000` (ValueSpot namespace)
  - Name: `{table}:{mock_id}` (e.g., `employees:amit`)
  
- This ensures:
  - Same mock ID always generates same UUID (idempotent across runs)
  - No collisions between tables
  - UUIDs are consistent and reproducible

**Implementation**:
```typescript
const uuidv5 = require('uuid').v5;
const VALUESPOT_NAMESPACE = '550e8400-e29b-41d4-a716-446655440000';

export function generateDeterministicUUID(mockId: string, table: string): string {
  return uuidv5(`${table}:${mockId}`, VALUESPOT_NAMESPACE);
}
```

## Error Handling & Logging

- Log each seeder step with counts (inserted, updated, skipped)
- Collect errors and report at end
- Rollback entire transaction if critical error occurs
- Provide detailed error messages for debugging

## Post-Seeding Steps

1. **Verify Counts**: Show before/after record counts
2. **Validate Relationships**: Query key FKs to ensure referential integrity
3. **Calculate Badges**: Trigger badge calculation (Edge Function or manual query)
4. **Test RLS**: Verify employees can only see appropriate data

## Files to Create

- `src/data/seeders/seedService.ts` — Main orchestration
- `src/data/seeders/departmentSeeder.ts` — Department seeding
- `src/data/seeders/coreValueSeeder.ts` — Core values & behaviours & scenarios
- `src/data/seeders/projectSeeder.ts` — Project seeding
- `src/data/seeders/employeeSeeder.ts` — Employee seeding
- `src/data/seeders/nominationSeeder.ts` — Nominations & appreciations
- `src/data/seeders/utils.ts` — Utility functions
- `src/data/seeders/seed.ts` — CLI entry point
- `src/data/seeders/README.md` — Instructions

## Running the Seeding

```bash
# Run seeding (requires .env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY)
npx ts-node src/data/seeders/seed.ts

# Or via npm script:
npm run seed:dev
```

## Safety & Reversibility

- **Soft deletes**: All deletions use soft delete patterns (is_active, archived_at)
- **No hard deletes**: Preserved existing data; only add/update
- **Transaction rollback**: Rollback entire seed if critical errors
- **Upsert logic**: Safe to run multiple times without duplicates

## Verification Steps

After seeding completes:

1. Check record counts in each table
2. Verify FK relationships resolve
3. Query feed view to ensure nominations visible
4. Test RLS policies (employee can see own recognitions)
5. Verify badges calculated correctly
