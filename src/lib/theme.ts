import { useLayoutEffect, useSyncExternalStore } from 'react'

/**
 * Light and dark, per portal.
 *
 * THE CLASS IS THE STATE
 * ----------------------
 * Whether the app is dark is exactly one fact: the `dark` class on <html>.
 * ToggleTheme flips it, the stylesheets read it (styles/theme-modes.css), and
 * the few components that choose a colour in JavaScript — the logo — watch it
 * through useIsDarkTheme(). Nothing else holds a copy that could disagree.
 *
 * EACH PORTAL KEEPS ITS OWN DEFAULT
 * ---------------------------------
 * The Employee portal was designed dark and the administrative portals
 * (Manager, HR Admin, Super Admin) light, so each opens the way it was built
 * until the person chooses otherwise — and a choice made in one does not
 * repaint the other. The choice is remembered per portal, in this browser.
 *
 * It lives in localStorage because it is a per-viewer convenience: losing it
 * (a private window, cleared site data) costs nothing but the default look.
 */

export type ThemePortal = 'employee' | 'admin'

const DEFAULT_DARK: Record<ThemePortal, boolean> = {
  employee: true,
  admin: false,
}

const storageKey = (portal: ThemePortal) => `valuespot:theme:${portal}`

function readPreference(portal: ThemePortal): boolean {
  try {
    const saved = window.localStorage.getItem(storageKey(portal))
    if (saved === 'dark') return true
    if (saved === 'light') return false
  } catch {
    // Storage blocked — fall through to the portal's own default.
  }
  return DEFAULT_DARK[portal]
}

function writePreference(portal: ThemePortal, dark: boolean) {
  try {
    window.localStorage.setItem(storageKey(portal), dark ? 'dark' : 'light')
  } catch {
    // Not remembered this time; the toggle itself still worked.
  }
}

export function isDarkTheme(): boolean {
  return document.documentElement.classList.contains('dark')
}

/**
 * Open a portal's theme: apply its remembered mode before first paint, save
 * every change the toggle makes, and take the class away again when the
 * portal unmounts — so signing out lands the auth screens on their own look.
 */
export function useThemeScope(portal: ThemePortal) {
  // Layout effect: the class must be in place before the browser paints, or
  // a light-mode employee would see one dark frame first.
  useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', readPreference(portal))

    const observer = new MutationObserver(() => writePreference(portal, isDarkTheme()))
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })

    return () => {
      observer.disconnect()
      root.classList.remove('dark')
    }
  }, [portal])
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

/**
 * Re-renders when the theme flips. For the rare colour chosen in JavaScript.
 *
 * An external store rather than state + effect: its updates render
 * synchronously, so a component mounted before its shell applied the saved
 * mode is corrected before the frame is painted, not one frame after.
 */
export function useIsDarkTheme(): boolean {
  return useSyncExternalStore(subscribe, isDarkTheme, () => false)
}
