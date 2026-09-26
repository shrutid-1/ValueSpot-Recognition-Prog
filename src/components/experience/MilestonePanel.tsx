import type { BadgeSummary } from '@/types'
import { Panel } from './Panel'
import { nextMilestoneOf } from '@/lib/milestone'
import { valueTone } from '@/lib/value-tone'

interface MilestonePanelProps {
  badges: BadgeSummary[]
  onViewJourney: () => void
  delay?: number
}

/**
 * The next badge.
 *
 * Every figure is read off badge_definitions through `toBadgeSummary`. There
 * is no invented scale and no fabricated level — the three states below are
 * genuinely different facts rather than one state with a fallback:
 *
 *   · no catalogue at all, so there is nothing to work toward;
 *   · everything already earned;
 *   · a real next threshold, with a real distance to it.
 */
export function MilestonePanel({ badges, onViewJourney, delay }: MilestonePanelProps) {
  const earned = badges.filter(b => b.badge_level !== null).length

  const action = (
    <button type="button" className="vsx-btn vsx-btn-quiet vsx-btn-sm" onClick={onViewJourney}>
      Your journey
    </button>
  )

  if (badges.length === 0) {
    return (
      <Panel title="Next milestone" delay={delay}>
        <p className="vsx-meta" style={{ fontSize: 13.5 }}>
          No values are configured yet, so there is no badge to work toward.
        </p>
      </Panel>
    )
  }

  const target = nextMilestoneOf(badges)

  if (!target) {
    return (
      <Panel title="Next milestone" delay={delay} action={action}>
        <p className="vsx-fig" style={{ fontSize: 30, color: 'var(--vsx-red)' }}>
          All earned
        </p>
        <p className="vsx-meta" style={{ marginTop: 8, fontSize: 13.5 }}>
          You hold the highest badge in every value.
        </p>
      </Panel>
    )
  }

  const threshold = target.next_threshold ?? 0
  const count = target.recognition_count
  const remaining = Math.max(0, threshold - count)
  const pct = threshold > 0 ? Math.min(100, (count / threshold) * 100) : 0
  const tone = valueTone(target.core_value_slug || target.core_value_name)

  return (
    <Panel title="Next milestone" delay={delay} action={action}>
      <p
        className="vsx-fig"
        style={{ fontSize: 'clamp(26px, 3vw, 34px)', lineHeight: 1.05 }}
      >
        {target.next_badge_name}
      </p>

      <span
        className="vsx-data-pill"
        style={{
          ['--tone' as string]: tone,
          marginTop: 12,
          alignSelf: 'flex-start',
          padding: '5px 14px',
          fontSize: 12.5,
        }}
      >
        {target.core_value_name}
      </span>

      {/*
        A measured track. The sentence below states the same fact, so the
        track itself is decorative and the progressbar role sits on the
        wrapper with an explicit text value — read once, not twice.
      */}
      <div
        style={{ marginTop: 18 }}
        role="progressbar"
        aria-valuenow={count}
        aria-valuemin={0}
        aria-valuemax={threshold}
        aria-valuetext={`${count} of ${threshold} recognitions toward ${target.next_badge_name}`}
      >
        <div className="vsx-track" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>

      <p style={{ fontSize: 13.5, color: 'var(--vsx-text-2)', marginTop: 12, lineHeight: 1.55 }}>
        <span className="vsx-fig" style={{ fontSize: 15 }}>{count}</span>
        {' of '}
        <span className="vsx-fig" style={{ fontSize: 15 }}>{threshold}</span>
        {remaining === 0
          ? ' — awarded once your latest recognition is approved.'
          : `. ${remaining} more to go.`}
      </p>

      {earned > 0 && (
        <p className="vsx-meta" style={{ fontSize: 12.5, marginTop: 'auto', paddingTop: 14 }}>
          <span className="vsx-fig" style={{ fontSize: 14, color: 'var(--vsx-red)' }}>
            {earned}
          </span>
          {earned === 1 ? ' badge earned so far.' : ' badges earned so far.'}
        </p>
      )}
    </Panel>
  )
}
