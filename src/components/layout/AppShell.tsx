import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { NotificationProvider } from '@/context/NotificationContext'
import { useThemeScope } from '@/lib/theme'

/**
 * The administrative shell — Manager, HR Admin and Super Admin.
 *
 * One white frame on a soft canvas, holding the navigation, the top bar and
 * the content ground. The frame is exactly the height of the viewport and
 * never scrolls: `.ad-canvas` inside it does, which is what keeps the sidebar
 * and the search in place on a table two hundred rows long.
 *
 * The theme scope is set in TWO places on purpose.
 *
 * On this element, so everything rendered inside the shell is themed on the
 * first paint. And on the document element, because dialogs portal to
 * <body> — the moderation editor, every confirmation — and would otherwise
 * come out in the Blueprint palette while the page behind them is branded. The
 * attribute is removed on unmount, so signing out or landing on the Employee
 * portal leaves nothing behind.
 *
 * Presentation only. PortalShell decides which shell a role gets,
 * ProtectedRoute guards every route, and the database re-checks every action.
 */
export function AppShell() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Light unless this person chose dark here (the toggle is in the TopBar).
  useThemeScope('admin')

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-vs-portal', 'admin')
    return () => root.removeAttribute('data-vs-portal')
  }, [])

  return (
    <NotificationProvider>
      <div className="ad-shell" data-vs-portal="admin">
        <a href="#main-content" className="skip-link">Skip to content</a>

        <div className="ad-frame">
          <Sidebar
            mobileOpen={mobileMenuOpen}
            onMobileClose={() => setMobileMenuOpen(false)}
          />

          <div className="ad-col">
            <TopBar onMobileMenuOpen={() => setMobileMenuOpen(true)} />

            <main id="main-content" className="ad-canvas">
              <div className="ad-main-measure">
                <Outlet />
              </div>
            </main>
          </div>
        </div>
      </div>
    </NotificationProvider>
  )
}
