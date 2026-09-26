import type { BadgeSummary } from '@/types'
import { valueTone } from '@/lib/value-tone'

interface ValueRailProps {
  badges: BadgeSummary[]
  activeValueId: string | null
  onToggleValue: (coreValueId: string | null) => void
}

/**
 * The Core Values, as circular marks down the left edge of the page.
 *
 * This is the rail the reference design puts at the far left. Rather than
 * fill it with navigation icons that duplicate the pills already in the top
 * bar, it is given the one job nothing else on the page can do as directly:
 * pressing a value filters the record to it, and pressing it again clears.
 *
 * Constraints it respects:
 *
 * · A value with no recognitions recorded against it renders as an inert
 *   mark, not a button. There is nothing to filter to, so it must not look
 *   pressable.
 * · A 46px circle cannot hold a word, so every mark carries a tooltip and a
 *   full aria-label, and the Values panel states the same five in writing.
 *   The rail is a shortcut to something already reachable, never the only
 *   way to reach it.
 * · It is hidden below 1440px, because below that there is no room outside
 *   the content column and a floating rail would sit on top of the panels.
 *   The Values panel keeps the same filter available at every width.
 */
export function ValueRail({ badges, activeValueId, onToggleValue }: ValueRailProps) {
  /*
    Two Core Values can share a first letter — "Adaptable" and "Accountable"
    do. Where that happens both marks take two letters, so the rail never
    shows the same glyph twice in different colours.
  */
  const firstLetters = badges.map(b => b.core_value_name.charAt(0).toUpperCase())
  const glyphOf = (name: string) => {
    const first = name.charAt(0).toUpperCase()
    const shared = firstLetters.filter(l => l === first).length > 1
    return shared ? name.slice(0, 2).toUpperCase() : first
  }

  return (
    <div
      className="vsx-rail vsx-dock"
      style={{
        position: 'fixed',
        top: '50%',
        transform: 'translateY(-50%)',
        flexDirection: 'column',
        gap: 12,
        zIndex: 30,
      }}
      role="group"
      aria-label="Filter the record by Core Value"
    >
      {badges.map(badge => {
        const tone = valueTone(badge.core_value_slug || badge.core_value_name)
        const glyph = glyphOf(badge.core_value_name)
        const count = badge.recognition_count

        if (count === 0) {
          return (
            <span
              key={badge.core_value_id}
              className="vsx-rail-mark"
              data-label={`${badge.core_value_name} — none yet`}
              aria-hidden="true"
            >
              {glyph}
            </span>
          )
        }

        const isActive = activeValueId === badge.core_value_id

        return (
          <button
            key={badge.core_value_id}
            type="button"
            className="vsx-rail-btn"
            style={{ ['--tone' as string]: tone }}
            data-label={`${badge.core_value_name} — ${count}`}
            aria-pressed={isActive}
            aria-label={
              isActive
                ? `Showing only ${badge.core_value_name}. Activate to show all recognitions.`
                : `Show only recognitions for ${badge.core_value_name}. ${count} recorded.`
            }
            onClick={() => onToggleValue(isActive ? null : badge.core_value_id)}
          >
            {glyph}
          </button>
        )
      })}
    </div>
  )
}
