# Touchcore ValueSpot — Implementation Tasks

## Task Numbering Convention

Tasks are numbered T[Phase]-[Sequence]. Example: T1-01 is Phase 1, Task 1.

Each task has:
- Clear deliverable
- Dependencies
- Acceptance criteria reference
- Estimated complexity (S/M/L/XL)

---

## PHASE 1: Project Foundation

### T1-01: Initialize Vite + React + TypeScript project
**Deliverable:** Working project scaffold at repo root
**Complexity:** S
```
npm create vite@latest . -- --template react-ts
```
**Verify:** `npm run dev` serves at localhost:5173

### T1-02: Configure Tailwind CSS
**Deliverable:** Tailwind working with design system tokens
**Files:** tailwind.config.ts, src/styles/globals.css
**Verify:** Utility classes apply correctly

### T1-03: Install and configure shadcn/ui
**Deliverable:** shadcn/ui components available
**Files:** components.json, src/components/ui/
**Verify:** Button, Input, Card components render

### T1-04: Install core dependencies
**Deliverable:** All production dependencies installed
```
npm install @supabase/supabase-js react-router-dom 
  lucide-react recharts react-hook-form @hookform/resolvers zod
  date-fns xlsx file-saver class-variance-authority clsx tailwind-merge
```

### T1-05: Create design system tokens
**Deliverable:** CSS custom properties + Tailwind config with design system colours
**Files:** tailwind.config.ts (extend), src/styles/globals.css
**Spec:** Design system section in product spec

### T1-06: Configure Supabase client
**Deliverable:** Supabase client singleton with env vars
**Files:** src/lib/supabase.ts
**Security:** Anon key only in VITE_ vars

### T1-07: Configure React Router with role-based routing
**Deliverable:** Route structure with protected routes and role guards
**Files:** src/app/router.tsx, src/components/layout/ProtectedRoute.tsx

### T1-08: Create AuthContext
**Deliverable:** Session management, user profile, role in context
**Files:** src/context/AuthContext.tsx, src/hooks/useAuth.ts

### T1-09: Create app shell layout
**Deliverable:** Sidebar + topbar layout wrapper with role-aware navigation
**Files:** src/components/layout/AppShell.tsx, Sidebar.tsx, TopBar.tsx

### T1-10: Create base UI components
**Deliverable:** Reusable components beyond shadcn/ui defaults
**Files:** EmptyState, SkeletonLoader, PageHeader, ConfirmModal, ErrorBoundary

---

## PHASE 2: Database Setup

### T2-01: Create Supabase project + configure environment
**Deliverable:** Supabase project created, .env file configured
**Files:** .env, .env.example

### T2-02: Create core tables migration
**Deliverable:** departments, employees, projects, project_members tables
**Files:** supabase/migrations/001_core_tables.sql

### T2-03: Create Core Values tables migration
**Deliverable:** core_values, behaviours, scenarios tables
**Files:** supabase/migrations/002_core_values.sql

### T2-04: Create nominations table migration
**Deliverable:** nominations table with all fields, constraints, indexes
**Files:** supabase/migrations/003_nominations.sql

### T2-05: Create badge tables migration
**Deliverable:** badge_definitions, employee_value_badges, badge_history tables
**Files:** supabase/migrations/004_badges.sql

### T2-06: Create supporting tables migration
**Deliverable:** notifications, audit_logs, app_config, rewards, reciprocal_flags tables
**Files:** supabase/migrations/005_supporting.sql

### T2-07: Create database views
**Deliverable:** v_recognition_feed view
**Files:** supabase/migrations/006_views.sql

### T2-08: Create RLS policies
**Deliverable:** All RLS policies from security-model.md applied
**Files:** supabase/migrations/007_rls_policies.sql
**Verify:** Test each policy with wrong-role JWT

### T2-09: Create custom JWT claim function
**Deliverable:** auth hook that adds user_role + employee_id to JWT
**Files:** supabase/migrations/008_auth_hooks.sql

### T2-10: Create badge seed data
**Deliverable:** badge_definitions seeded with B1–B5
**Files:** supabase/seed/001_badge_definitions.sql

### T2-11: Create app_config seed data
**Deliverable:** Default configuration values seeded
**Files:** supabase/seed/002_app_config.sql

### T2-12: Create demo/development seed data
**Deliverable:** 20 employees, 5 departments, 5 projects, 5 Core Values, 20+ behaviours, 30+ scenarios, 50+ nominations with various statuses
**Files:** supabase/seed/003_demo_data.sql
**Note:** Clearly comment as development seed, not production

### T2-13: Generate TypeScript types from Supabase schema
**Deliverable:** src/lib/supabase-types.ts
```
npx supabase gen types typescript --project-id [ID] > src/lib/supabase-types.ts
```

---

## PHASE 3: Authentication

### T3-01: Build login page
**Deliverable:** Login form with email/password, error handling, loading state
**Files:** src/pages/auth/LoginPage.tsx
**AC:** AC-001-01, AC-001-02

### T3-02: Build password reset page
**Deliverable:** Request reset form + confirmation state
**Files:** src/pages/auth/ResetPasswordPage.tsx
**AC:** AC-001-04

### T3-03: Implement logout
**Deliverable:** Logout clears session, redirects to login
**AC:** AC-001-03

### T3-04: Implement session persistence
**Deliverable:** Refresh → still logged in, expired token → redirect to login
**AC:** AC-001-09, AC-001-10

### T3-05: Implement role-based routing
**Deliverable:** Each role redirects to correct dashboard on login
**AC:** AC-001-05 through AC-001-08

---

## PHASE 4: Admin Foundation

### T4-01: Employee list page
**Deliverable:** Paginated employee table with search, filter by department/role, status
**Files:** src/pages/hr/EmployeesPage.tsx
**AC:** AC (FR-009)

### T4-02: Add/Edit employee form
**Deliverable:** Form for creating and editing employees with all fields
**AC:** AC (FR-009)

### T4-03: Employee activate/deactivate
**Deliverable:** Toggle employee active status with confirmation
**AC:** FR-009

### T4-04: Department management
**Deliverable:** Create, edit, view departments
**Files:** src/pages/hr/SettingsPage.tsx (departments tab)

### T4-05: Project management
**Deliverable:** Create, edit, archive projects; manage members
**Files:** src/pages/hr/ProjectsPage.tsx

### T4-06: Manager assignment
**Deliverable:** Assign/change manager for employee with history tracking

### T4-07: Bulk CSV import
**Deliverable:** Upload CSV → parse → preview → import employees
**AC:** FR-009

---

## PHASE 5: Core Values Administration

### T5-01: Core Values list and management
**Deliverable:** List, add, edit, archive, reorder Core Values
**Files:** src/pages/hr/CoreValuesPage.tsx

### T5-02: Behaviours management
**Deliverable:** List, add, edit, archive behaviours per Core Value
**Files:** src/pages/hr/BehavioursPage.tsx

### T5-03: Scenarios management
**Deliverable:** List, add, edit, archive scenarios per behaviour
**Files:** src/pages/hr/ScenariosPage.tsx

---

## PHASE 6: Recognition Wizard

### T6-01: Wizard container with step management
**Deliverable:** 6-step wizard with progress indicator, back/next navigation
**Files:** src/components/recognition/RecognitionWizard.tsx

### T6-02: Step 1 — Employee search
**Deliverable:** Real-time search with debounce, employee cards, self-recognition prevention
**Files:** src/components/recognition/steps/Step1Employee.tsx
**AC:** AC-002-01, AC-002-02, AC-002-03

### T6-03: Step 2 — Core Value selection
**Deliverable:** 5 Core Value cards with icons, colours, hover/selected states
**Files:** src/components/recognition/steps/Step2CoreValue.tsx
**AC:** AC-002-04

### T6-04: Step 3 — Behaviour selection
**Deliverable:** Behaviour list loaded from DB based on selected Core Value
**Files:** src/components/recognition/steps/Step3Behaviour.tsx
**AC:** AC-002-05

### T6-05: Step 4 — Scenario selection
**Deliverable:** Scenario list loaded from DB, "Other" option
**Files:** src/components/recognition/steps/Step4Scenario.tsx
**AC:** AC-002-06

### T6-06: Step 5 — Recognition story
**Deliverable:** "What happened?" and "What was the impact?" fields with validation
**Files:** src/components/recognition/steps/Step5Story.tsx
**AC:** AC-002-07, AC-002-08

### T6-07: Step 6 — Preview and submission
**Deliverable:** Full preview card, submit button with idempotency, success state
**Files:** src/components/recognition/steps/Step6Preview.tsx
**AC:** AC-002-09 through AC-002-13

### T6-08: Rate limiting integration
**Deliverable:** Call check-rate-limits Edge Function before submission
**AC:** AC-002-14

### T6-09: Duplicate detection
**Deliverable:** Check for similar recent recognition, show warning with options
**AC:** AC-009 (duplicate)

### T6-10: Edge Function — check-rate-limits
**Deliverable:** Serverless function that validates daily/monthly limits from app_config
**Files:** supabase/functions/check-rate-limits/index.ts

### T6-11: Edge Function — check-duplicate
**Deliverable:** Detect substantially similar recent recognition
**Files:** supabase/functions/check-duplicate/index.ts

---

## PHASE 7: Approval Workflow

### T7-01: Manager approval queue
**Deliverable:** List of pending nominations assigned to current manager
**Files:** src/pages/manager/PendingApprovalsPage.tsx
**AC:** AC-003-01

### T7-02: Nomination review modal
**Deliverable:** Full nomination detail, 3 action buttons
**AC:** AC-003-02, AC-003-04, AC-003-06

### T7-03: Edge Function — process-approval
**Deliverable:** Handle approve/reject/clarify with all post-approval actions
**Files:** supabase/functions/process-approval/index.ts
**AC:** AC-003-02 through AC-003-11

### T7-04: Clarification response flow
**Deliverable:** Nominator can view and respond to clarification request
**AC:** AC-003-04, AC-003-05

### T7-05: Escalation logic in process-approval
**Deliverable:** Detect and escalate when approver = nominee or approver is invalid
**AC:** AC-003-09, AC-003-10, AC-003-11

---

## PHASE 8: Notifications

### T8-01: Notification center UI
**Deliverable:** Notification dropdown/panel, unread count badge, mark as read
**Files:** src/components/notifications/NotificationCenter.tsx
**AC:** AC-006-07 through AC-006-10

### T8-02: Notification item component
**Deliverable:** Individual notification with icon, type, title, body, timestamp
**Files:** src/components/notifications/NotificationItem.tsx

### T8-03: Edge Function — send-notifications
**Deliverable:** Creates notification records for all notification types
**Files:** supabase/functions/send-notifications/index.ts
**AC:** AC-006-01 through AC-006-06

### T8-04: Realtime notification subscription
**Deliverable:** Live notification updates without polling
**AC:** AC-006 (real-time)

---

## PHASE 9: Recognition Feed & History

### T9-01: Recognition feed page
**Deliverable:** Paginated feed of approved recognitions using v_recognition_feed view
**Files:** src/pages/employee/RecognitionFeedPage.tsx
**AC:** AC-004-01 through AC-004-04

### T9-02: Recognition card component
**Deliverable:** Premium recognition card: nominator, nominee, Core Value, text, appreciation
**Files:** src/components/recognition/RecognitionCard.tsx

### T9-03: Appreciate interaction
**Deliverable:** Toggle appreciate, count update, optimistic UI
**AC:** AC-004-03

### T9-04: My Recognitions page
**Deliverable:** Received tab + Given tab with full history
**Files:** src/pages/employee/MyRecognitionsPage.tsx
**AC:** AC-004-05

### T9-05: Employee Dashboard
**Deliverable:** "Good morning" header, stats, Core Value Journey preview, recent recognitions
**Files:** src/pages/employee/DashboardPage.tsx

---

## PHASE 10: Badge System

### T10-01: Edge Function — calculate-badges
**Deliverable:** Full badge calculation logic using DB thresholds
**Files:** supabase/functions/calculate-badges/index.ts
**AC:** AC-005-01 through AC-005-16

### T10-02: Badge card component
**Deliverable:** Badge display with level, name, icon, accent colour
**Files:** src/components/badges/BadgeCard.tsx

### T10-03: Badge progress component
**Deliverable:** Progress toward next badge with dynamic text
**Files:** src/components/badges/BadgeProgress.tsx
**AC:** AC-012 (badge empty states)

### T10-04: Core Value Journey page
**Deliverable:** 5 Core Value × Badge cards with full progression detail
**Files:** src/pages/employee/CoreValueJourneyPage.tsx
**AC:** AC-005-11

### T10-05: Badge unlock toast
**Deliverable:** Celebration notification when new badge level reached
**Files:** src/components/badges/BadgeUnlockToast.tsx
**AC:** AC-005 (badge unlock)

### T10-06: Badge management in HR Admin
**Deliverable:** View and edit badge threshold definitions
**Files:** src/pages/hr/SettingsPage.tsx (badges tab)
**AC:** AC-005-16

---

## PHASE 11: Analytics

### T11-01: HR Dashboard page
**Deliverable:** Top 6 metrics, all charts and leader tables
**Files:** src/pages/hr/HRDashboardPage.tsx
**AC:** AC-007-01 through AC-007-09

### T11-02: Metric card component
**Deliverable:** Reusable metric card with value, label, trend
**Files:** src/components/analytics/MetricCard.tsx

### T11-03: Core Value distribution chart
**Deliverable:** Bar or donut chart of recognition by Core Value
**Files:** src/components/analytics/CoreValueDistribution.tsx

### T11-04: Recognition trend chart
**Deliverable:** Line chart of monthly recognition count (last 12 months)
**Files:** src/components/analytics/RecognitionTrend.tsx

### T11-05: Daily leaders widget
**Deliverable:** One leader per Core Value for today
**AC:** AC-007-04

### T11-06: Monthly leaders table
**Deliverable:** Core Value × Employee × Count × Unique Recognizers × Badge
**AC:** AC-007-05

### T11-07: Analytics page with quarterly leaders
**Deliverable:** Quarterly leaders with all 4 tie-breaker fields
**Files:** src/pages/hr/AnalyticsPage.tsx
**AC:** AC-007-06, AC-007-07

### T11-08: Annual Core Value leaders
**Deliverable:** Annual leaders per Core Value with tie-breaking
**AC:** AC-007-07

### T11-09: Department analytics
**Deliverable:** Department breakdown with drill-down
**AC:** FR-007 (department)

### T11-10: Project analytics
**Deliverable:** Project breakdown with Core Value breakdown
**AC:** FR-007 (project)

### T11-11: Badge analytics page
**Deliverable:** Badge distribution by Core Value, filters
**Files:** src/pages/hr/BadgeAnalyticsPage.tsx
**AC:** AC-007-09

### T11-12: Manager Dashboard
**Deliverable:** Team stats, pending count, team Core Value distribution
**Files:** src/pages/manager/ManagerDashboardPage.tsx
**AC:** AC-003-01

### T11-13: Team Recognition page
**Deliverable:** Manager view of team's recognition activity
**Files:** src/pages/manager/TeamRecognitionPage.tsx

### T11-14: Team Badges page
**Deliverable:** Manager view of team's badge progression
**Files:** src/pages/manager/TeamBadgesPage.tsx

---

## PHASE 12: Reports

### T12-01: Reports page with type selector
**Deliverable:** Report type selection, period picker, filters
**Files:** src/pages/hr/ReportsPage.tsx
**AC:** AC-008-01 through AC-008-08

### T12-02: Monthly report generation
**Deliverable:** Full monthly report with all sections from spec
**AC:** AC-008-01

### T12-03: Quarterly report generation
**Deliverable:** Quarter-over-quarter report with correct FY dates
**AC:** AC-008-02

### T12-04: Annual report generation
**Deliverable:** Full 17-section annual report
**AC:** AC-008-03

### T12-05: Report filters
**Deliverable:** All filter options applied to report queries
**AC:** AC-008-04

### T12-06: CSV export
**Deliverable:** Working CSV download with real data
**AC:** AC-008-05

### T12-07: XLSX export
**Deliverable:** Working XLSX download with proper formatting
**AC:** AC-008-06

---

## PHASE 13: Rewards

### T13-01: Reward definitions management
**Deliverable:** Create, edit, activate/deactivate reward types
**Files:** src/pages/hr/RewardsPage.tsx

### T13-02: Reward assignment
**Deliverable:** HR can assign rewards to employees linked to nominations

---

## PHASE 14: Audit & Security

### T14-01: Audit log page
**Deliverable:** Paginated, filterable audit log table for HR Admin
**Files:** src/pages/hr/AuditLogsPage.tsx

### T14-02: Complete audit logging
**Deliverable:** All actions from spec section 74 logged to audit_logs

### T14-03: RLS policy audit
**Deliverable:** Test each policy systematically; document results

### T14-04: Privacy review
**Deliverable:** Verify no sensitive data leaks to wrong roles

### T14-05: Data integrity review
**Deliverable:** Verify historical snapshot pattern works across all scenarios

---

## PHASE 15: QA

### T15-01: Authentication flow QA
**Deliverable:** All AC-001 criteria verified

### T15-02: Recognition wizard QA
**Deliverable:** All AC-002 criteria verified

### T15-03: Approval workflow QA
**Deliverable:** All AC-003 criteria verified

### T15-04: Badge system QA
**Deliverable:** All AC-005 criteria verified

### T15-05: Analytics accuracy QA
**Deliverable:** All AC-007 criteria verified — no hard-coded values

### T15-06: Report accuracy QA
**Deliverable:** All AC-008 criteria verified

### T15-07: Security QA
**Deliverable:** All AC-011 criteria verified

### T15-08: UX & accessibility QA
**Deliverable:** All AC-012 criteria verified

### T15-09: Mobile responsiveness QA
**Deliverable:** Recognition wizard and all key flows on mobile

### T15-10: Performance QA
**Deliverable:** Dashboard < 2s, search < 500ms, reports < 5s

### T15-11: Edge case QA
**Deliverable:** All edge cases from user journeys tested

### T15-12: Final product audit
**Deliverable:** No hard-coded data, no console errors, no broken flows
