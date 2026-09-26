import type React from 'react'
import {
  LayoutDashboard, Plus, Rss, Award, Star, Users, FolderKanban, Building2,
  BarChart3, FileText, Settings, ClipboardList, Gift, Shield,
  CheckSquare, Zap, BookOpen, ShieldCheck, LifeBuoy, Coins,
} from 'lucide-react'
import { ROUTES } from '@/lib/constants'
import { dashboardForRole } from '@/lib/portals'

/**
 * The navigation MODEL for the administrative portals.
 *
 * Apart from the Sidebar that renders it because two components read it: the
 * rail, and the top bar's search, which finds screens by name. Keeping the
 * model in its own module means the search can never offer a destination the
 * rail does not list.
 */

export interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  /** A live count shown at the right of the row. Only ever a real figure. */
  badge?: number
}

export interface NavGroup {
  label?: string
  items: NavItem[]
}

/**
 * The navigation a role is offered.
 *
 * "Dashboard" is the role's OWN dashboard — dashboardForRole() decides which,
 * and it is the same function the post-sign-in redirect uses, so the first nav
 * item and the page you land on are always the same page.
 *
 * That is why there is no separate "Manager Dashboard" or "HR Dashboard" entry
 * any more: for the role that owns one, it IS "Dashboard", and listing it
 * twice under two names was the confusion. The routes are untouched and still
 * reachable directly; only the duplicated nav entries are gone.
 *
 * Nothing here is a permission. A role that is not offered a link is not
 * thereby blocked from the route, and a role that is offered one is not
 * thereby allowed: ProtectedRoute guards every route and the database
 * re-checks every action. This decides what is worth showing, nothing else.
 */
export function buildNav(role: string | null): NavGroup[] {
  const groups: NavGroup[] = [
    {
      /*
        Labelled, where it used to be the one unlabelled group. Every other
        group carries a heading, and an anonymous first block read as chrome
        rather than as the personal destinations it holds.

        Support moved from here to GENERAL at the foot — it is the help desk,
        not a place recognition happens.
      */
      label: 'Menu',
      items: [
        { label: 'Dashboard',             href: dashboardForRole(role),    icon: LayoutDashboard },
        { label: 'Give Recognition',      href: ROUTES.GIVE_RECOGNITION,   icon: Plus },
        { label: 'Recognition Feed',      href: ROUTES.RECOGNITION_FEED,   icon: Rss },
        { label: 'My Recognitions',       href: ROUTES.MY_RECOGNITIONS,    icon: Award },
        { label: 'My Core Value Journey', href: ROUTES.CORE_VALUE_JOURNEY, icon: Star },
      ],
    },
  ]

  if (role === 'manager' || role === 'hr_admin' || role === 'super_admin') {
    groups.push({
      /*
        Named for what it holds rather than for who sees it. "Manager" as a
        heading was redundant for a Manager and misleading for HR, who see the
        same group; these are the team-facing screens either way.
      */
      label: 'Team',
      items: [
        { label: 'Pending Approvals', href: ROUTES.PENDING_APPROVALS, icon: CheckSquare },
        { label: 'Team Recognition',  href: ROUTES.TEAM_RECOGNITION,  icon: Users },
        { label: 'Team Badges',       href: ROUTES.TEAM_BADGES,       icon: Zap },
        /*
          Managers only, unlike the three above. A Project Manager must hold
          the Manager role (guard_project_manager, 029), so this would be an
          empty screen for HR and Super Admin — who have HR -> Projects, which
          shows every project rather than only their own.
        */
        ...(role === 'manager'
          ? [
            { label: 'My Projects', href: ROUTES.MANAGED_PROJECTS, icon: FolderKanban },
            /*
              Managers only, and pointed at the manager path. HR and Super
              Admin reach the same page through Insights -> Reports below,
              which also carries the organisation-wide report they have and a
              Manager does not.
            */
            { label: 'Reports', href: ROUTES.MANAGER_REPORTS, icon: FileText },
          ]
          : []),
      ],
    })
  }

  if (role === 'hr_admin' || role === 'super_admin') {
    groups.push(
      {
        // Same reasoning as 'Team' above: what it holds, not who sees it.
        label: 'Insights',
        items: [
          { label: 'Analytics',       href: ROUTES.ANALYTICS,       icon: BarChart3 },
          { label: 'Badge Analytics', href: ROUTES.BADGE_ANALYTICS, icon: Zap },
          { label: 'Reports',         href: ROUTES.REPORTS,         icon: FileText },
        ],
      },
      {
        label: 'Manage',
        items: [
          { label: 'Employees',   href: ROUTES.EMPLOYEES,   icon: Users },
          { label: 'Support Requests', href: ROUTES.SUPPORT_REQUESTS, icon: LifeBuoy },
          { label: 'Departments', href: ROUTES.DEPARTMENTS, icon: Building2 },
          { label: 'Projects',    href: ROUTES.PROJECTS,    icon: FolderKanban },
          { label: 'Core Values', href: ROUTES.CORE_VALUES, icon: Star },
          { label: 'Behaviours',  href: ROUTES.BEHAVIOURS,  icon: ClipboardList },
          { label: 'Scenarios',   href: ROUTES.SCENARIOS,   icon: BookOpen },
          { label: 'Rewards',     href: ROUTES.REWARDS,     icon: Gift },
        ],
      },
      {
        label: 'System',
        items: [
          { label: 'Value Coins', href: ROUTES.VALUE_COINS, icon: Coins },
          { label: 'Audit Logs', href: ROUTES.AUDIT_LOGS, icon: Shield },
          { label: 'Settings',   href: ROUTES.SETTINGS,   icon: Settings },
        ],
      }
    )
  }

  // Same portal, higher privilege. A super admin sees everything above plus
  // this group; an hr_admin sees the HR portal exactly as before. Hiding it is
  // only tidiness — the route is gated and every action re-checks the caller's
  // role in the database.
  if (role === 'super_admin') {
    groups.push({
      label: 'Administration',
      items: [
        { label: 'Administration', href: ROUTES.ADMINISTRATION, icon: ShieldCheck },
      ],
    })
  }

  return groups
}
