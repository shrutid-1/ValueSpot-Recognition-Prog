# ValueSpot Mock Data Seeding - Testing & Verification Guide

## Overview

This guide walks through testing the complete seeding implementation, verifying data integrity, and validating the application works with seeded data.

## Pre-Seeding Checklist

Before running seeding, ensure:

- [ ] `.env` file exists with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- [ ] Supabase project is active and accessible
- [ ] All migrations have been applied to Supabase (tables exist)
- [ ] Mock data file exists at `src/data/valuespot-mock-data.json`
- [ ] Node.js and npm are installed
- [ ] Dependencies are installed: `npm install`

## Step 1: Install Dependencies

```bash
npm install
```

This installs:
- `uuid` — UUID generation for deterministic IDs
- `ts-node` — TypeScript runtime for seeding scripts
- `@types/uuid` — Type definitions

## Step 2: Run Seeding

### Option A: Using npm script (Recommended)

```bash
npm run seed
```

### Option B: Using ts-node directly

```bash
npx ts-node src/data/seeders/seed.ts
```

### Expected Output

You should see logs like:

```
✅ Supabase credentials loaded
✅ Mock data loaded: src/data/valuespot-mock-data.json

🌱 Starting seeding process...

[2024-09-01T10:30:45.123Z] DEPARTMENTS: Starting department seeding...
[2024-09-01T10:30:45.234Z] DEPARTMENTS: Inserted Platform
[2024-09-01T10:30:45.345Z] DEPARTMENTS: Inserted Delivery
...
[2024-09-01T10:30:45.890Z] ✅ DEPARTMENTS: Department seeding complete { inserted: 6, updated: 0, skipped: 0 }

[2024-09-01T10:30:46.000Z] CORE_VALUES: Starting core values seeding...
[2024-09-01T10:30:46.111Z] CORE_VALUES: Inserted Adaptable
...

============================================================
SEEDING SUMMARY
============================================================
  departments          │ ✏️  6 inserted, 🔄 0 updated, ⏭️  0 skipped
  core_values          │ ✏️  5 inserted, 🔄 0 updated, ⏭️  0 skipped
  behaviours           │ ✏️  25 inserted, 🔄 0 updated, ⏭️  0 skipped
  scenarios            │ ✏️  25 inserted, 🔄 0 updated, ⏭️  0 skipped
  projects             │ ✏️  3 inserted, 🔄 0 updated, ⏭️  0 skipped
  employees            │ ✏️  9 inserted, 🔄 0 updated, ⏭️  0 skipped
  manager_backfill     │ ✏️  0 inserted, 🔄 3 updated, ⏭️  3 skipped
  project_members      │ ✏️  9 inserted, 🔄 0 updated, ⏭️  0 skipped
  nominations          │ ✏️  16 inserted, 🔄 0 updated, ⏭️  0 skipped
  appreciations        │ ✏️  58 inserted, 🔄 0 updated, ⏭️  0 skipped
  badges               │ ✏️  X inserted, 🔄 Y updated, ⏭️  0 skipped
============================================================
Status: ✅ SUCCESS
Duration: 5234ms
============================================================
```

### If Seeding Fails

Check the error message for:

1. **Missing credentials**:
   ```
   ❌ Missing Supabase credentials
      VITE_SUPABASE_URL: ❌ missing
   ```
   **Solution**: Add credentials to `.env`

2. **Connection error**:
   ```
   ❌ Failed to connect to Supabase: ...
   ```
   **Solution**: Verify Supabase URL and key are correct

3. **FK violations**:
   ```
   ❌ Failed to seed: violates foreign key constraint
   ```
   **Solution**: Ensure migrations have been applied

4. **Duplicate key errors**:
   ```
   Skipped X (constraint violation; already exists)
   ```
   **Expected behavior** — Seeding is idempotent; re-running will skip existing records

## Step 3: Verify Seeded Data

Run the verification script:

```bash
npm run seed:verify
```

### Expected Output

```
🔍 Verifying seeded data...

✅ Departments: 6/6 departments seeded
✅ Core Values: 5/5 core values seeded
✅ Behaviours: 25/25 behaviours seeded
✅ Scenarios: 25/25 scenarios seeded
✅ Projects: 3/3 projects seeded
✅ Employees: 9/9 employees seeded
✅ Project Members: 9/9 project members linked
✅ Nominations: 16/16 nominations seeded
✅ Approved Nominations: 9/9 approved recognitions
✅ Appreciations: 50/58 appreciation reactions
✅ FK Integrity: 16/16 nominations with valid FKs
✅ Recognition Feed View: view returns data
✅ Badge Definitions: 5/5 badge levels defined
✅ App Config: 10/10 system configuration loaded

============================================================
VERIFICATION SUMMARY
============================================================
✅ Passed: 14/14
============================================================

✅ All verifications passed!
```

### If Verification Fails

Check which checks failed:

```
❌ Failed: X/14
Failed checks:
  - Nominations: expected 16, got 10
```

**Common issues**:

1. **Fewer records than expected**: Rerun seeding
2. **FK integrity failures**: Check database logs for constraint violations
3. **View returns no data**: View might not be created; check migrations

## Step 4: Manual Verification Queries

Connect to Supabase SQL editor and run these queries:

### 4.1 Check record counts

```sql
-- Total records per table
SELECT
  'departments' as table_name,
  COUNT(*) as count,
  SUM(CASE WHEN is_active THEN 1 ELSE 0 END) as active
FROM departments
UNION ALL
SELECT 'employees', COUNT(*), SUM(CASE WHEN is_active THEN 1 ELSE 0 END) FROM employees
UNION ALL
SELECT 'projects', COUNT(*), SUM(CASE WHEN is_active THEN 1 ELSE 0 END) FROM projects
UNION ALL
SELECT 'core_values', COUNT(*), SUM(CASE WHEN is_active THEN 1 ELSE 0 END) FROM core_values
UNION ALL
SELECT 'nominations', COUNT(*), SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) FROM nominations
ORDER BY table_name;
```

**Expected output**:
```
departments   | 6  | 6
employees     | 9  | 9
projects      | 3  | 3
core_values   | 5  | 5
nominations   | 16 | 9
```

### 4.2 Check FK integrity

```sql
-- Verify all nominations have valid FKs
SELECT
  COUNT(*) total_nominations,
  COUNT(CASE WHEN nominator_id IS NOT NULL THEN 1 END) with_nominator,
  COUNT(CASE WHEN nominee_id IS NOT NULL THEN 1 END) with_nominee,
  COUNT(CASE WHEN core_value_id IS NOT NULL THEN 1 END) with_core_value
FROM nominations;
```

**Expected**: All counts should be 16

### 4.3 Check employee manager relationships

```sql
-- Check that Platform team has manager
SELECT full_name, role, (SELECT full_name FROM employees m WHERE m.id = e.manager_id) as manager
FROM employees e
WHERE department_id = (SELECT id FROM departments WHERE name = 'Platform')
ORDER BY full_name;
```

**Expected**:
```
Meera Iyer    | manager  | (NULL or self)
Rahul Menon   | employee | Meera Iyer
Vikram Rao    | employee | Meera Iyer
```

### 4.4 Check snapshot fields

```sql
-- Verify snapshot fields are populated
SELECT
  COUNT(*) total,
  COUNT(CASE WHEN snapshot_nominator_dept IS NOT NULL THEN 1 END) with_nominator_dept,
  COUNT(CASE WHEN snapshot_nominee_dept IS NOT NULL THEN 1 END) with_nominee_dept,
  COUNT(CASE WHEN snapshot_core_value_name IS NOT NULL THEN 1 END) with_cv_name
FROM nominations;
```

**Expected**: All should be 16

### 4.5 Check approval statuses

```sql
-- Count by status
SELECT status, COUNT(*) as count
FROM nominations
GROUP BY status
ORDER BY count DESC;
```

**Expected** (approximately):
```
approved               | 9
pending                | 4
clarification_requested| 1
rejected               | 2
```

### 4.6 Check appreciation counts

```sql
-- Total appreciations and per nomination
SELECT
  nomination_id,
  COUNT(*) as appreciation_count,
  STRING_AGG(e.full_name, ', ') as appreciators
FROM nomination_appreciations na
JOIN employees e ON na.employee_id = e.id
GROUP BY nomination_id
ORDER BY appreciation_count DESC
LIMIT 5;
```

### 4.7 View feed

```sql
-- Check recognition feed view
SELECT
  (SELECT full_name FROM employees WHERE id = nominator_id) as from,
  (SELECT full_name FROM employees WHERE id = nominee_id) as to,
  (SELECT name FROM core_values WHERE id = core_value_id) as value,
  what_happened,
  status
FROM v_recognition_feed
LIMIT 5;
```

## Step 5: Test in Application

### 5.1 Start development server

```bash
npm run dev
```

Access the application at `http://localhost:5173`

### 5.2 Employee Feed

**Navigate to**: Dashboard / Feed

**Expected**:
- [ ] Feed displays 6-9 recognitions
- [ ] Each shows: Nominator → Nominee, Core Value, Behaviour
- [ ] Appreciation counts visible
- [ ] Dates display correctly (relative format: "Today", "2 days ago")

**Verify**:
```sql
SELECT COUNT(*) FROM v_recognition_feed;
```

### 5.3 Employee Page

**Navigate to**: HR / Employees

**Expected**:
- [ ] List shows 9 employees
- [ ] Each shows: Name, Role (job title), Department, Status (Active)
- [ ] Can view employee details
- [ ] No 401/403 errors

**Check console** for errors:
```javascript
// Should see no auth errors
console.log(localStorage.getItem('sb-...') // should exist
```

### 5.4 Core Values Page

**Navigate to**: HR / Core Values

**Expected**:
- [ ] All 5 core values listed: Adaptable, Transparent, Collaborative, Innovative, Accountable
- [ ] Each shows icon, color, description
- [ ] Can expand to see behaviours (25 total across all values)

**Check behaviours**:
```sql
SELECT cv.name, COUNT(*) as behaviour_count
FROM behaviours b
JOIN core_values cv ON b.core_value_id = cv.id
GROUP BY cv.name
ORDER BY cv.name;
```

### 5.5 Projects Page

**Navigate to**: HR / Projects

**Expected**:
- [ ] List shows 3 projects: ABC Client, Helix Portal, Nova Reporting
- [ ] Each shows project code and description
- [ ] Can view project members (9 total linked)

### 5.6 Manager Dashboard (if available)

**Log in as**: meera@touchcore.in (if created)

**Navigate to**: Manager Dashboard

**Expected**:
- [ ] Shows pending approvals (1-2 pending nominations)
- [ ] Shows team members (Rahul, Vikram)
- [ ] Shows team recognition metrics

### 5.7 Test RLS Policies

**Employee Account** (e.g., amit@touchcore.in):

```javascript
// In browser console:
const { data, error } = await supabase
  .from('employees')
  .select('*')
  .eq('is_active', false);

// Should return only own record (active employee cannot see inactive)
console.log('Got', data?.length, 'records - expected 0 or 1');
```

**Expected**: 0 rows (or only own record if employee is inactive)

### 5.8 Test Notification Flow

**Scenario**: Approve a pending nomination

**Expected**:
- [ ] Notification appears in notification center
- [ ] Status updates from "Pending" to "Approved"
- [ ] Badge progress updates if applicable

## Step 6: Badge Calculations

### If Edge Function is deployed:

The badge calculation should run automatically after seeding.

**Check badge_definitions**:
```sql
SELECT level, name, minimum_count, maximum_count
FROM badge_definitions
ORDER BY level;
```

**Check employee badges**:
```sql
SELECT
  e.full_name,
  cv.name as core_value,
  evb.recognition_count,
  bd.name as badge
FROM employee_value_badges evb
JOIN employees e ON evb.employee_id = e.id
JOIN core_values cv ON evb.core_value_id = cv.id
LEFT JOIN badge_definitions bd ON evb.badge_level = bd.level
WHERE recognition_count > 0
ORDER BY e.full_name, cv.name;
```

**Expected**:
- Employees with recognitions should have badges calculated
- Badge level should match thresholds (e.g., 16+ = B5 Value Ambassador)

### Manual Badge Calculation (if Edge Function not deployed):

Call the calculate-badges Edge Function manually:

```bash
# Using curl (get auth token first)
SUPABASE_URL="https://your-project.supabase.co"
ANON_KEY="your-anon-key"

curl -X POST ${SUPABASE_URL}/functions/v1/calculate-badges \
  -H "Authorization: Bearer ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

**Expected response**:
```json
{
  "success": true,
  "processed": 12,
  "badges_created": 8,
  "badges_updated": 2,
  "history_created": 8
}
```

## Step 7: Re-Run Seeding (Idempotency Test)

Verify seeding is safe to run multiple times:

```bash
npm run seed
```

**Expected**:
- All records marked as "Skipped" (no duplicates created)
- No errors
- Database state unchanged

**Verify**:
```bash
npm run seed:verify
```

Should still show all records present.

## Step 8: Troubleshooting

### Issue: Seeding completes but no data visible in UI

**Check**:
1. Are you logged in as the correct user?
2. Run verification script: `npm run seed:verify`
3. Check browser console for JS errors
4. Check Network tab for API errors (401/403)

**Solution**:
- Verify RLS policies are correct
- Check employee auth_user_id is set (if needed for auth)

### Issue: FK constraint violations during seeding

**Check**:
1. Are all migrations applied?
2. Run: `npm run seed:verify`

**Solution**:
- Ensure migrations 001-005 have been applied
- Check Supabase migration logs
- May need to reapply migrations

### Issue: Badge calculation fails

**Check**:
1. Does Edge Function exist: `supabase/functions/calculate-badges/index.ts`
2. Check Edge Function logs in Supabase console

**Solution**:
- Deploy Edge Function: `supabase functions deploy calculate-badges`
- Or manually run via API (see Step 6)

### Issue: Appreciation counts don't match

**Check**:
```sql
SELECT
  COUNT(DISTINCT nomination_id) as nominations_with_appreciations,
  COUNT(*) as total_appreciations
FROM nomination_appreciations;
```

**Note**: Appreciation counts are synthetic (randomly generated), so exact counts may vary slightly.

## Performance Benchmarks

Expected seeding duration:

| Phase | Time |
|---|---|
| Departments | 100ms |
| Core Values | 200ms |
| Behaviours | 300ms |
| Scenarios | 300ms |
| Projects | 100ms |
| Employees | 400ms |
| Manager Backfill | 200ms |
| Project Members | 300ms |
| Nominations | 1500ms |
| Appreciations | 1500ms |
| Badge Calculation | 500ms (if EF deployed) |
| **Total** | **~5-6 seconds** |

## Database State After Seeding

**Total records**:
- 6 departments
- 9 employees
- 5 core values
- 25 behaviours
- 25 scenarios
- 3 projects
- 9 project members
- 16 nominations (9 approved, 4 pending, 1 clarification, 2 rejected)
- ~58 appreciations
- 0-9 employee value badges (depends on badge calculation)

**Employee Recognition Distribution** (approximate):

| Employee | Received | Given | Most Recognized Value |
|---|---|---|---|
| Amit | 2 | 1 | Collaborative |
| Priya | 3 | 2 | Collaborative |
| Rahul | 2 | 1 | Accountable |
| Shruti | 3 | 5 | Accountable |
| Farhan | 2 | 1 | Innovative |
| Meera | 1 | 1 | Transparent |
| Vikram | 2 | 1 | Transparent |
| Ananya | 1 | 1 | Collaborative |
| Kiran | 1 | 1 | Adaptable |

## Success Criteria

Seeding is successful when:

- ✅ `npm run seed` completes with status "✅ SUCCESS"
- ✅ `npm run seed:verify` shows all tests "✅ PASS"
- ✅ Feed displays recognitions in UI
- ✅ Employees page shows all 9 employees
- ✅ Core Values page shows all 5 values with behaviours
- ✅ RLS policies allow employees to see only appropriate data
- ✅ No console errors in browser
- ✅ Seeding can be re-run without creating duplicates

## Next Steps

After successful verification:

1. **Commit seeding code**: `git add . && git commit -m "Add mock data seeding system"`
2. **Document in team wiki**: Link to `src/data/seeders/README.md`
3. **Set up CI/CD** (optional): Auto-seed on deployment to staging
4. **Backup seeded state** (optional): Export to SQL for reference

## Support

For issues or questions:

1. Check **src/data/seeders/README.md** for common issues
2. Review **SEEDING_IMPLEMENTATION_SUMMARY.md** for architecture
3. Check Supabase logs for database-level errors
4. Review seeding script output for detailed error messages
