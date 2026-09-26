import { NavLink, useNavigate } from 'react-router-dom'
import { X, LifeBuoy, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/lib/constants'
import { useAuth } from '@/context/AuthContext'
import { useApprovalQueue } from '@/hooks/queries'
import { buildNav, type NavItem, type NavGroup } from './navModel'
import { ValueSpotLogo, ValueSpotMark } from '@/components/brand/ValueSpotLogo'
import { useIsDarkTheme } from '@/lib/theme'

function NavItemLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.href}
      onClick={onNavigate}
      className={({ isActive }) => cn('ad-nav', isActive && 'active')}
    >
      <Icon size={17} aria-hidden="true" strokeWidth={1.9} />
      <span className="truncate">{item.label}</span>
      {typeof item.badge === 'number' && item.badge > 0 && (
        <span className="ad-nav-badge" aria-hidden="true">
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      )}
    </NavLink>
  )
}

/*
  The "View as" switcher was removed here.

  It was three buttons — Employee / Manager / HR — that called navigate() to
  the corresponding dashboard. Nothing more: no impersonation, no assumed role,
  no state, and no effect on what the session could read or write. It looked
  like a role switcher and was not one, which is precisely why it had to go —
  it implied the signed-in person could become another role, and a control that
  misrepresents the security model is worse than no control.

  Nothing replaces it. Every destination it pointed at is still reachable:
  a role's own dashboard is "Dashboard", and the other dashboards remain at
  their own routes for anyone authorised to open them.
*/

function SidebarContent({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const dark = useIsDarkTheme()

  const handleSignOut = async () => {
    onNavigate?.()
    await signOut()
    navigate(ROUTES.LOGIN)
  }

  return (
    <>
      <div className="ad-side-brand">
        <ValueSpotMark size={34} />
        <span className="min-w-0">
          <ValueSpotLogo size={13} tone={dark ? 'onDark' : 'onLight'} />
          <span className="ad-brand-sub" style={{ display: 'block', marginTop: 4 }}>Touchcore Systems</span>
        </span>
      </div>

      <nav className="ad-side-scroll" aria-label="Main navigation">
        {groups.map((group, gi) => (
          <div key={gi}>
            {group.label && <p className="ad-side-label">{group.label}</p>}
            {group.items.map(item => (
              <NavItemLink key={item.href} item={item} onNavigate={onNavigate} />
            ))}
          </div>
        ))}

        {/*
          The help desk and the way out, kept apart from the work. Support is
          a personal route every role holds; signing out is offered here as
          well as in the profile menu, because this is where a person looks
          for it.
        */}
        <div>
          <p className="ad-side-label">General</p>
          <NavItemLink item={{ label: 'Support', href: ROUTES.SUPPORT, icon: LifeBuoy }} onNavigate={onNavigate} />
          <button type="button" className="ad-nav" onClick={handleSignOut}>
            <LogOut size={17} aria-hidden="true" strokeWidth={1.9} />
            <span className="truncate">Log out</span>
          </button>
        </div>
      </nav>
    </>
  )
}

interface SidebarProps {
  mobileOpen: boolean
  onMobileClose: () => void
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const { role } = useAuth()

  /*
    The badge on Pending Approvals.

    The SAME cached query the approvals screen reads, not a second count — so
    the number on the rail and the number of rows on that page can never
    disagree, and opening the screen costs no extra request. The scope is the
    database's: a Manager's queue is what was routed to them, HR and a Super
    Admin see the organisation.
  */
  const isApprover = role === 'manager' || role === 'hr_admin' || role === 'super_admin'
  const queue = useApprovalQueue()
  const pendingCount = isApprover
    ? (queue.data ?? []).filter(i => i.status === 'pending').length
    : 0

  const groups = buildNav(role).map(group => ({
    ...group,
    items: group.items.map(item =>
      item.href === ROUTES.PENDING_APPROVALS
        ? { ...item, badge: pendingCount }
        : item,
    ),
  }))

  return (
    <>
      {/* Desktop rail — a column of the frame, not a floating panel */}
      <aside className="ad-side" aria-label="Sidebar">
        <SidebarContent groups={groups} />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          <div
            className="fixed inset-0"
            style={{ background: 'rgba(20, 23, 26, 0.42)' }}
            onClick={onMobileClose}
            aria-hidden="true"
          />
          <aside
            className="fixed left-0 top-0 h-full z-10 flex flex-col animate-slide-in-right"
            style={{
              width: 274,
              background: 'var(--ad-frame)',
              borderTopRightRadius: 'var(--ad-r-frame)',
              borderBottomRightRadius: 'var(--ad-r-frame)',
              overflow: 'hidden',
            }}
          >
            <button
              onClick={onMobileClose}
              className="ad-icon-btn"
              aria-label="Close navigation"
              style={{ position: 'absolute', top: 16, right: 14, zIndex: 2 }}
            >
              <X size={16} />
            </button>
            <SidebarContent groups={groups} onNavigate={onMobileClose} />
          </aside>
        </div>
      )}
    </>
  )
}
