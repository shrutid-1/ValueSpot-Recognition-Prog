import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/** Ids of the profile dialogs currently open, innermost last. */
const openStack: string[] = []

interface ProfileDialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  /** While true, Escape and the backdrop do not close — a save is in flight. */
  busy?: boolean
  width?: number
  children: React.ReactNode
  footer?: React.ReactNode
}

/**
 * The frame both profile dialogs share.
 *
 * Portalled to <body> for the reason ConfirmModal gives: several pages leave a
 * transform on an ancestor, which would capture a fixed backdrop. Leaving the
 * page also leaves the Employee portal's `[data-vs-theme='dark']` element, so
 * when opened from inside it the portal re-establishes it — as `display: contents`, so
 * it adds no box of its own and its canvas background never paints over the
 * page. The administrative portal marks <html> itself, which a portal is still
 * inside.
 */
export function ProfileDialog({
  open, onClose, title, description, busy = false, width = 560, children, footer,
}: ProfileDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  /*
    Which system the dialog is opened FROM, read off the page rather than
    inferred from the role: a marker left in place tells us whether it sits
    inside the dark theme, so the dialog matches the page it covers even if
    which shell a role gets ever changes. Read before paint, so the first
    frame is already the right colour.
  */
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [dark, setDark] = useState(false)
  useLayoutEffect(() => {
    if (open) setDark(Boolean(anchorRef.current?.closest("[data-vs-theme='dark']")))
  }, [open])

  // Latest values for the listeners, without re-binding them on every render.
  const busyRef = useRef(busy)
  const closeRef = useRef(onClose)
  busyRef.current = busy
  closeRef.current = onClose

  const id = useId()

  useEffect(() => {
    if (!open) return

    // Dialogs stack: the crop dialog opens on top of Edit Profile. Only the
    // topmost one answers Escape, so one key press closes one dialog.
    openStack.push(id)

    const previouslyFocused = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // An element that asks for focus, else the first field, else the dialog
    // itself, so keyboard users land inside.
    const frame = requestAnimationFrame(() => {
      const root = dialogRef.current
      const target =
        root?.querySelector<HTMLElement>('[data-autofocus]') ??
        root?.querySelector<HTMLElement>('input:not([type=file]):not([disabled]), textarea, select') ??
        root
      target?.focus()
    })

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || openStack[openStack.length - 1] !== id) return
      if (busyRef.current) return
      e.stopPropagation()
      closeRef.current()
    }
    document.addEventListener('keydown', onKey)

    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey)
      const at = openStack.lastIndexOf(id)
      if (at !== -1) openStack.splice(at, 1)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus?.()
    }
  }, [open, id])

  const anchor = <span ref={anchorRef} hidden />
  if (!open) return anchor

  const titleId = `${id}-title`
  const descId = description ? `${id}-desc` : undefined

  const dialog = (
    <div
      className="vs-dialog-backdrop"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div
        ref={dialogRef}
        className="vs-dialog vp-scope vp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        aria-busy={busy || undefined}
        tabIndex={-1}
        style={{ width: `min(${width}px, 100%)`, animation: 'vs-rise 200ms ease-out both', outline: 'none' }}
      >
        <div
          className="flex items-start justify-between gap-3"
          style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--vp-rule)' }}
        >
          <div className="min-w-0">
            <h2
              id={titleId}
              style={{ fontSize: 19, fontWeight: 700, color: 'var(--vp-ink)', letterSpacing: '-0.01em', margin: 0 }}
            >
              {title}
            </h2>
            {description && (
              <p id={descId} style={{ fontSize: 13, color: 'var(--vp-muted)', marginTop: 4, lineHeight: 1.45 }}>
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="vs-btn-icon"
            style={{ width: 30, height: 30, flexShrink: 0 }}
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        <div className="vp-dialog-body">{children}</div>

        {footer && (
          <div
            className="flex justify-end flex-wrap gap-2"
            style={{ padding: '12px 18px', borderTop: '1px solid var(--vp-rule)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      {anchor}
      {/*
        Always the same wrapper, with only the attribute toggled. Swapping
        between a wrapper and none (the theme is only known after the first
        render) would change the element type and remount everything inside,
        leaving any child holding a reference to a node that no longer exists.
      */}
      {createPortal(
        <div data-vs-theme={dark ? 'dark' : undefined} style={{ display: 'contents' }}>{dialog}</div>,
        document.body,
      )}
    </>
  )
}
