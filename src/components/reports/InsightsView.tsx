import { useState } from 'react'
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, Award, ChevronDown, Info, ListChecks,
  Sparkles, Target, ThumbsUp, TrendingUp,
} from 'lucide-react'
import type { ReportInsight } from '@/lib/api'
import type { GlanceStat, ReportGlance } from '@/lib/report-glance'

/*
  The AI interpretation, laid out to be read at a glance.

    headline              the one takeaway, big
    at a glance           verified figures — counted by the database, not the AI
    core values | notes   a bar chart of where recognition landed, beside the
                          AI's short notes on the pattern and badges
    three cards           going well · worth a look · suggested next steps
    keep in mind          the data's limits, folded away

  Colour is deliberately quiet. The page has never coloured a number as good or
  bad — a quieter month is not a failing one — so the three cards are told
  apart by icon and title, and every bar is the one accent hue.
*/

/** Show this many list items before "Show more". */
const LIST_PREVIEW = 3

/** The first sentence of a paragraph, and whatever follows it. */
function splitFirstSentence(text: string): [string, string] {
  const t = text.trim()
  const m = t.match(/^(.+?[.!?])\s+(.*)$/s)
  return m ? [m[1], m[2]] : [t, '']
}

/**
 * Bold the figures in a sentence, so an eye skimming it lands on the numbers.
 * Leaves digits that are part of a word or a date (2026-09-01) alone.
 */
function withFigures(text: string): React.ReactNode {
  const parts = text.split(/((?<![\w\-/.])\d+(?:\.\d+)?%?(?![\w\-/]))/g)
  return parts.map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part))
}

// ── Figures ─────────────────────────────────────────────────

function Sparkline({ values, label }: { values: number[]; label: string }) {
  const w = 88
  const h = 30
  // Inset by the end dot's radius, so the dot is never cut off at an edge.
  const pad = 4
  const max = Math.max(1, ...values)
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0
  const pts = values.map((v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)] as const)
  const last = pts[pts.length - 1]

  return (
    <svg className="ri-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <title>{label}</title>
      <polyline
        points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {last && <circle cx={last[0]} cy={last[1]} r={3} fill="currentColor" />}
    </svg>
  )
}

function StatTile({ stat, periodWord }: { stat: GlanceStat; periodWord: string }) {
  const d = stat.delta
  const DeltaIcon = d === undefined || d === null ? null : d > 0 ? ArrowUpRight : d < 0 ? ArrowDownRight : ArrowRight

  return (
    <div className="ri-stat">
      <div className="ri-stat-top">
        <span className="ri-stat-value">{stat.value}</span>
        {stat.spark && stat.spark.length > 1 && (
          <Sparkline values={stat.spark} label={`${stat.label} over the period: ${stat.spark.join(', ')}`} />
        )}
      </div>
      <span className="ri-stat-label">{stat.label}</span>
      {/* A change, stated as a change — neutral ink, never green-good / red-bad. */}
      {DeltaIcon && d !== null && d !== undefined && (
        <span className="ri-stat-delta">
          <DeltaIcon size={13} aria-hidden="true" />
          {d === 0 ? `Same as last ${periodWord}` : `${d > 0 ? '+' : ''}${d} vs last ${periodWord}`}
        </span>
      )}
      {stat.note && <span className="ri-stat-delta">{stat.note}</span>}
    </div>
  )
}

/**
 * Where recognition landed, one bar per core value.
 *
 * One hue for every bar: the values are the rows, and their names say which is
 * which, so colour has no identity job to do. A value with nothing recorded is
 * an empty track and says so, which is the gap a reader most needs to see.
 */
function CoreValueBars({ values }: { values: ReportGlance['values'] }) {
  const total = values.reduce((n, v) => n + v.count, 0)
  const max = Math.max(1, ...values.map(v => v.count))

  if (values.length === 0) {
    return <p className="ri-muted">No core values are configured.</p>
  }

  return (
    <ul className="ri-bars" aria-label="Recognitions by core value">
      {values.map(v => {
        const share = total > 0 ? Math.round((v.count / total) * 100) : 0
        const label = v.count === 0
          ? `${v.name}: none yet`
          : `${v.name}: ${v.count} recognition${v.count === 1 ? '' : 's'} (${share}%)`
        return (
          <li key={v.name} className="ri-bar-row" title={label} aria-label={label}>
            <span className="ri-bar-name">{v.name}</span>
            <span className="ri-bar-track" aria-hidden="true">
              {v.count > 0 && (
                <span className="ri-bar-fill" style={{ width: `${Math.max(4, (v.count / max) * 100)}%` }} />
              )}
            </span>
            <span className={v.count > 0 ? 'ri-bar-count' : 'ri-bar-count ri-bar-none'} aria-hidden="true">
              {v.count > 0 ? v.count : 'None yet'}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

// ── Commentary ──────────────────────────────────────────────

function InsightCard({ icon: Icon, title, items, empty, numbered = false }: {
  icon: typeof ThumbsUp
  title: string
  items: string[]
  empty: string
  numbered?: boolean
}) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, LIST_PREVIEW)
  const hidden = items.length - shown.length

  return (
    <section className="ri-card" aria-label={title}>
      <header className="ri-card-head">
        <span className="ri-card-icon" aria-hidden="true"><Icon size={15} /></span>
        <h4 className="ri-card-title">{title}</h4>
      </header>

      {items.length === 0 ? (
        <p className="ri-muted">{empty}</p>
      ) : (
        <ol className={numbered ? 'ri-list ri-list-numbered' : 'ri-list'}>
          {shown.map((t, i) => (
            <li key={i}>
              <span className="ri-list-mark" aria-hidden="true">{numbered ? i + 1 : ''}</span>
              <span>{withFigures(t)}</span>
            </li>
          ))}
        </ol>
      )}

      {(hidden > 0 || all) && items.length > LIST_PREVIEW && (
        <button type="button" className="ri-more" onClick={() => setAll(a => !a)}>
          {all ? 'Show less' : `Show ${hidden} more`}
        </button>
      )}
    </section>
  )
}

function Note({ icon: Icon, title, text }: { icon: typeof TrendingUp; title: string; text: string }) {
  if (!text || text === 'Not reported.') return null
  return (
    <div className="ri-note">
      <span className="ri-note-icon" aria-hidden="true"><Icon size={14} /></span>
      <div>
        <p className="ri-note-title">{title}</p>
        <p className="ri-note-text">{withFigures(text)}</p>
      </div>
    </div>
  )
}

// ── The view ────────────────────────────────────────────────

export function InsightsView({ insight, glance, periodWord, footer }: {
  insight: ReportInsight
  glance: ReportGlance
  /** "month", "quarter" or "year". */
  periodWord: string
  footer: React.ReactNode
}) {
  // Interpretations cached before the headline existed lead with the
  // summary's first sentence instead, and do not then repeat it.
  const [first, rest] = splitFirstSentence(insight.summary)
  const headline = insight.headline?.trim() || first
  const summary = insight.headline?.trim() ? insight.summary : rest

  const limits = insight.evidence_limitations

  return (
    <div className="ri-root">
      {/* ---- Headline ---- */}
      <div className="ri-hero">
        <span className="ri-hero-icon" aria-hidden="true"><Sparkles size={17} /></span>
        <div className="min-w-0">
          <p className="ri-headline">{headline}</p>
          {summary && <p className="ri-summary">{withFigures(summary)}</p>}
        </div>
      </div>

      {/* ---- Verified figures ---- */}
      <section aria-labelledby="ri-glance-title">
        <p id="ri-glance-title" className="ri-kicker">
          At a glance <span className="ri-kicker-aside">· counted from the report, not generated</span>
        </p>
        <div className="ri-stats">
          {glance.stats.map(s => <StatTile key={s.label} stat={s} periodWord={periodWord} />)}
        </div>
      </section>

      {/* ---- Where recognition landed, and what the AI makes of it ---- */}
      <div className="ri-split">
        <section className="ri-panel" aria-labelledby="ri-values-title">
          <p id="ri-values-title" className="ri-kicker">Core values</p>
          <CoreValueBars values={glance.values} />
          {insight.core_value_insights && insight.core_value_insights !== 'Not reported.' && (
            <p className="ri-panel-note">{withFigures(insight.core_value_insights)}</p>
          )}
        </section>

        <div className="ri-notes">
          <Note icon={TrendingUp} title={`Over the ${periodWord}`} text={insight.recognition_pattern} />
          <div className="ri-note-group">
            <Note icon={Award} title="Badges" text={insight.badge_summary} />
            {glance.badges && glance.badges.length > 0 && (
              <ul className="ri-badges" aria-label="Badges held">
                {glance.badges.map(b => (
                  <li key={b.coreValue} className="ri-badge" title={`${b.name} (level ${b.level}) in ${b.coreValue}`}>
                    <span className="ri-badge-level">L{b.level}</span>
                    {b.name} · {b.coreValue}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* ---- The interpretation, in three piles ---- */}
      <div className="ri-cards">
        <InsightCard
          icon={ThumbsUp}
          title="Going well"
          items={insight.strengths}
          empty="Nothing in this report stands out yet."
        />
        <InsightCard
          icon={Target}
          title="Worth a look"
          items={insight.development_opportunities}
          empty="No gaps stand out in this report."
        />
        <InsightCard
          icon={ListChecks}
          title="Suggested next steps"
          items={insight.recommendations}
          empty="No specific actions suggested."
          numbered
        />
      </div>

      {/* ---- The data's limits: worth knowing, not worth leading with ---- */}
      {limits.length > 0 && <Limits items={limits} />}

      {footer}
    </div>
  )
}

function Limits({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="ri-limits">
      <button
        type="button"
        className="ri-limits-toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <Info size={14} aria-hidden="true" />
        <span>Keep in mind: {items.length} limit{items.length === 1 ? '' : 's'} of this data</span>
        <ChevronDown size={15} aria-hidden="true" className="ri-limits-chevron" data-open={open || undefined} />
      </button>
      {open && (
        <ul className="ri-limits-list">
          {items.map((t, i) => <li key={i}>{withFigures(t)}</li>)}
        </ul>
      )}
    </div>
  )
}
