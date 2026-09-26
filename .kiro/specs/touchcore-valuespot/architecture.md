# Touchcore ValueSpot — Technical Architecture

## Architecture Overview

```
Browser (React + TypeScript + Vite)
            │
            ▼
    Tailwind CSS + shadcn/ui
    (Presentational Layer)
            │
            ▼
    React Context / Hooks
    (Application State Layer)
            │
            ▼
    Supabase JS Client
    (Data Access Layer)
            │
    ┌───────┼──────────────┐
    ▼       ▼              ▼
  Auth  PostgreSQL       Storage
          (RLS)         (Avatars)
            │
    ┌───────┼──────────────┐
    ▼       ▼              ▼
  RLS   Functions      Realtime
 Policies (Edge)    (Notifications)
            │
    ┌───────┼──────────────┐
    ▼       ▼              ▼
  Badge  Reports      Audit Log
  Calc   Engine       Triggers
```

---

## Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend Framework | React 18 + TypeScript | Type safety, component model |
| Build Tool | Vite | Fast dev server, modern ESM |
| Styling | Tailwind CSS | Utility-first, design system control |
| UI Components | shadcn/ui | Accessible, unstyled base components |
| Icons | Lucide React | Consistent, MIT licensed |
| Charts | Recharts | React-native, composable |
| Routing | React Router v6 | Industry standard, lazy loading |
| Backend | Supabase | Auth + PostgreSQL + RLS + Edge Functions |
| Database | PostgreSQL (via Supabase) | Relational, ACID, powerful analytics |
| Authentication | Supabase Auth | JWT, session management, SSO ready |
| Authorization | Supabase RLS | Row-level security enforced at DB layer |
| Business Logic | Supabase Edge Functions (Deno) | Badge calc, notifications, report triggers |
| State | React Context + useReducer | No over-engineering for MVP |
| Forms | React Hook Form + Zod | Type-safe validation |
| Export | xlsx + file-saver | CSV and XLSX generation |
| Date Handling | date-fns | Lightweight, tree-shakeable |

---

## Project Structure

```
src/
├── app/
│   ├── App.tsx                    # Root application
│   ├── router.tsx                 # Route definitions
│   └── providers.tsx              # Context providers
│
├── components/
│   ├── ui/                        # shadcn/ui components (do not edit)
│   ├── layout/
│   │   ├── AppShell.tsx           # Sidebar + topbar wrapper
│   │   ├── Sidebar.tsx            # Role-aware navigation
│   │   ├── TopBar.tsx             # Search, notifications, profile
│   │   └── PageHeader.tsx         # Consistent page headers
│   ├── recognition/
│   │   ├── RecognitionWizard.tsx  # 6-step wizard container
│   │   ├── RecognitionCard.tsx    # Feed card
│   │   ├── RecognitionPreview.tsx # Step 6 preview
│   │   └── steps/                 # Step 1-6 components
│   ├── badges/
│   │   ├── BadgeCard.tsx
│   │   ├── BadgeProgress.tsx
│   │   └── BadgeUnlockToast.tsx
│   ├── analytics/
│   │   ├── ChartCard.tsx
│   │   ├── MetricCard.tsx
│   │   ├── LeaderCard.tsx
│   │   └── CoreValueDistribution.tsx
│   ├── notifications/
│   │   ├── NotificationCenter.tsx
│   │   └── NotificationItem.tsx
│   └── shared/
│       ├── EmployeeAvatar.tsx
│       ├── CoreValueBadge.tsx
│       ├── EmptyState.tsx
│       ├── SkeletonLoader.tsx
│       ├── ConfirmModal.tsx
│       └── ErrorBoundary.tsx
│
├── pages/
│   ├── auth/
│   │   ├── LoginPage.tsx
│   │   └── ResetPasswordPage.tsx
│   ├── employee/
│   │   ├── DashboardPage.tsx
│   │   ├── GiveRecognitionPage.tsx
│   │   ├── RecognitionFeedPage.tsx
│   │   ├── MyRecognitionsPage.tsx
│   │   ├── CoreValueJourneyPage.tsx
│   │   └── ProfilePage.tsx
│   ├── manager/
│   │   ├── ManagerDashboardPage.tsx
│   │   ├── PendingApprovalsPage.tsx
│   │   ├── TeamRecognitionPage.tsx
│   │   └── TeamBadgesPage.tsx
│   ├── hr/
│   │   ├── HRDashboardPage.tsx
│   │   ├── AnalyticsPage.tsx
│   │   ├── BadgeAnalyticsPage.tsx
│   │   ├── ReportsPage.tsx
│   │   ├── EmployeesPage.tsx
│   │   ├── ProjectsPage.tsx
│   │   ├── CoreValuesPage.tsx
│   │   ├── BehavioursPage.tsx
│   │   ├── ScenariosPage.tsx
│   │   ├── RewardsPage.tsx
│   │   ├── AuditLogsPage.tsx
│   │   └── SettingsPage.tsx
│   └── admin/
│       └── SystemAdminPage.tsx
│
├── hooks/
│   ├── useAuth.ts                 # Auth context + user
│   ├── useRecognition.ts          # Recognition operations
│   ├── useBadges.ts               # Badge data
│   ├── useNotifications.ts        # Notification state
│   ├── useAnalytics.ts            # Analytics queries
│   └── useDebounce.ts             # Search debounce
│
├── lib/
│   ├── supabase.ts                # Supabase client (public anon key only)
│   ├── supabase-types.ts          # Generated DB types
│   ├── constants.ts               # App constants (no hard-coded data)
│   ├── utils.ts                   # Shared utilities
│   ├── date-utils.ts              # IST formatting, period calculations
│   ├── badge-utils.ts             # Badge display helpers (NO threshold logic)
│   └── export-utils.ts            # CSV/XLSX generation
│
├── context/
│   ├── AuthContext.tsx            # User session + role
│   └── NotificationContext.tsx    # Notification state
│
├── types/
│   ├── index.ts                   # Shared TypeScript types
│   ├── recognition.ts             # Recognition-specific types
│   ├── badge.ts                   # Badge types
│   └── analytics.ts               # Analytics types
│
└── styles/
    ├── globals.css                # Tailwind base + custom CSS vars
    └── design-tokens.css          # Design system tokens
```

---

## Key Architectural Decisions

### Decision 1: No Hard-Coded Business Logic in Frontend
All thresholds, badge levels, financial year config, and rate limits are fetched from the database. The frontend renders what the database provides.

### Decision 2: RLS is the Authorization Layer
Frontend route guards are UX convenience only. All data access is controlled by Supabase RLS policies. A user cannot access data they are not authorized to see, regardless of what the frontend does.

### Decision 3: Badge Calculation in Edge Function
Badge calculation runs as a Supabase Edge Function triggered after each recognition approval. This ensures:
- Calculation uses current DB-driven thresholds
- No race conditions from concurrent approvals
- Audit trail for badge changes

### Decision 4: Historical Snapshot Pattern
When a recognition is created, snapshot the following at that moment:
- nominee's department
- nominee's manager
- nominee's project assignments
- nominator's department
The recognition record carries this context permanently, so it remains accurate even if the employee's relationships change later.

### Decision 5: Realtime for Notifications
Use Supabase Realtime to push notification state changes to connected clients. No polling.

### Decision 6: Separation of Badge Period from Financial Year
- **Annual badge period**: Calendar year (Jan–Dec) by default, configurable
- **Financial year quarters**: Q1=Apr, Q2=Jul, Q3=Oct, Q4=Jan, configurable
These are independently tracked in the database.

### Decision 7: Recognition Source Classification
Automatically determine recognition source type at submission:
- Peer: nominator is same level as nominee
- Manager: nominator is nominee's manager or has manager role
- HR: nominator has HR Admin role
- Leadership: nominator is in leadership tier (configurable)

---

## Supabase Edge Functions

| Function | Trigger | Purpose |
|---|---|---|
| `process-approval` | HTTP (from frontend) | Handle approve/reject/clarify |
| `calculate-badges` | DB trigger after approval | Recalculate badges for nominee |
| `send-notifications` | DB trigger | Create notification records |
| `check-rate-limits` | HTTP (pre-submit) | Validate submission is within limits |
| `check-duplicate` | HTTP (pre-submit) | Warn about similar recent recognition |
| `generate-report` | HTTP | Build report data for large queries |

---

## Authentication Flow

```
User submits login
      ↓
Supabase Auth validates credentials
      ↓
Returns JWT + session
      ↓
Frontend stores session (Supabase handles)
      ↓
AuthContext reads user + fetches employee profile
      ↓
Employee profile contains role
      ↓
Router renders role-appropriate layout
      ↓
RLS policies enforce data access per role
```

---

## Recognition Submission Flow

```
Employee completes wizard (6 steps)
      ↓
Frontend validates (Zod schema)
      ↓
Call check-rate-limits Edge Function
      ↓
Call check-duplicate Edge Function
      ↓
If OK: INSERT into nominations table
      ↓
DB trigger fires → create notification for manager
      ↓
Nomination status = 'pending'
      ↓
Manager sees it in approval queue
```

---

## Approval Flow

```
Manager reviews nomination
      ↓
Calls process-approval Edge Function
      ↓
Function validates manager is authorized approver
      ↓
  Approve → status = 'approved'
           → INSERT recognition_feed record
           → CALL calculate-badges
           → CREATE notifications (nominee, nominator, team)
           → WRITE audit log
           → Realtime push
  
  Reject → status = 'rejected', reason stored
          → CREATE notification (nominator)
          → WRITE audit log
  
  Clarify → status = 'clarification_requested'
           → CREATE notification (nominator)
           → WRITE audit log
```

---

## Badge Calculation Logic

```
calculate-badges(employee_id, core_value_id, period):
  1. Fetch badge thresholds from badge_definitions table
  2. Count approved recognitions for employee × core_value × period
  3. Determine badge level from count against thresholds
  4. Read current badge from employee_value_badges
  5. If new_level > current_level:
       UPDATE employee_value_badges
       INSERT badge_history record
       CREATE badge unlock notification
  6. If no badge exists and count >= 1:
       INSERT employee_value_badges
       INSERT badge_history record
       CREATE badge unlock notification
  7. Never downgrade badge within same period
```

---

## Escalation Logic for Approvals

```
nomination.nominee → find direct_manager
  if direct_manager == nominee → escalate
  if direct_manager is inactive → escalate
  if direct_manager is missing → escalate

escalation_chain:
  1. direct_manager (if valid)
  2. next_level_manager (manager's manager)
  3. HR fallback (configurable HR Admin user)

Special cases:
  - Nominee IS their own manager: skip to next level
  - Nominator IS the approver: route to HR fallback
  - HR Admin nominated: route to Super Admin or peer HR
  - CEO nominated: route to HR Admin
```

---

## Environment Variables

```
# .env (never commit)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# .env.example (committed, no secrets)
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

**NEVER** include `SUPABASE_SERVICE_ROLE_KEY` in frontend code. Service role key is only used in Edge Functions via the Supabase runtime environment.

---

## Deployment Architecture

- Frontend: Vercel (React/Vite static deployment)
- Backend: Supabase (managed PostgreSQL + Auth + Edge Functions)
- No custom Node.js server required
- Environment variables configured in Vercel dashboard

---

## Performance Patterns

- Paginate all list views server-side (never load full tables into browser)
- Debounce employee search (300ms)
- Use Supabase `.range()` for pagination
- Use database indexes on frequently queried columns
- Cache badge data in component state with TTL
- Lazy-load report and analytics pages
- Use React.Suspense + skeleton loaders for perceived performance
