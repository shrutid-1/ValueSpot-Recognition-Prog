import { useEffect, useState } from 'react'

/**
 * Whether this person has asked for reduced motion.
 *
 * The CSS in globals.css already neutralises declarative animation; this is
 * for the cases CSS cannot reach — a value counted up in JavaScript, which
 * has to be told to arrive at its final figure immediately rather than to
 * arrive slowly.
 *
 * Subscribes rather than reading once: the preference can be changed while
 * the tab is open, and on some platforms it follows a system-wide setting
 * that a person may well be toggling precisely because something on screen
 * is bothering them.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    // SSR-safe and safe in a test environment without matchMedia. Defaulting
    // to `true` is the cautious direction: it means no motion until we know.
    if (typeof window === 'undefined' || !window.matchMedia) return true
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return

    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)

    setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return reduced
}
