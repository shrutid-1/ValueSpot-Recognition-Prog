---
inclusion: always
---

# Touchcore ValueSpot — Architecture Standards

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| UI Components | shadcn/ui |
| Icons | Lucide React |
| Charts | Recharts |
| Routing | React Router v6 |
| Backend | Supabase (Auth + PostgreSQL + Edge Functions) |
| Forms | React Hook Form + Zod |
| Date handling | date-fns |
| Export | xlsx + file-saver |

## Authorization Architecture

**RLS is the authorization layer. Frontend guards are UX only.**

All data access is controlled by Supabase Row Level Security policies. A correct frontend is one that never requests data the user shouldn't see. A secure backend is one that returns empty results even if asked.

Never rely on frontend route guards as the only protection for sensitive data.

## Supabase Client Rules

```typescript
// CORRECT — only in src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
```

- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in frontend code
- `SUPABASE_SERVICE_ROLE_KEY` NEVER appears in any file under `src/`
- Service role key is only available in Supabase Edge Functions via runtime environment

## Edge Functions

Use Edge Functions for:
1. Badge calculation (after approval)
2. Rate limit checking (before submission)
3. Duplicate detection (before submission)
4. Approval processing (approve/reject/clarify)
5. Notification creation
6. Audit log writes that require service role

All Edge Functions MUST validate the caller's JWT before doing anything.

## State Management

Use React Context for:
- Auth state (user, session, role)
- Notifications (unread count, notification list)

Use component-local state for everything else (forms, UI state, page data).

Do NOT introduce Redux, Zustand, or other state libraries without explicit decision.

## Data Fetching Pattern

```typescript
// Standard pattern for data fetching hooks
const [data, setData] = useState<T[]>([])
const [loading, setLoading] = useState(true)
const [error, setError] = useState<string | null>(null)

useEffect(() => {
  fetchData()
}, [dependencies])
```

For server-filtering: always use Supabase `.filter()`, `.eq()`, `.range()` — never load full tables.

## File Structure Rules

- Components go in `src/components/`
- Page-level components go in `src/pages/`
- Business logic hooks go in `src/hooks/`
- Pure utility functions go in `src/lib/`
- TypeScript types go in `src/types/`
- Never put business logic in presentational components

## Historical Data Pattern

When creating a recognition nomination, ALWAYS snapshot these fields:
- `snapshot_nominator_dept` — nominator's current department name
- `snapshot_nominee_dept` — nominee's current department name  
- `snapshot_nominee_manager_id` — nominee's current manager at time of nomination
- `snapshot_core_value_name` — Core Value name at time of nomination
- `snapshot_behaviour_name` — behaviour name at time of nomination
- `snapshot_scenario_name` — scenario name at time of nomination
- `snapshot_project_name` — project name at time of nomination

These snapshots mean: even if relationships change later, historical recognition remains accurate.
