import { Panel } from './Panel'
import { currentAnnualPeriod } from '@/lib/date-utils'

interface YearPanelProps {
  /** Twelve counts, index 0 = the month the annual period opens in. */
  monthlyReceived: number[]
  monthlyGiven: number[]
  delay?: number
}

const INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

/**
 * The year, as twelve columns of capsules.
 *
 * Each month stacks what came in (lime) over what went out (orange), sized
 * by count, on a dashed guide. Nowhere else in the product can somebody see
 * the RHYTHM of their recognition rather than its total — a quiet month and
 * a good month look different from across the room.
 *
 * Only real counts. A month with nothing shows a hollow ring rather than
 * being skipped, because an empty month is part of the shape of a year and
 * dropping it would compress the axis into a lie. Capsules are sized against
 * the person's own peak month, and the figure is printed inside every
 * capsule tall enough to hold it, so the size is the impression and the
 * number is the fact.
 */
export function YearPanel({ monthlyReceived, monthlyGiven, delay }: YearPanelProps) {
  const { start } = currentAnnualPeriod()
  const startDate = new Date(start)
  const startMonth = startDate.getMonth()

  const now = new Date()
  const nowOffset =
    (now.getFullYear() - startDate.getFullYear()) * 12 + (now.getMonth() - startDate.getMonth())

  const peak = Math.max(...monthlyReceived, ...monthlyGiven, 0)

  const totalReceived = monthlyReceived.reduce((s, n) => s + n, 0)
  const totalGiven = monthlyGiven.reduce((s, n) => s + n, 0)

  /* 30px is one full circle; a busier month grows from there. */
  const heightOf = (count: number) => (peak > 0 ? 30 + (count / peak) * 42 : 30)

  const months = Array.from({ length: 12 }, (_, i) => ({
    received: monthlyReceived[i] ?? 0,
    given: monthlyGiven[i] ?? 0,
    initial: INITIALS[(startMonth + i) % 12],
    isNow: i === nowOffset,
  }))

  const capsule = (count: number, background: string) => {
    if (count === 0) return null
    const height = heightOf(count)
    return (
      <span className="vsx-capsule" style={{ height, background }}>
        {height >= 24 ? count : ''}
      </span>
    )
  }

  return (
    <Panel title="Your year" delay={delay}>
      {/*
        `items-stretch`, not `items-end`. Each column has to be the FULL
        height of the chart for its dashed guide to be the full height of the
        chart — with shrink-to-fit columns the guides were only as tall as
        the capsules sitting on them, which made them invisible and left the
        capsules floating in space. The capsules themselves still sit on the
        floor, via justify-content on the column.
      */}
      <div
        className="flex"
        style={{ height: 150, gap: 'clamp(3px, 0.6vw, 8px)', alignItems: 'stretch' }}
        aria-hidden="true"
      >
        {months.map((m, i) => (
          <span
            key={i}
            className="vsx-month"
            title={`${m.initial}: ${m.received} received, ${m.given} given`}
          >
            {capsule(m.received, 'var(--vsx-red)')}
            {capsule(m.given, 'var(--vsx-silver)')}
            {m.received === 0 && m.given === 0 && <span className="vsx-capsule-empty" />}
          </span>
        ))}
      </div>

      <div
        className="flex items-end"
        style={{ gap: 'clamp(3px, 0.6vw, 8px)', marginTop: 12 }}
        aria-hidden="true"
      >
        {months.map((m, i) => (
          <span
            key={i}
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: 'center',
              fontFamily: 'var(--vsx-display)',
              fontSize: 13,
              fontWeight: 700,
              color: m.isNow ? 'var(--vsx-text)' : 'var(--vsx-text-3)',
            }}
          >
            {m.initial}
          </span>
        ))}
      </div>

      {/*
        The legend, and the accessible statement of the same facts. The
        capsules are decorative and hidden from assistive technology; this
        line is what a screen reader gets, and it is also what a sighted
        reader reads when they want the number rather than the shape.
      */}
      <div
        className="flex flex-wrap items-center"
        style={{ gap: '10px 20px', marginTop: 18 }}
      >
        <span className="flex items-center" style={{ gap: 7 }}>
          <span
            aria-hidden="true"
            className="vsx-dot"
            style={{ ['--tone' as string]: 'var(--vsx-red)' }}
          />
          <span style={{ fontSize: 12.5, color: 'var(--vsx-text-2)' }}>Received</span>
        </span>
        <span className="flex items-center" style={{ gap: 7 }}>
          <span
            aria-hidden="true"
            className="vsx-dot"
            style={{ ['--tone' as string]: 'var(--vsx-silver)' }}
          />
          <span style={{ fontSize: 12.5, color: 'var(--vsx-text-2)' }}>Given</span>
        </span>

        <p className="vsx-meta ml-auto" style={{ fontSize: 12.5 }}>
          {totalReceived === 0 && totalGiven === 0
            ? 'No recognition recorded this period yet.'
            : `${totalReceived} received and ${totalGiven} given this period.`}
        </p>
      </div>
    </Panel>
  )
}
