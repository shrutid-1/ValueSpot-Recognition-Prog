import { lazy } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { PortalShell } from '@/components/layout/PortalShell'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { ROUTES } from '@/lib/constants'
import { RoleRedirect, PublicOnlyRoute, Lazy, ByPortal } from '@/app/routeElements'

/*
  Login stays eager: it is the first thing an unauthenticated visitor sees, and
  the second factor runs inside it, so a chunk fetch on that path would be felt.

  Signup and password reset are lazy. They are entered deliberately — from an
  invitation link or a "forgot password" click — and never render for a
  signed-in user, which is nearly every session. Loading them eagerly put them
  in the entry chunk for everybody.
*/
import LoginPage from '@/pages/auth/LoginPage'
const SignUpPage = lazy(() => import('@/pages/auth/SignUpPage'))
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage'))

// Lazy-loaded page components
const DashboardPage       = lazy(() => import('@/pages/employee/DashboardPage'))
const GiveRecognitionPage = lazy(() => import('@/pages/employee/GiveRecognitionPage'))
const RecognitionFeedPage = lazy(() => import('@/pages/employee/RecognitionFeedPage'))
/*
  The same feed, drawn in the administrative system. Chosen by role at the
  route below — see ByPortal. The Employee page above is unchanged.
*/
const AdminRecognitionFeedPage = lazy(() => import('@/pages/admin/AdminRecognitionFeedPage'))
const MyRecognitionsPage  = lazy(() => import('@/pages/employee/MyRecognitionsPage'))
const CoreValueJourneyPage = lazy(() => import('@/pages/employee/CoreValueJourneyPage'))
const ProfilePage         = lazy(() => import('@/pages/employee/ProfilePage'))
const WalletPage          = lazy(() => import('@/pages/employee/WalletPage'))
const ValueCoinsPage      = lazy(() => import('@/pages/hr/ValueCoinsPage'))
const ValueStorePage      = lazy(() => import('@/pages/employee/ValueStorePage'))

const ManagerDashboardPage  = lazy(() => import('@/pages/manager/ManagerDashboardPage'))
const PendingApprovalsPage   = lazy(() => import('@/pages/manager/PendingApprovalsPage'))
const TeamRecognitionPage    = lazy(() => import('@/pages/manager/TeamRecognitionPage'))
const TeamBadgesPage         = lazy(() => import('@/pages/manager/TeamBadgesPage'))
const ManagedProjectsPage    = lazy(() => import('@/pages/manager/ManagedProjectsPage'))

const HRDashboardPage    = lazy(() => import('@/pages/hr/HRDashboardPage'))
const AnalyticsPage      = lazy(() => import('@/pages/hr/AnalyticsPage'))
const BadgeAnalyticsPage = lazy(() => import('@/pages/hr/BadgeAnalyticsPage'))
const ReportsPage        = lazy(() => import('@/pages/hr/ReportsPage'))
const EmployeesPage      = lazy(() => import('@/pages/hr/EmployeesPage'))
const SupportPage        = lazy(() => import('@/pages/employee/SupportPage'))
const SupportRequestsPage = lazy(() => import('@/pages/hr/SupportRequestsPage'))
const DepartmentsPage    = lazy(() => import('@/pages/hr/DepartmentsPage'))
const ProjectsPage       = lazy(() => import('@/pages/hr/ProjectsPage'))
const CoreValuesPage     = lazy(() => import('@/pages/hr/CoreValuesPage'))
const BehavioursPage     = lazy(() => import('@/pages/hr/BehavioursPage'))
const ScenariosPage      = lazy(() => import('@/pages/hr/ScenariosPage'))
const RewardsPage        = lazy(() => import('@/pages/hr/RewardsPage'))
const AuditLogsPage      = lazy(() => import('@/pages/hr/AuditLogsPage'))
const SettingsPage       = lazy(() => import('@/pages/hr/SettingsPage'))
const AdministrationPage = lazy(() => import('@/pages/hr/AdministrationPage'))

export const router = createBrowserRouter([
  // Auth routes.
  //
  // Six entry points, two components. `portal` fixes the copy and the portal a
  // successful sign-in is checked against — it grants nothing. The database
  // decides every role: an invited record's role wins, and anything else is an
  // Employee. Typing a URL is not a way to become a Manager.
  //
  // These four must stay ABOVE the '/' entry below. They live under /manager
  // and /hr, which are otherwise protected app paths; no child of '/' claims
  // these exact paths, so top-level registration resolves them first.
  { path: ROUTES.LOGIN,  element: <PublicOnlyRoute><LoginPage /></PublicOnlyRoute> },
  { path: ROUTES.SIGNUP, element: <PublicOnlyRoute><Lazy><SignUpPage portal="employee" /></Lazy></PublicOnlyRoute> },

  { path: ROUTES.MANAGER_LOGIN, element: <PublicOnlyRoute><LoginPage portal="manager" /></PublicOnlyRoute> },
  { path: ROUTES.MANAGER_SETUP, element: <PublicOnlyRoute><Lazy><SignUpPage portal="manager" /></Lazy></PublicOnlyRoute> },
  { path: ROUTES.HR_LOGIN,      element: <PublicOnlyRoute><LoginPage portal="hr_admin" /></PublicOnlyRoute> },
  { path: ROUTES.HR_SETUP,      element: <PublicOnlyRoute><Lazy><SignUpPage portal="hr_admin" /></Lazy></PublicOnlyRoute> },
  // Reset password is deliberately NOT PublicOnly: the recovery link creates a
  // session, so the user IS authenticated when they arrive to set a password.
  { path: ROUTES.RESET_PASSWORD, element: <Lazy><ResetPasswordPage /></Lazy> },

  // App shell wrapping all protected routes
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <PortalShell />
      </ProtectedRoute>
    ),
    children: [
      // Role-aware default redirect
      { index: true, element: <RoleRedirect /> },

      // Employee routes
      { path: ROUTES.DASHBOARD,         element: <Lazy><DashboardPage /></Lazy> },
      { path: ROUTES.GIVE_RECOGNITION,  element: <Lazy><GiveRecognitionPage /></Lazy> },
      {
        path: ROUTES.RECOGNITION_FEED,
        element: (
          <Lazy>
            <ByPortal
              employee={<RecognitionFeedPage />}
              admin={<AdminRecognitionFeedPage />}
            />
          </Lazy>
        ),
      },
      { path: ROUTES.MY_RECOGNITIONS,   element: <Lazy><MyRecognitionsPage /></Lazy> },
      { path: ROUTES.CORE_VALUE_JOURNEY, element: <Lazy><CoreValueJourneyPage /></Lazy> },
      { path: ROUTES.PROFILE,           element: <Lazy><ProfilePage /></Lazy> },
      { path: ROUTES.WALLET,            element: <Lazy><WalletPage /></Lazy> },
      { path: ROUTES.VALUE_STORE,       element: <Lazy><ValueStorePage /></Lazy> },
      /*
        Support is a personal route: anyone signed in may ask for a
        correction. Which recognitions they may ask about is decided by
        create_support_request(), which checks participation against the
        nomination row — not by this guard.
      */
      { path: ROUTES.SUPPORT,           element: <Lazy><SupportPage /></Lazy> },

      // Manager routes
      {
        path: ROUTES.MANAGER_DASHBOARD,
        element: (
          <ProtectedRoute requiredRole={['manager', 'hr_admin', 'super_admin']}>
            <Lazy><ManagerDashboardPage /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.PENDING_APPROVALS,
        element: (
          <ProtectedRoute requiredRole={['manager', 'hr_admin', 'super_admin']}>
            <Lazy><PendingApprovalsPage /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.TEAM_RECOGNITION,
        element: (
          <ProtectedRoute requiredRole={['manager', 'hr_admin', 'super_admin']}>
            <Lazy><TeamRecognitionPage /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.TEAM_BADGES,
        element: (
          <ProtectedRoute requiredRole={['manager', 'hr_admin', 'super_admin']}>
            <Lazy><TeamBadgesPage /></Lazy>
          </ProtectedRoute>
        ),
      },
      /*
        Manager only, unlike its siblings above. guard_project_manager (029)
        refuses any Project Manager who does not hold the Manager role, so an
        HR Admin or Super Admin can never have a managed project — the page
        would be empty for them by construction. They manage projects from
        HR -> Projects, which is unchanged.
      */
      {
        path: ROUTES.MANAGED_PROJECTS,
        element: (
          <ProtectedRoute requiredRole={['manager']}>
            <Lazy><ManagedProjectsPage /></Lazy>
          </ProtectedRoute>
        ),
      },

      // HR routes
      {
        path: ROUTES.HR_DASHBOARD,
        element: (
          <ProtectedRoute requiredRole={['hr_admin', 'super_admin']}>
            <Lazy><HRDashboardPage /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.ANALYTICS,
        element: (
          <ProtectedRoute requiredRole={['hr_admin', 'super_admin']}>
            <Lazy><AnalyticsPage /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.BADGE_ANALYTICS,
        element: (
          <ProtectedRoute requiredRole={['hr_admin', 'super_admin']}>
            <Lazy><BadgeAnalyticsPage /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.REPORTS,
        element: (
          <ProtectedRoute requiredRole={['hr_admin', 'super_admin']}>
            <Lazy><ReportsPage /></Lazy>
          </ProtectedRoute>
        ),
      },
      /*
        The same page for a Manager, at a Manager's path.

        The guard admits managers and above; what a Manager can actually see is
        decided by report_subjects() and may_report_on() (043) from their
        session, so this route grants nothing. The organisation tab is not
        rendered for them, and organization_report() refuses them regardless.
      */
      {
        path: ROUTES.MANAGER_REPORTS,
        element: (
          <ProtectedRoute requiredRole={['manager', 'hr_admin', 'super_admin']}>
            <Lazy><ReportsPage /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.EMPLOYEES,
        element: (
          <ProtectedRoute requiredRole={['hr_admin', 'super_admin']}>
            <Lazy><EmployeesPage /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.SUPPORT_REQUESTS,
        element: (
          <ProtectedRoute requiredRole={['hr_admin', 'super_admin']}>
            <Lazy><SupportRequestsPage /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.DEPARTMENTS,
        element: (
          <ProtectedRoute requiredRole={['hr_admin', 'super_admin']}>
            <Lazy><DepartmentsPage /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.PROJECTS,
        element: (
          <ProtectedRoute requiredRole={['hr_admin', 'super_admin']}>
            <Lazy><ProjectsPage /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.CORE_VALUES,
        element: (
          <ProtectedRoute requiredRole={['hr_admin', 'super_admin']}>
            <Lazy><CoreValuesPage /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.BEHAVIOURS,
        element: (
          <ProtectedRoute requiredRole={['hr_admin', 'super_admin']}>
            <Lazy><BehavioursPage /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.SCENARIOS,
        element: (
          <ProtectedRoute requiredRole={['hr_admin', 'super_admin']}>
            <Lazy><ScenariosPage /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.REWARDS,
        element: (
          <ProtectedRoute requiredRole={['hr_admin', 'super_admin']}>
            <Lazy><RewardsPage /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.AUDIT_LOGS,
        element: (
          <ProtectedRoute requiredRole={['hr_admin', 'super_admin']}>
            <Lazy><AuditLogsPage /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.SETTINGS,
        element: (
          <ProtectedRoute requiredRole={['hr_admin', 'super_admin']}>
            <Lazy><SettingsPage /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        /*
          Value Coins. Both roles, because both are named in the two database
          functions behind the page — admin_list_value_coin_wallets() and
          admin_adjust_value_coin_wallet() re-read the caller's role from
          `employees` and refuse anybody else. This guard decides what is
          offered; those decide what happens.
        */
        path: ROUTES.VALUE_COINS,
        element: (
          <ProtectedRoute requiredRole={['hr_admin', 'super_admin']}>
            <Lazy><ValueCoinsPage /></Lazy>
          </ProtectedRoute>
        ),
      },
      {
        // The only route in the HR portal an hr_admin cannot reach.
        // ROLE_HIERARCHY makes this exact: hr_admin is 3, the gate needs 4.
        // Typing the URL directly lands on the same refusal, and every action
        // on the page is separately re-checked in the database.
        path: ROUTES.ADMINISTRATION,
        element: (
          <ProtectedRoute requiredRole={['super_admin']}>
            <Lazy><AdministrationPage /></Lazy>
          </ProtectedRoute>
        ),
      },
    ],
  },

  // Catch-all
  /*
    Unknown URL. RoleRedirect, not ROUTES.DASHBOARD: this sent every role to the
    EMPLOYEE dashboard, so a Super Admin who mistyped a path landed on a
    dashboard that was not theirs. It now lands each role on its own, and
    signs out cleanly when there is no session to read a role from.
  */
  { path: '*', element: <RoleRedirect /> },
])
