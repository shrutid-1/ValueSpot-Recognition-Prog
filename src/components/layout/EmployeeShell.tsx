import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { NotificationProvider } from '@/context/NotificationContext'
import { ValueCoinProvider } from '@/context/ValueCoinContext'
import { AppNavigation } from '@/components/experience/AppNavigation'
import { Colophon } from '@/components/experience/Colophon'
import { ValueCoinToastHost } from '@/components/experience/ValueCoinToast'
import { ROUTES } from '@/lib/constants'
import { useThemeScope } from '@/lib/theme'
import { cn } from '@/lib/utils'

/**
 * Screens that end without the colophon.
 *
 * These already close themselves — the feed and My recognitions end on their
 * last entry, the journey on its last value, Support on its form — and a
 * second navigation bar under them was repetition rather than a close.
 *
 * My profile joins them for a slightly different reason: it is one short card
 * on an otherwise empty page, so the colophon does not sit at the FOOT of
 * anything — it lands directly under a 300px panel and reads as the larger
 * half of the screen.
 */
const NO_COLOPHON: readonly string[] = [
  ROUTES.RECOGNITION_FEED,
  ROUTES.MY_RECOGNITIONS,
  ROUTES.CORE_VALUE_JOURNEY,
  ROUTES.SUPPORT,
  ROUTES.PROFILE,
  ROUTES.WALLET,
  ROUTES.VALUE_STORE,
]

/**
 * The Employee portal shell.
 *
 * Thin by design: it opens the theme scope, provides notifications and coin
 * events, hands the chrome to AppNavigation and supplies the one action that
 * belongs on every screen.
 *
 * ValueCoinProvider sits INSIDE NotificationProvider because it reads from
 * it: a notification row is the database saying coins moved, and it is what
 * tells the coin layer to go and look at the balance. Both are inside the
 * employee shell only — HR and Manager portals have no wallet to watch.
 *
 * No routing or authorisation happens here. ProtectedRoute wraps this, and
 * the database re-checks every action.
 */
export function EmployeeShell() {
  const navigate = useNavigate()
  const location = useLocation()

  // Nothing offers to start a recognition from inside the recognition wizard.
  const onWizard = location.pathname.startsWith(ROUTES.GIVE_RECOGNITION)

  /*
    Trailing slashes are stripped before the comparison — `/feed` and
    `/feed/` are the same screen, and an exact match against the raw
    pathname would quietly put the colophon back on one of them.
  */
  const path = location.pathname.replace(/\/+$/, '') || '/'
  // The wizard is a focused task; a footer of links under it is an exit ramp.
  const showColophon = !onWizard && !NO_COLOPHON.includes(path)

  // Dark unless this person chose light here (the toggle is in AppNavigation).
  useThemeScope('employee')

  return (
    <NotificationProvider>
      <ValueCoinProvider>
        {/* Height and the block formatting context both come from
            `[data-vs-theme='dark'][data-vs-root]` in the theme stylesheet. */}
        <div data-vs-theme="dark" data-vs-root>
          <a href="#main-content" className="skip-link">Skip to content</a>

          <AppNavigation />

          <main
            id="main-content"
            className={cn('vsx-measure-main', !showColophon && 'vsx-measure-main-tail')}
            /*
              The top gutter belongs HERE, not on each page.

              It was once `0` on top, and only the dashboard compensated with
              padding of its own. Every other screen — the feed, My
              recognitions, the journey, Support, Profile — therefore opened
              flush against the sticky navigation, with its heading almost
              touching the bar. One value, set once, for all six.

              The column width and gutter now come from `.vsx-measure-main`,
              which reads the same tokens the navigation bar and the docked
              rail use — so the three can no longer drift apart.
            */
          >
            <Outlet />
            {showColophon && <Colophon />}
          </main>

          {/*
            Give recognition, as the floating action at the bottom-left.

            It is here rather than in the top bar because it is the one thing
            this product exists for, and a bar full of pills is exactly where a
            primary action gets lost. Fixed, so it does not scroll away on a
            long feed, and it steps aside inside the wizard where offering to
            start a recognition would be nonsense.
          */}
          {!onWizard && (
            <button
              type="button"
              className="vsx-fab vsx-dock"
              style={{ position: 'fixed', bottom: 24, zIndex: 35 }}
              onClick={() => navigate(ROUTES.GIVE_RECOGNITION)}
              aria-label="Recognize someone"
              title="Recognize someone"
            >
              <Plus size={26} aria-hidden="true" strokeWidth={2.4} />
            </button>
          )}

          {/*
            Where a confirmed coin movement surfaces.

            Inside the themed element so the tokens resolve, and last in the
            shell so it paints over the page rather than under it.
          */}
          <ValueCoinToastHost />
        </div>
      </ValueCoinProvider>
    </NotificationProvider>
  )
}
