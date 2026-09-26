import { NavLink } from 'react-router-dom'
import { ROUTES } from '@/lib/constants'
import { ValueSpotLogo } from '@/components/brand/ValueSpotLogo'
import { useIsDarkTheme } from '@/lib/theme'

/**
 * The foot of every employee screen.
 *
 * Applications tend to run out of content and leave a long empty scroll
 * below it, which is a large part of why this portal read as sparse even
 * where the content above was right. This closes the page: one panel, the
 * product, and the destinations again.
 *
 * The left padding clears the floating action button, which is fixed at the
 * bottom-left of every screen.
 */
export function Colophon() {
  const dark = useIsDarkTheme()
  const links = [
    { label: 'Recognition feed', href: ROUTES.RECOGNITION_FEED },
    { label: 'My recognitions', href: ROUTES.MY_RECOGNITIONS },
    { label: 'My journey', href: ROUTES.CORE_VALUE_JOURNEY },
    { label: 'Support', href: ROUTES.SUPPORT },
  ]

  /*
    No bottom margin. The space below the colophon is padding on <main>
    instead — a margin here escapes the dark background by collapsing
    through every ancestor that has no bottom padding or border.
  */
  return (
    <footer style={{ margin: 'clamp(28px, 4vw, 48px) 0 0' }}>
      <div
        className="vsx-panel flex flex-wrap items-center"
        style={{ gap: '16px 32px', padding: '20px 24px', flexDirection: 'row' }}
      >
        <div style={{ minWidth: 0 }}>
          <ValueSpotLogo size={13} tone={dark ? 'onDark' : 'onLight'} />
          <p className="vsx-meta" style={{ fontSize: 12.5, marginTop: 5 }}>
            Touchcore Systems
          </p>
        </div>

        <nav
          className="flex flex-wrap items-center ml-auto"
          style={{ gap: 8 }}
          aria-label="Footer"
        >
          {links.map(l => (
            <NavLink
              key={l.href}
              to={l.href}
              className="vsx-btn vsx-btn-quiet vsx-btn-sm"
              style={{ textDecoration: 'none' }}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </footer>
  )
}
