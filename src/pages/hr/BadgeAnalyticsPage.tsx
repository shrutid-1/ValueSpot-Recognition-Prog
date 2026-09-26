import type { ReactNode } from 'react'
import { useBadgeDistribution, useBadgeDefinitions, useCoreValues } from '@/hooks/queries'
import type { BadgeDistribution } from '@/lib/api'
import { PageHeader } from '@/components/shared/PageHeader'
import { MetricCardSkeleton, ChartSkeleton } from '@/components/shared/SkeletonLoader'
import { EmptyState } from '@/components/shared/EmptyState'
import { BADGE_LEVEL_NAMES } from '@/lib/constants'
import { currentAnnualPeriod } from '@/lib/date-utils'
import { Zap } from 'lucide-react'

/**
 * Badge Analytics, for HR.
 *
 * A badge is earned PER CORE VALUE, from the approved recognitions a person
 * receives in that value during the calendar year, and a person holds only
 * the highest level they have reached in it. None of that is visible in a
 * stacked bar of bare counts, so the page says it outright: the ladder states
 * each level's threshold, and the table puts every Core Value on its own row —
 * including the ones nobody holds a badge in yet, which is half the story.
 */

const LEVELS = [1, 2, 3, 4, 5] as const
type LevelKey = 'b1' | 'b2' | 'b3' | 'b4' | 'b5'

/*
  Five badge levels, as one ramp. Red, because the administrative portals
  are red — a chart is part of the page, not a guest on it. Light to dark
  reads as level 1 to level 5 without a legend being consulted.
*/
const BADGE_COLORS = ['#F3BCB5', '#E98F86', '#DE584D', '#C42A20', '#7C1913'] as const

const MUTED = 'var(--color-neutral-600)'
const DIVIDER = '1px solid var(--color-divider)'

function Stat({ value, label, hint }: { value: ReactNode; label: string; hint: string }) {
  return (
    <div className="vs-card" style={{ padding: 16 }}>
      <p
        className="font-condensed"
        style={{ fontSize: 34, fontWeight: 600, lineHeight: 1, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </p>
      <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', marginTop: 8 }}>{label}</p>
      <p style={{ fontSize: 12, color: MUTED, marginTop: 2, lineHeight: 1.4 }}>{hint}</p>
    </div>
  )
}

function Swatch({ level }: { level: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block', width: 10, height: 10, borderRadius: 3, flexShrink: 0,
        background: BADGE_COLORS[level - 1],
      }}
    />
  )
}

function CardHead({ title, caption }: { title: string; caption: string }) {
  return (
    <div style={{ padding: '16px 18px 12px', borderBottom: DIVIDER }}>
      <h3 className="font-condensed" style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
        {title}
      </h3>
      <p style={{ fontSize: 13, color: MUTED, marginTop: 4, lineHeight: 1.5, maxWidth: 720 }}>{caption}</p>
    </div>
  )
}

export default function BadgeAnalyticsPage() {
  const badgeDistribution = useBadgeDistribution()
  const definitionsQuery = useBadgeDefinitions()
  const coreValuesQuery = useCoreValues()

  const summary = badgeDistribution.data?.summary ?? null
  const dist = badgeDistribution.data?.distribution ?? []
  const loading = badgeDistribution.isPending || coreValuesQuery.isPending

  const year = currentAnnualPeriod().start.slice(0, 4)

  // Every active Core Value gets a row, badge or not, in its configured order.
  // A value that holds badges but has since been deactivated is kept at the
  // end, so the table still adds up to the totals above it.
  const bySlug = new Map(dist.map(d => [d.slug, d]))
  const rows: BadgeDistribution[] = (coreValuesQuery.data ?? []).map(cv =>
    bySlug.get(cv.slug) ?? { core_value_name: cv.name, slug: cv.slug, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0 },
  )
  const listed = new Set(rows.map(r => r.slug))
  for (const d of dist) if (!listed.has(d.slug)) rows.push(d)

  const rowTotal = (r: BadgeDistribution) => LEVELS.reduce((n, l) => n + r[`b${l}` as LevelKey], 0)
  const valuesWithBadge = rows.filter(r => rowTotal(r) > 0).length

  // Thresholds come from the database; the names alone are the fallback while
  // they load, so the ladder never shows an invented range.
  const defs = definitionsQuery.data ?? []
  const range = (level: number) => {
    const d = defs.find(x => x.level === level)
    if (!d) return null
    if (d.maximum_count === null) return `${d.minimum_count}+ recognitions`
    if (d.minimum_count === d.maximum_count) return `${d.minimum_count} recognition${d.minimum_count === 1 ? '' : 's'}`
    return `${d.minimum_count}–${d.maximum_count} recognitions`
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        kicker="HR Analytics"
        title="Badge Analytics"
        subtitle={`Who has earned Core Value badges in ${year}, and how far they have got. Badges are earned separately in each Core Value, from approved recognitions received between 1 January and 31 December ${year}.`}
      />

      {loading ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[...Array(3)].map((_, i) => <MetricCardSkeleton key={i} />)}
          </div>
          <div className="vs-card" style={{ padding: 16 }}><ChartSkeleton height={140} /></div>
          <div className="vs-card" style={{ padding: 16 }}><ChartSkeleton height={240} /></div>
        </>
      ) : (
        <>
          {/* ── Headline ─────────────────────────────────────── */}
          {summary && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Stat
                value={summary.employees_with_badge}
                label="Employees with a badge"
                hint="Holding at least one badge, in any Core Value."
              />
              <Stat
                value={summary.badges_held}
                label="Badges held"
                hint="One per person per Core Value, so one person can hold several."
              />
              <Stat
                value={<>{valuesWithBadge}<span style={{ fontSize: 20, color: MUTED }}> of {rows.length}</span></>}
                label="Core Values with a badge holder"
                hint="Values where at least one person has earned a badge."
              />
            </div>
          )}

          {/* ── The ladder ───────────────────────────────────── */}
          <div className="vs-card">
            <CardHead
              title="How badges are earned"
              caption="Each approved recognition someone receives in a Core Value moves them up that value's ladder. They hold only the level they have reached: four recognitions in a value is an Applause badge, not a Cheers and an Applause."
            />
            <ol
              className="grid grid-cols-1 sm:grid-cols-5"
              style={{ listStyle: 'none', margin: 0, padding: 0 }}
            >
              {LEVELS.map((l, i) => {
                const held = summary?.[`b${l}` as LevelKey] ?? 0
                return (
                  <li
                    key={l}
                    style={{ padding: '14px 18px' }}
                    // Stacked on a phone, side by side from `sm` up — the rule
                    // between steps turns with the layout.
                    className={i === 0 ? undefined : 'border-t sm:border-t-0 sm:border-l border-[var(--color-divider)]'}
                  >
                    <div className="flex items-center gap-2">
                      <Swatch level={l} />
                      <span style={{ fontSize: 11, color: MUTED, fontWeight: 500, letterSpacing: '0.04em' }}>
                        LEVEL {l}
                      </span>
                    </div>
                    <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)', marginTop: 6 }}>
                      {BADGE_LEVEL_NAMES[l]}
                    </p>
                    <p style={{ fontSize: 12, color: MUTED, marginTop: 2, minHeight: 16 }}>
                      {range(l) ?? ' '}
                    </p>
                    <p style={{ fontSize: 13, color: 'var(--color-text)', marginTop: 10 }}>
                      <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{held}</strong>
                      <span style={{ color: MUTED }}> held</span>
                    </p>
                  </li>
                )
              })}
            </ol>
          </div>

          {/* ── By Core Value ────────────────────────────────── */}
          <div className="vs-card">
            <CardHead
              title="Badges by Core Value"
              caption="Each number is how many employees hold that badge in that Core Value. A dash means nobody has reached that level in it yet."
            />

            {!summary || summary.badges_held === 0 ? (
              <EmptyState
                icon={<Zap size={36} />}
                title={`No badges earned in ${year} yet`}
                description="A badge appears as soon as someone's first recognition in a Core Value is approved."
                className="py-10"
              />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720, tableLayout: 'fixed' }}>
                  {/* Equal level columns, so a longer name like "Value
                      Ambassador" does not pull its column wider than the rest. */}
                  <colgroup>
                    <col style={{ width: '24%' }} />
                    {LEVELS.map(l => <col key={l} style={{ width: '13%' }} />)}
                    <col style={{ width: '11%' }} />
                  </colgroup>
                  <thead>
                    <tr style={{ borderBottom: DIVIDER }}>
                      <th scope="col" style={{ textAlign: 'left', padding: '10px 18px', fontWeight: 500, color: MUTED }}>
                        Core Value
                      </th>
                      {LEVELS.map(l => (
                        <th key={l} scope="col" style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 500, color: MUTED, whiteSpace: 'nowrap' }}>
                          <span className="inline-flex items-center gap-1.5">
                            <Swatch level={l} />
                            {BADGE_LEVEL_NAMES[l]}
                          </span>
                        </th>
                      ))}
                      <th scope="col" style={{ textAlign: 'right', padding: '10px 18px', fontWeight: 600, color: 'var(--color-text)' }}>
                        Total
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {rows.map(r => {
                      const total = rowTotal(r)
                      return (
                        <tr key={r.slug} style={{ borderBottom: DIVIDER }}>
                          <th
                            scope="row"
                            style={{ textAlign: 'left', padding: '11px 18px', fontWeight: 500, color: total ? 'var(--color-text)' : MUTED }}
                          >
                            {r.core_value_name}
                          </th>
                          {LEVELS.map(l => {
                            const n = r[`b${l}` as LevelKey]
                            return (
                              <td
                                key={l}
                                title={n ? `${n} ${n === 1 ? 'employee holds' : 'employees hold'} ${BADGE_LEVEL_NAMES[l]} in ${r.core_value_name}` : undefined}
                                style={{
                                  textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums',
                                  color: n ? 'var(--color-text)' : MUTED,
                                  fontWeight: n ? 600 : 400,
                                }}
                              >
                                {n || '–'}
                              </td>
                            )
                          })}
                          <td style={{ textAlign: 'right', padding: '11px 18px', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: total ? 'var(--color-text)' : MUTED }}>
                            {total || '–'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>

                  <tfoot>
                    <tr>
                      <th scope="row" style={{ textAlign: 'left', padding: '11px 18px', fontWeight: 600, color: 'var(--color-text)' }}>
                        All Core Values
                      </th>
                      {LEVELS.map(l => (
                        <td key={l} style={{ textAlign: 'right', padding: '11px 12px', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--color-text)' }}>
                          {summary[`b${l}` as LevelKey]}
                        </td>
                      ))}
                      <td style={{ textAlign: 'right', padding: '11px 18px', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--color-text)' }}>
                        {summary.badges_held}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
