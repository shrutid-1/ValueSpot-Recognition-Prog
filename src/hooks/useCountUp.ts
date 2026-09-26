import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from './useReducedMotion'

export interface CountUpOptions {
  durationMs?: number
  /**
   * Whether the first paint counts up from zero.
   *
   * Off by default, and that default is the important one. A balance is a
   * fact the reader came to check, so it is on screen the moment the screen
   * is — arriving at a wallet and watching five figures wind up from zero is
   * the slot-machine reading this system is built to avoid. Only a CHANGE is
   * worth animating, because only a change is news.
   *
   * On for a figure whose whole purpose is the count, which is rare.
   */
  fromZero?: boolean
  /**
   * Whether `target` is a real figure yet.
   *
   * False while a fetch is in flight, when the caller is passing a
   * placeholder — usually 0 — that is not on screen. Without this the first
   * real balance would count up from that placeholder, which is the winding
   * up from zero the default above exists to prevent: the figure was never
   * 0, the fetch simply had not finished.
   *
   * The first real value is SEEDED rather than animated. Changes after it
   * animate normally, which is the whole point — a balance that moves while
   * somebody is looking at it is news, and a balance arriving is not.
   */
  live?: boolean
}

/**
 * A whole number settling into place.
 *
 * Deliberately modest: one short run, ending exactly on the target, never
 * looping and never replaying unless the target itself has actually moved. A
 * figure that re-animates on every background refetch is the kind of motion
 * that stops being delightful by the third visit.
 *
 * With reduced motion requested it returns the target immediately — the
 * INFORMATION is never withheld, only the animation is.
 */
export function useCountUp(target: number, options: CountUpOptions = {}): number {
  const { durationMs = 520, fromZero = false, live = true } = options
  const reduced = useReducedMotion()

  /*
    Seeded at the target unless this figure was asked to wind up from zero.

    When it IS winding up from zero, seeding at the target and correcting on
    the first frame would paint the answer and then hide it — a visible
    flash of the real number before the count starts. useReducedMotion
    resolves synchronously in its own initialiser, so the right starting
    value is already known here.
  */
  const [value, setValue] = useState(() =>
    (reduced || !fromZero || target <= 0 ? target : 0),
  )

  /** What is currently on screen, so a later change animates from there. */
  const displayed = useRef(value)
  const frame = useRef<number>()
  /** Whether a real figure has been shown yet. See `live`. */
  const settled = useRef(live)

  useEffect(() => {
    /*
      Three reasons to arrive instantly rather than to count: motion was
      declined, the figure is still a placeholder, or this is the first real
      figure and there is nothing to have moved FROM.
    */
    if (reduced || !live || !settled.current) {
      setValue(target)
      displayed.current = target
      if (live) settled.current = true
      return
    }

    const from = displayed.current
    // Nothing to do when the figure has not moved — this is what stops a
    // refetch that returned the same number from replaying the count.
    if (from === target) return

    const start = performance.now()

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs)
      // Ease-out: quick to begin, settling at the end. Close enough to
      // --vsx-ease that a counter and a bar beside it feel related.
      const eased = 1 - Math.pow(1 - progress, 3)
      const next = Math.round(from + (target - from) * eased)

      setValue(next)
      displayed.current = next

      if (progress < 1) {
        frame.current = requestAnimationFrame(tick)
      } else {
        // Land on the exact figure rather than on whatever rounding produced.
        setValue(target)
        displayed.current = target
      }
    }

    frame.current = requestAnimationFrame(tick)
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    }
  }, [target, durationMs, reduced, live])

  return value
}
