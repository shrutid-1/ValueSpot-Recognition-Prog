import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { Panel } from './Panel'

interface SummaryPanelProps {
  received: number
  given: number
  thisMonth: number
  /** Twelve months of the annual period, index 0 = the month it opens in. */
  monthlyReceived: number[]
  monthlyGiven: number[]
  delay?: number
}

/** A twelve-point line. Returns null when there is nothing to draw. */
function seriesPath(values: number[], peak: number): string | null {
  if (values.length === 0) return null
  const step = 120 / Math.max(values.length - 1, 1)
  return values
    .map((v, i) => {
      const x = i * step
      const y = peak > 0 ? 38 - (v / peak) * 33 : 38
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

/**
 * Recognition received and given, with the shape of the year behind them.
 *
 * Two figures and two lines. Lime is what came to this person, orange is what
 * they sent — the same pairing used everywhere else in the portal, so the
 * colours are readable here without a legend being consulted.
 *
 * The lines are the real monthly series from the annual period, bucketed in
 * the API layer. When nothing has happened they are not drawn at all: a flat
 * line along the floor of a chart reads as "measured zero every month", which
 * for somebody in their first week is a different and wronger statement than
 * "nothing yet".
 */
export function SummaryPanel({
  received,
  given,
  thisMonth,
  monthlyReceived,
  monthlyGiven,
  delay,
}: SummaryPanelProps) {
  const peak = Math.max(...monthlyReceived, ...monthlyGiven, 0)
  const hasSeries = peak > 0

  const receivedPath = hasSeries ? seriesPath(monthlyReceived, peak) : null
  const givenPath = hasSeries ? seriesPath(monthlyGiven, peak) : null

  const figure = (
    value: number,
    label: string,
    tone: string,
    Icon: typeof ArrowUpRight,
  ) => (
    <div style={{ minWidth: 0 }}>
      <Icon size={17} aria-hidden="true" strokeWidth={2.6} style={{ color: tone }} />
      <p className="vsx-fig" style={{ fontSize: 'clamp(34px, 4vw, 44px)', marginTop: 8 }}>
        {value}
      </p>
      <p className="vsx-meta" style={{ fontSize: 13, marginTop: 5 }}>{label}</p>
    </div>
  )

  return (
    <Panel title="Recognition" delay={delay}>
      <div className="flex" style={{ gap: 28 }}>
        {figure(received, 'Received', 'var(--vsx-red)', ArrowDownLeft)}
        {figure(given, 'Given', 'var(--vsx-silver)', ArrowUpRight)}
      </div>

      {/*
        The chart GROWS into whatever height the panel has rather than being
        pushed to the bottom of it. When this panel sits beside a taller one
        in the grid, `margin-top: auto` left a dead band across its middle —
        the chart has to take that space, not step around it.
      */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          paddingTop: 22,
        }}
      >
        {hasSeries ? (
          <svg
            viewBox="0 0 120 40"
            preserveAspectRatio="none"
            style={{ display: 'block', width: '100%', flex: 1, minHeight: 74 }}
            role="img"
            aria-label={
              `Recognition by month this period. Received: ${monthlyReceived.join(', ')}. ` +
              `Given: ${monthlyGiven.join(', ')}.`
            }
          >
            {givenPath && (
              <path
                d={givenPath}
                fill="none"
                stroke="var(--vsx-silver)"
                strokeWidth={1.6}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {receivedPath && (
              <path
                d={receivedPath}
                fill="none"
                stroke="var(--vsx-red)"
                strokeWidth={1.6}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        ) : (
          <p className="vsx-meta" style={{ fontSize: 13, lineHeight: 1.55 }}>
            Nothing recorded this period yet. Once recognition starts moving,
            its shape across the year appears here.
          </p>
        )}

        <p className="vsx-meta" style={{ fontSize: 12.5, marginTop: 14 }}>
          <span className="vsx-fig" style={{ fontSize: 14 }}>{thisMonth}</span>
          {' received this month'}
        </p>
      </div>
    </Panel>
  )
}
