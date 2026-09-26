---
inclusion: always
---

# Touchcore ValueSpot — Security Requirements

## Non-Negotiable Security Rules

These rules MUST be followed in every code change. There are no exceptions.

### 1. No service role key in frontend

The string `SUPABASE_SERVICE_ROLE_KEY` must never appear in any file under `src/`.

If you need to perform an operation that requires bypassing RLS, it belongs in a Supabase Edge Function.

### 2. RLS on every table

Every table must have `ROW LEVEL SECURITY` enabled. Check each migration.

### 3. Authorization is database-enforced

Frontend route guards (`<ProtectedRoute role="hr_admin">`) are UX convenience only. The Supabase RLS policies are the real authorization layer.

Test authorization by calling the Supabase API directly with a lower-privilege JWT. If data returns, the RLS policy is wrong.

### 4. Employees cannot see rejected nomination details

An employee who submitted a nomination that was rejected:
- CAN see that it was rejected (status)
- CANNOT see the rejection reason
- CANNOT see any manager notes

An employee who was nominated and the nomination was rejected:
- Cannot see the nomination at all
- Cannot see the rejection or that it happened

### 5. HR-only data never leaks to employees

The following must NEVER be accessible to employee or manager roles:
- `audit_logs` table
- `reciprocal_recognition_flags` table
- `app_config` table (write access)
- Rejection reasons on other employees' nominations
- HR dashboard analytics endpoints

### 6. Input validation at every layer

- Frontend: React Hook Form + Zod schema validation
- API: Edge Functions validate all inputs before processing
- Database: CHECK constraints enforce valid values

Never trust frontend validation alone. Always validate on the server/database.

### 7. Idempotency for submissions

Every nomination submission must include an `idempotency_key` (UUID generated client-side before submission). The `nominations` table has a UNIQUE constraint on this field. This prevents double-submission from double-click or network retry.

### 8. Self-nomination prevention at database level

```sql
CONSTRAINT no_self_nomination CHECK (nominator_id != nominee_id)
```

This is enforced in the database, not just the frontend.

### 9. Audit everything significant

The following actions MUST be written to `audit_logs`:
- User login
- Nomination created, submitted, approved, rejected, clarified
- Employee created, edited, activated, deactivated
- Role change
- Manager assignment change
- Core Value created, edited, archived
- Behaviour created, edited, archived
- Badge threshold changed
- Report generated
- App config changed

### 10. JWT claims, not DB lookups in RLS

Role checking in RLS policies uses JWT claims (set by the custom access token hook), not subqueries to the employees table. This prevents RLS bypass via privilege escalation.

```sql
-- Correct
auth.user_role() = 'hr_admin'

-- Avoid in hot paths
EXISTS (SELECT 1 FROM employees WHERE auth_user_id = auth.uid() AND role = 'hr_admin')
```

## Edge Function Security Checklist

For every Edge Function:

- [ ] Validate Authorization header is present
- [ ] Validate JWT is valid
- [ ] Extract role from JWT claims
- [ ] Verify caller has permission for this operation
- [ ] Validate all input parameters
- [ ] Use service role client only for operations that require it
- [ ] Write audit log for significant actions
- [ ] Return appropriate HTTP status codes (401, 403, 400, 200)
- [ ] Never return internal error messages to clients

## Environment Variables

```
# .env (gitignored)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# .env.example (committed, no real values)
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

`.env` is always in `.gitignore`. Never commit real credentials.
