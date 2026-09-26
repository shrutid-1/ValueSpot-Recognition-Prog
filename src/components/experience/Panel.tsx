import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PanelProps {
  /** The uppercase label at the top-left. */
  title: string
  /**
   * The control at the top-right.
   *
   * The reference this design follows puts a "…" overflow menu here on every
   * card. That is not reproduced: an overflow menu with nothing behind it is
   * a control that looks pressable and does nothing, which is the exact
   * defect this portal has already been through once. A panel gets an action
   * only where a real destination or a real operation exists.
   */
  action?: ReactNode
  children: ReactNode
  /** Staggers the settle-in so the grid assembles rather than appearing. */
  delay?: number
  className?: string
  style?: React.CSSProperties
  labelledBy?: string
}

/**
 * The container. One shape, used everywhere.
 *
 * Flat fill on a near-black page, 22px radius, no border. Depth comes from
 * the fill difference and a single inset highlight along the top edge, not
 * from a drop shadow — a page of shadowed cards on black turns into mush.
 */
export function Panel({
  title,
  action,
  children,
  delay = 0,
  className,
  style,
  labelledBy,
}: PanelProps) {
  const headingId = labelledBy ?? `vsx-panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

  return (
    <section
      className={cn('vsx-panel vsx-settle', className)}
      style={{ animationDelay: `${delay}ms`, ...style }}
      aria-labelledby={headingId}
    >
      <header className="vsx-panel-head">
        <h2 id={headingId} className="vsx-panel-title">{title}</h2>
        {action && <div className="ml-auto flex items-center">{action}</div>}
      </header>
      {children}
    </section>
  )
}
