import type React from 'react'

/**
 * Close-on-backdrop-click for a modal, without closing on a drag.
 *
 * A bare `onClick={e => e.target === e.currentTarget && close()}` misfires on
 * drag: press inside the dialog (say, to select text in a field), release
 * over the dimmed backdrop, and the browser fires `click` on the nearest
 * element containing both ends — the backdrop itself — so the dialog closed
 * mid-selection, taking whatever was typed with it.
 *
 * The same happens the other way round — press on the backdrop, release
 * inside the dialog — so the gesture has to both START and END on the
 * backdrop. Where each end landed is kept on the element for the length of
 * one press, which keeps this a plain function rather than a hook: several
 * dialogs return early, and a hook would have to be threaded above every one
 * of those returns.
 *
 * Usage: <div className="vs-dialog-backdrop" {...dismissOnBackdrop(onClose)}>
 */
export function dismissOnBackdrop(onDismiss: () => void) {
  const where = (e: React.SyntheticEvent<HTMLElement>) =>
    e.target === e.currentTarget ? 'backdrop' : 'inside'

  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      e.currentTarget.dataset.pressStart = where(e)
      delete e.currentTarget.dataset.pressEnd
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      e.currentTarget.dataset.pressEnd = where(e)
    },
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      const { pressStart, pressEnd } = e.currentTarget.dataset
      delete e.currentTarget.dataset.pressStart
      delete e.currentTarget.dataset.pressEnd
      if (pressStart === 'backdrop' && pressEnd === 'backdrop') onDismiss()
    },
  }
}
