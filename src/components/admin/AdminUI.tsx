import React from 'react'
import { ArrowUpRight } from 'lucide-react'
import { adminValueTone } from '@/lib/admin-value-tone'

/**
 * The parts the administrative dashboards are built from.
 *
 * One file, because these are a SYSTEM rather than a collection: a metric
 * card, a panel, a list row, a bar band and a gauge, each written once so the
 * Manager, HR and Super Admin dashboards cannot drift apart. The styling
 * lives in admin-theme.css under the ad- prefix; this file decides structure
 * and semantics only.
 *
 * Two rules run through all of it:
 *
 * · Every figure shown is READ, never derived for effect. A card that has no
 *   figure says so; it does not show a zero dressed as a result.
 * · The accent red marks the one thing on a screen worth looking at first. `featured`
 *   is therefore a decision about the ROLE, not about the number — the
 *   Manager's is the approval queue, HR's is the organisation's total.
 */

/* ── Panel ──────────────────────────────────────────────────────────────── */

interface PanelProps {
  title?: string
  sub?: string
  /** A control in the panel head — a filter, a "view all" link. */
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  /** Labels the section for assistive technology when there is no title. */
  label?: string
}

export function Panel({ title, sub, action, children, className, style, label }: PanelProps) {
  return (
    <section
      className={['ad-card', className].filter(Boolean).join(' ')}
      style={style}
      aria-label={label ?? title}
    >
      {(title || action) && (
        <div className="ad-card-head">
          <div style={{ minWidth: 0 }}>
            {title && <h2 className="ad-card-title">{title}</h2>}
            {sub && <p className="ad-card-sub">{sub}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/* ── Metric card ────────────────────────────────────────────────────────── */

interface StatCardProps {
  label: string
  /** Already formatted. A string renders at text size, a number at figure size. */
  value: number | string
  /** The one card per screen that the role opened the page to read. */
  featured?: boolean
  /** A short true statement about the figure. Never a projection. */
  foot?: string
  /** A small figure beside the footnote — a count, a share. */
  chip?: string
  onClick?: () => void
  /** Where the arrow goes, for the accessible name. */
  goesTo?: string
}

export function StatCard({
  label, value, featured = false, foot, chip, onClick, goesTo,
}: StatCardProps) {
  const Tag = onClick ? 'button' : 'div'
  const isText = typeof value === 'string'

  return (
    <Tag
      className={['ad-stat', featured && 'ad-stat-featured'].filter(Boolean).join(' ')}
      onClick={onClick}
      {...(onClick
        ? { type: 'button' as const, 'aria-label': `${label}: ${value}.${goesTo ? ` Opens ${goesTo}.` : ''}` }
        : {})}
    >
      {/* Spans throughout, not paragraphs: a card is often a <button>, and a
          button may only contain phrasing content. */}
      <span className="ad-stat-top">
        <span className="ad-stat-label">{label}</span>
        {onClick && (
          <span className="ad-stat-arrow" aria-hidden="true">
            <ArrowUpRight size={15} strokeWidth={2} />
          </span>
        )}
      </span>

      <span style={{ display: 'block' }}>
        <span
          className={['ad-stat-value', isText && 'ad-stat-value-text'].filter(Boolean).join(' ')}
          style={{ display: 'block' }}
        >
          {value}
        </span>
        {(foot || chip) && (
          <span className="ad-stat-foot" style={{ marginTop: 10 }}>
            {chip && <span className="ad-chip">{chip}</span>}
            {foot && <span>{foot}</span>}
          </span>
        )}
      </span>
    </Tag>
  )
}

/* ── List row ───────────────────────────────────────────────────────────── */

interface RowProps {
  /** An avatar, a coloured mark, an icon. */
  lead?: React.ReactNode
  title: string
  sub?: string
  /** A status chip, a figure, a control. */
  trail?: React.ReactNode
  onClick?: () => void
}

export function Row({ lead, title, sub, trail, onClick }: RowProps) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      className="ad-row"
      onClick={onClick}
      {...(onClick ? { type: 'button' as const } : {})}
    >
      {lead}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="ad-row-title" style={{ display: 'block' }}>{title}</span>
        {sub && <span className="ad-row-sub" style={{ display: 'block' }}>{sub}</span>}
      </span>
      {trail}
    </Tag>
  )
}

/* ── Avatar ─────────────────────────────────────────────────────────────── */

export function AdminAvatar({
  name, avatarUrl, size = 'md',
}: {
  name: string
  avatarUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
}) {
  const initials = name
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <span
      className={['ad-avatar', size === 'sm' && 'ad-avatar-sm', size === 'lg' && 'ad-avatar-lg']
        .filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      {avatarUrl ? <img src={avatarUrl} alt="" /> : (initials || '?')}
    </span>
  )
}

/* ── Core Value pill ────────────────────────────────────────────────────── */

export function ValuePill({ name, slug }: { name: string; slug?: string | null }) {
  return (
    <span
      className="ad-value"
      style={{ ['--tone' as string]: adminValueTone(slug || name) }}
      title={`Core Value: ${name}`}
    >
      {name}
    </span>
  )
}

/* ── Status chip ────────────────────────────────────────────────────────── */

export function Status({ tone, children }: { tone: 'ok' | 'wait' | 'idle'; children: React.ReactNode }) {
  return <span className={`ad-status ad-status-${tone}`}>{children}</span>
}

/* ── The bar band ───────────────────────────────────────────────
   A short series of counts, drawn as capsules on one baseline.

   Written by hand rather than with the chart library, for the shape: a true
   stadium — semicircular at both ends — which a Bar with a radius array does
   not give, and a period with NOTHING in it drawn as a hatched capsule rather
   than as a missing bar. A quiet day is a reading, and it has to look like
   one.

   Height carries magnitude and each bar is labelled with its figure. Colour
   tells the days apart: each takes its own step of the red ramp, lightest to
   darkest across the period, so the most recent day is the deepest. A zero is
   hatched grey and wears no accent at all. There is never a second series,
   and nothing is stacked. */
export interface BandPoint {
  label: string
  value: number
  /** The full label, for the title attribute and the screen reader. */
  full?: string
}

/** The red ramp's steps, lightest first — one per day of a week. */
const BAND_SHADES = [300, 400, 500, 600, 700, 800, 900] as const

export function BarBand({
  data, height = 190, unit = 'recognitions',
}: {
  data: BandPoint[]
  height?: number
  unit?: string
}) {
  const max = Math.max(...data.map(d => d.value), 1)
  const anyValue = data.some(d => d.value > 0)
  // "1 recognition", not "1 recognitions", in the hover text.
  const unitOf = (n: number) => (n === 1 ? unit.replace(/s$/, '') : unit)

  /* A day's shade: its position spread across the seven steps of the ramp.
     A week lands on one step per day; a longer or shorter band still runs
     from the lightest to the darkest. */
  const shadeOf = (i: number): string => {
    const step = data.length > 1 ? Math.round((i * (BAND_SHADES.length - 1)) / (data.length - 1)) : BAND_SHADES.length - 1
    return `var(--ad-a-${BAND_SHADES[step]})`
  }

  return (
    <div
      className="ad-band"
      style={{ height }}
      role="img"
      aria-label={
        anyValue
          ? `${unit} across ${data.length} periods. ` +
            data.map(d => `${d.full ?? d.label}: ${d.value}`).join(', ')
          : `No ${unit} recorded in this period.`
      }
    >
      {data.map((d, i) => {
        const isPeak = anyValue && d.value === max
        /*
          The share of the tallest, drawn into 80% of the slot.

          The headroom is what the chips float in. The peak is by definition
          the full height, so at 100% its label would be pushed outside the
          panel and land on the title above; reserving the top fifth keeps the
          figure inside the card no matter which day wins the week. The
          capsule's own floor is in CSS — below one bar width a stadium
          collapses into a lozenge and the row stops reading as a series.
        */
        const pct = (d.value / max) * 80

        /*
          Every bar with a count carries its figure. Only the peak used to,
          so a day tied with it, or any quieter day, could only be read by
          hovering. A short bar sits on its CSS floor rather than at pct, so
          its chip is placed above that floor instead of inside the capsule.
        */
        const top = `max(${pct}%, var(--ad-band-floor))`

        return (
          <div className="ad-band-col" key={`${d.label}-${i}`}>
            <div className="ad-band-slot">
              {d.value > 0 && (
                <span className="ad-band-chip" style={{ bottom: `calc(${top} + 10px)` }}>
                  {d.value}
                </span>
              )}
              {isPeak && (
                <span className="ad-band-pin" style={{ bottom: `calc(${top} - 5px)` }} aria-hidden="true" />
              )}
              <div
                className={`ad-band-bar ${d.value === 0 ? 'ad-band-bar-empty' : 'ad-band-bar-day'}`}
                style={{
                  height: `${pct}%`,
                  ...(d.value > 0 ? { '--ad-band-tone': shadeOf(i) } as React.CSSProperties : {}),
                }}
                title={`${d.full ?? d.label}: ${d.value} ${unitOf(d.value)}`}
              />
            </div>
            <span className="ad-band-label">{d.label}</span>
          </div>
        )
      })}
    </div>
  )
}

/* ── The gauge ───────────────────────────────────────────────────────────
   One share, as an arc. 270° of sweep so the reading has room to breathe,
   drawn with a round cap and a ruled ground behind it — a 0% gauge still
   reads as measured rather than broken. */
export function Gauge({
  value, caption, legend,
}: {
  /** 0-100. Clamped, because a percentage above 100 is a bug worth hiding. */
  value: number
  caption: string
  legend?: Array<{ label: string; color: string }>
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))

  /* A 3/4 circle, opening at the bottom. r=54 in a 140x140 box. */
  const r = 54
  const circumference = 2 * Math.PI * r
  const sweep = 0.75
  const track = circumference * sweep
  const dash = track * (pct / 100)

  return (
    <div className="ad-gauge">
      <div className="ad-gauge-wrap">
        <svg viewBox="0 0 140 140" style={{ width: '100%', display: 'block' }} aria-hidden="true">
          <g transform="rotate(135 70 70)">
            <circle
              cx="70" cy="70" r={r}
              fill="none"
              stroke="var(--ad-inset)"
              strokeWidth="16"
              strokeLinecap="round"
              strokeDasharray={`${track} ${circumference}`}
            />
            <circle
              cx="70" cy="70" r={r}
              fill="none"
              stroke="url(#ad-gauge-fill)"
              strokeWidth="16"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              style={{ transition: 'stroke-dasharray 640ms cubic-bezier(0.22, 0.61, 0.36, 1)' }}
            />
          </g>
          <defs>
            <linearGradient id="ad-gauge-fill" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%"   stopColor="var(--ad-a-400)" />
              <stop offset="100%" stopColor="var(--ad-a-700)" />
            </linearGradient>
          </defs>
        </svg>

        <div className="ad-gauge-read">
          <p className="ad-gauge-value">{pct}%</p>
          <p className="ad-gauge-label">{caption}</p>
        </div>
      </div>

      {legend && legend.length > 0 && (
        <div className="ad-legend">
          {legend.map(l => (
            <span key={l.label} className="ad-legend-item">
              <span className="ad-legend-dot" style={{ background: l.color }} aria-hidden="true" />
              {l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Empty ──────────────────────────────────────────────────────────────── */

export function Empty({ title, text }: { title: string; text?: string }) {
  return (
    <div className="ad-empty">
      <p className="ad-empty-title">{title}</p>
      {text && <p className="ad-empty-text">{text}</p>}
    </div>
  )
}

/* ── Loading ────────────────────────────────────────────────────────────── */

export function StatSkeleton() {
  return (
    <div className="ad-stat" aria-hidden="true">
      <div className="ad-skeleton" style={{ height: 14, width: '55%' }} />
      <div>
        <div className="ad-skeleton" style={{ height: 34, width: '40%' }} />
        <div className="ad-skeleton" style={{ height: 11, width: '70%', marginTop: 12 }} />
      </div>
    </div>
  )
}

export function BlockSkeleton({ height = 160 }: { height?: number }) {
  return <div className="ad-skeleton" style={{ height }} aria-hidden="true" />
}

export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="ad-list" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="ad-row" style={{ gap: 12 }}>
          <div className="ad-skeleton" style={{ width: 34, height: 34, borderRadius: 999 }} />
          <div style={{ flex: 1 }}>
            <div className="ad-skeleton" style={{ height: 12, width: '45%' }} />
            <div className="ad-skeleton" style={{ height: 10, width: '30%', marginTop: 7 }} />
          </div>
        </div>
      ))}
    </div>
  )
}
