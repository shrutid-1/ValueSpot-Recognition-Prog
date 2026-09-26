import type { BadgeSummary } from '@/types'
import { Panel } from './Panel'
import { valueTone } from '@/lib/value-tone'

interface ValueMatrixPanelProps {
  badges: BadgeSummary[]
  activeValueId: string | null
  onToggleValue: (coreValueId: string | null) => void
  delay?: number
}

/**
 * The Core Values, as a dot matrix.
 *
 * One row per value, one dot per recognition recorded against it. The dots
 * are the data — no bar, no percentage, no score out of an invented maximum.
 * A value at four dots and a value at one are immediately comparable, and a
 * value at zero shows a single hollow ring, because it is still one of the
 * five and leaving it out would misrepresent the set.
 *
 * Every row with at least one dot is a real filter over the record beside
 * it: pressing it narrows the record, pressing it again clears. Rows at zero
 * render as plain text rather than as buttons — there is nothing to filter
 * to, so they must not look pressable.
 *
 * Counts come straight from employee_value_badges through the dashboard
 * query. Nothing here is derived, weighted or scaled.
 */
export function ValueMatrixPanel({
  badges,
  activeValueId,
  onToggleValue,
  delay,
}: ValueMatrixPanelProps) {
  const total = badges.reduce((s, b) => s + b.recognition_count, 0)
  const covered = badges.filter(b => b.recognition_count > 0).length

  const ordered = [...badges].sort(
    (a, b) =>
      b.recognition_count - a.recognition_count ||
      a.core_value_name.localeCompare(b.core_value_name),
  )

  const top = ordered[0]?.recognition_count > 0 ? ordered[0] : null

  /*
    A cap on dots drawn. Past roughly twenty the row stops being countable
    and starts being a texture, and the printed figure beside it is the fact
    anyway — so the overflow is stated in words rather than silently
    truncated.
  */
  const MAX_DOTS = 20

  return (
    <Panel title="Values" delay={delay}>
      <div className="flex" style={{ gap: 28 }}>
        <div style={{ minWidth: 0 }}>
          <p className="vsx-fig" style={{ fontSize: 'clamp(34px, 4vw, 44px)' }}>
            {top ? top.recognition_count : 0}
          </p>
          <p className="vsx-meta truncate" style={{ fontSize: 13, marginTop: 5 }}>
            {top ? top.core_value_name : 'Most recognized'}
          </p>
        </div>

        <div style={{ minWidth: 0 }}>
          <p className="vsx-fig" style={{ fontSize: 'clamp(34px, 4vw, 44px)' }}>
            {covered}
            <span style={{ color: 'var(--vsx-text-3)' }}>/{badges.length}</span>
          </p>
          <p className="vsx-meta" style={{ fontSize: 13, marginTop: 5 }}>
            Values covered
          </p>
        </div>
      </div>

      <div style={{ marginTop: 20, marginLeft: -12, marginRight: -12 }}>
        {ordered.map(badge => {
          const count = badge.recognition_count
          const tone = valueTone(badge.core_value_slug || badge.core_value_name)
          const isActive = activeValueId === badge.core_value_id
          const shown = Math.min(count, MAX_DOTS)

          const inner = (
            <>
              <span
                className="truncate"
                style={{
                  width: 96,
                  flexShrink: 0,
                  fontSize: 13,
                  fontWeight: 500,
                  color: count > 0 ? 'var(--vsx-text)' : 'var(--vsx-text-3)',
                }}
              >
                {badge.core_value_name}
              </span>

              <span
                className="flex items-center"
                style={{ gap: 5, flex: 1, minWidth: 0, flexWrap: 'wrap' }}
                aria-hidden="true"
              >
                {count === 0 ? (
                  <span className="vsx-dot-empty" />
                ) : (
                  Array.from({ length: shown }, (_, i) => (
                    <span
                      key={i}
                      className="vsx-dot"
                      style={{ ['--tone' as string]: tone }}
                    />
                  ))
                )}
                {count > MAX_DOTS && (
                  <span style={{ fontSize: 11, color: 'var(--vsx-text-3)', marginLeft: 2 }}>
                    +{count - MAX_DOTS}
                  </span>
                )}
              </span>

              <span
                className="vsx-fig"
                style={{
                  fontSize: 16,
                  flexShrink: 0,
                  minWidth: 18,
                  textAlign: 'right',
                  color: count > 0 ? tone : 'var(--vsx-text-3)',
                }}
              >
                {count}
              </span>
            </>
          )

          if (count === 0) {
            return (
              <div key={badge.core_value_id} className="vsx-matrix-row">
                {inner}
              </div>
            )
          }

          return (
            <button
              key={badge.core_value_id}
              type="button"
              className="vsx-matrix-row"
              aria-pressed={isActive}
              aria-label={
                isActive
                  ? `Showing only ${badge.core_value_name}. Activate to show all recognitions.`
                  : `Show only recognitions for ${badge.core_value_name}. ${count} recorded.`
              }
              onClick={() => onToggleValue(isActive ? null : badge.core_value_id)}
            >
              {inner}
            </button>
          )
        })}
      </div>

      <p className="vsx-meta" style={{ fontSize: 12.5, marginTop: 'auto', paddingTop: 16 }}>
        {badges.length === 0
          ? 'No values are configured yet. Your HR team sets these up.'
          : total === 0
            ? 'Recognition you receive is recorded against a value.'
            : `${total} recognition${total === 1 ? '' : 's'} this period. Select a value to filter the record.`}
      </p>
    </Panel>
  )
}
