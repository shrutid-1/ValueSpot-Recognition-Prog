import type { BadgeSummary } from '@/types'
import { CORE_VALUE_COLORS } from '@/lib/constants'
import type { CoreValueSlug } from '@/lib/constants'

interface BadgeProgressMiniProps {
  badge: BadgeSummary
  className?: string
}

/** Additive blueprint badge icon — stroke only, no fill except L5 core */
function MiniBadge({ level, color }: { level: number; color: string }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} aria-hidden="true">
      <rect x={3} y={3} width={18} height={18} />
      {level >= 2 && <rect x={7} y={7} width={10} height={10} />}
      {level >= 3 && <><line x1={12} y1={3} x2={12} y2={21} /><line x1={3} y1={12} x2={21} y2={12} /></>}
      {level >= 4 && <><line x1={3} y1={3} x2={21} y2={21} /><line x1={21} y1={3} x2={3} y2={21} /></>}
      {level >= 5 && <rect x={9} y={9} width={6} height={6} fill={color} />}
    </svg>
  )
}

export function BadgeProgressMini({ badge, className }: BadgeProgressMiniProps) {
  const slug  = badge.core_value_slug as CoreValueSlug
  const tone  = CORE_VALUE_COLORS[slug] ?? '#c42a20'
  const count = badge.recognition_count
  const next  = badge.next_threshold
  const level = badge.badge_level

  const pct = level === 5 ? 100
    : next && next > 0 ? Math.min(100, Math.round((count / next) * 100)) : 0

  return (
    <div
      className={className}
      role="region"
      aria-label={`${badge.core_value_name} badge progress`}
      style={{
        padding: 12,
        border: '1px solid var(--color-divider)',
        borderLeft: `3px solid ${tone}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="vs-kicker" style={{ color: tone, fontSize: 9 }}>
          {badge.core_value_name}
        </p>
        {level !== null && <MiniBadge level={level} color={tone} />}
      </div>

      {/* Badge name */}
      <p
        className="font-condensed"
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: level ? tone : 'var(--color-neutral-500)',
          lineHeight: 1.2,
        }}
      >
        {badge.badge_name ?? 'No badge yet'}
      </p>

      {/* Count */}
      <p style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>
        {count} recognition{count !== 1 ? 's' : ''}
        {badge.unique_recognizer_count > 0 && ` · ${badge.unique_recognizer_count} recognizer${badge.unique_recognizer_count !== 1 ? 's' : ''}`}
      </p>

      {/* Progress */}
      {level !== 5 ? (
        <div>
          <div
            className="vs-progress-track"
            style={{ height: 3 }}
            role="progressbar"
            aria-valuenow={count}
            aria-valuemax={next ?? 1}
            aria-valuemin={0}
            aria-label={`Progress toward ${badge.next_badge_name ?? 'next badge'}`}
          >
            <div className="vs-progress-fill" style={{ width: `${pct}%`, background: tone }} />
          </div>
          <p style={{ fontSize: 10, color: 'var(--color-neutral-500)', marginTop: 4 }}>
            {next
              ? level
                ? `${count}/${next} for ${badge.next_badge_name}`
                : `${count}/1 unlocks Cheers`
              : '1 recognition unlocks Cheers'}
          </p>
        </div>
      ) : (
        <p className="vs-kicker" style={{ color: tone, fontSize: 9 }}>Highest badge achieved</p>
      )}
    </div>
  )
}
