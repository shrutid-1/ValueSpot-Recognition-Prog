import { useMemo, useState } from 'react'
import { useCoreValues, useCoreValueLeaders } from '@/hooks/queries'
import type { CoreValueLeaders } from '@/lib/api'
import { PageHeader } from '@/components/shared/PageHeader'
import { MetricCardSkeleton } from '@/components/shared/SkeletonLoader'
import { EmptyState } from '@/components/shared/EmptyState'
import { EmployeeAvatar } from '@/components/shared/EmployeeAvatar'
import { CoreValueBadge } from '@/components/shared/CoreValueBadge'
import { BADGE_LEVEL_NAMES } from '@/lib/constants'
import type { CoreValueSlug } from '@/lib/constants'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { getFinancialQuarter, getQuarterBounds } from '@/lib/date-utils'
import { Info, Users } from 'lucide-react'

/**
 * Recognition Leaders, for HR.
 *
 * For each Core Value, whoever received the most approved recognitions in the
 * chosen period. The old cards showed "1 recognition · 1 unique · Cheers" and a
 * "Joint" tag with nothing saying what any of it meant, how a leader was
 * picked, or how big the field was. Each of those is now stated in words on
 * the page, and the values nobody was recognized in collapse to one line
 * rather than a wall of empty cards.
 */

type Tab = 'monthly' | 'quarterly' | 'annual'

const MUTED = 'var(--color-neutral-600)'
const DIVIDER = '1px solid var(--color-divider)'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** `yyyy-MM-dd` → a local date, without the UTC shift `new Date(str)` applies. */
const localDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function LeaderCardSkeleton() {
  return (
    <div className="vs-card" style={{ padding: 0 }}>
      <div style={{ padding: '10px 14px', borderBottom: DIVIDER }}>
        <MetricCardSkeleton />
      </div>
      <div style={{ padding: 14 }}>
        {[0, 1].map(i => (
          <div key={i} className="flex items-center gap-3" style={{ marginBottom: i === 0 ? 12 : 0 }}>
            <div style={{ width: 36, height: 36, background: 'var(--color-neutral-200)' }} />
            <div>
              <div style={{ height: 12, width: 120, background: 'var(--color-neutral-200)', marginBottom: 5 }} />
              <div style={{ height: 10, width: 160, background: 'var(--color-neutral-200)' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function LeaderCard({ cv }: { cv: CoreValueLeaders }) {
  const joint = cv.leaders.length > 1

  return (
    <div className="vs-card">
      <div
        className="flex items-center justify-between gap-3 flex-wrap"
        style={{ padding: '12px 16px', borderBottom: DIVIDER }}
      >
        <CoreValueBadge name={cv.core_value_name} slug={cv.slug as CoreValueSlug} size="md" />
        <span style={{ fontSize: 12, color: MUTED }}>
          {plural(cv.total_recognitions, 'recognition')} to {plural(cv.people_recognized, 'person', 'people')}
        </span>
      </div>

      <div style={{ padding: '12px 16px 14px' }}>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>
          {joint ? `Most recognized · tied between ${cv.leaders.length}` : 'Most recognized'}
        </p>

        {cv.leaders.map((l, i) => (
          <div
            key={l.employee_id}
            className="flex items-center gap-3"
            style={{
              paddingTop: i > 0 ? 12 : 0,
              marginTop: i > 0 ? 12 : 0,
              borderTop: i > 0 ? DIVIDER : 'none',
            }}
          >
            <EmployeeAvatar name={l.employee_name} avatarUrl={l.avatar_url} size="md" />
            <div className="flex-1 min-w-0">
              <p className="truncate" style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                {l.employee_name}
              </p>
              <p style={{ fontSize: 12, color: MUTED, marginTop: 2, lineHeight: 1.45 }}>
                <strong style={{ color: 'var(--color-text)', fontWeight: 600 }}>
                  {plural(l.recognition_count, 'recognition')}
                </strong>
                {' '}from {plural(l.unique_recognizer_count, 'colleague')}
              </p>
            </div>
            {l.badge_level ? (
              <span
                className="vs-tag vs-tag-neutral"
                style={{ fontSize: 11, padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}
                title={`Their badge in ${cv.core_value_name} for the year, from every recognition they have received in it so far — not only this period.`}
              >
                {BADGE_LEVEL_NAMES[l.badge_level]} badge
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function AnalyticsPage() {
  const today = new Date()
  const currentFq = getFinancialQuarter(today)
  // The financial year is named by the calendar year its April falls in.
  const currentFy = today.getMonth() + 1 >= 4 ? today.getFullYear() : today.getFullYear() - 1

  const [tab, setTab]                         = useState<Tab>('monthly')
  const [selectedMonth, setSelectedMonth]     = useState(format(today, 'yyyy-MM'))
  const [selectedQuarter, setSelectedQuarter] = useState(currentFq.quarter)
  const [selectedFy, setSelectedFy]           = useState(currentFy)
  const [selectedYear, setSelectedYear]       = useState(today.getFullYear())

  /*
    Period bounds as local calendar dates. The month used to go through
    toISOString(), which in IST turned "1 September" into "31 August" and
    quietly added a day of the previous month; the annual view ignored the
    year box entirely and always showed the current year.
  */
  const { start, end } = useMemo(() => {
    if (tab === 'monthly') {
      const d = localDate(`${selectedMonth}-01`)
      return { start: format(startOfMonth(d), 'yyyy-MM-dd'), end: format(endOfMonth(d), 'yyyy-MM-dd') }
    }
    if (tab === 'quarterly') return getQuarterBounds(selectedQuarter, selectedFy)
    return { start: `${selectedYear}-01-01`, end: `${selectedYear}-12-31` }
  }, [tab, selectedMonth, selectedQuarter, selectedFy, selectedYear])

  const periodLabel = `${format(localDate(start), 'd MMM yyyy')} – ${format(localDate(end), 'd MMM yyyy')}`

  /*
    The catalogue comes from the shared cache the wizard and the HR screens
    already fill, so changing the period no longer refetches it. The leader
    board itself is one request wave instead of three per core value.
  */
  const coreValuesQuery = useCoreValues()
  const coreValues = coreValuesQuery.data ?? []

  const leadersQuery = useCoreValueLeaders(start, end, coreValues)
  const leaderData = leadersQuery.data ?? []

  /*
    isLoading, not isPending: the leader board is disabled until the core
    values arrive, and a disabled query stays `isPending` forever — so with
    every core value archived this page held a skeleton instead of showing the
    "no recognitions" empty state.
  */
  const loading = coreValuesQuery.isLoading || leadersQuery.isLoading

  const withLeaders = leaderData.filter(cv => cv.leaders.length > 0)
  const withoutLeaders = leaderData.filter(cv => cv.leaders.length === 0)
  const totalRecognitions = leaderData.reduce((n, cv) => n + cv.total_recognitions, 0)

  const fyOptions = [currentFy - 2, currentFy - 1, currentFy, currentFy + 1]
  const quarterOptions = [1, 2, 3, 4].map(q => {
    const b = getQuarterBounds(q, selectedFy)
    return { q, label: `Q${q} · ${format(localDate(b.start), 'MMM')}–${format(localDate(b.end), 'MMM yyyy')}` }
  })

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        kicker="HR Analytics"
        title="Recognition Leaders"
        subtitle="For each Core Value, the colleague who received the most approved recognitions in the period you choose."
      />

      {/* Period controls */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="vs-seg" style={{ width: 'fit-content' }}>
          {(['monthly', 'quarterly', 'annual'] as Tab[]).map(t => (
            <button
              key={t}
              style={{
                padding: '6px 16px', fontSize: 13,
                fontFamily: 'inherit', fontWeight: 600,
                border: 'none', borderRight: DIVIDER,
                background: tab === t ? 'var(--color-accent)' : 'transparent',
                color: tab === t ? 'var(--color-bg)' : MUTED,
                cursor: 'pointer', transition: 'background 120ms, color 120ms',
                textTransform: 'capitalize',
              }}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {tab === 'monthly' && (
            <input
              type="month"
              className="vs-input"
              style={{ height: 32, fontSize: 13 }}
              value={selectedMonth}
              onChange={e => e.target.value && setSelectedMonth(e.target.value)}
              aria-label="Select month"
            />
          )}
          {tab === 'quarterly' && (
            <>
              {/* Financial year first: it decides which calendar months each
                  quarter covers, and the quarter labels spell those out. */}
              <select
                className="vs-input"
                style={{ height: 32, fontSize: 13 }}
                value={selectedFy}
                onChange={e => setSelectedFy(Number(e.target.value))}
                aria-label="Select financial year"
              >
                {fyOptions.map(y => (
                  <option key={y} value={y}>FY {y}–{String(y + 1).slice(2)}</option>
                ))}
              </select>
              <select
                className="vs-input"
                style={{ height: 32, fontSize: 13 }}
                value={selectedQuarter}
                onChange={e => setSelectedQuarter(Number(e.target.value))}
                aria-label="Select quarter"
              >
                {quarterOptions.map(o => <option key={o.q} value={o.q}>{o.label}</option>)}
              </select>
            </>
          )}
          {tab === 'annual' && (
            <input
              type="number" min={2020} max={2099}
              className="vs-input"
              style={{ height: 32, fontSize: 13, width: 88 }}
              value={selectedYear}
              onChange={e => setSelectedYear(Number(e.target.value))}
              aria-label="Select year"
            />
          )}
        </div>
      </div>

      {/* How a leader is chosen — the one rule every card depends on. */}
      <div
        className="flex items-start gap-2.5"
        style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, maxWidth: 820 }}
      >
        <Info size={15} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
        <p>
          <strong style={{ color: 'var(--color-text)', fontWeight: 600 }}>How a leader is chosen: </strong>
          the most approved recognitions in that Core Value during the period. If two people have the
          same number, the one recognized by more different colleagues comes first; anyone still level
          on both shares the top spot. The badge beside a name is their level in that Core Value for
          the whole year, not only this period.
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {[...Array(3)].map((_, i) => <LeaderCardSkeleton key={i} />)}
        </div>
      ) : withLeaders.length === 0 ? (
        <div className="vs-card">
          <EmptyState
            icon={<Users size={36} />}
            title="No approved recognitions in this period"
            description={`Nothing was approved between ${periodLabel}. Try a longer period, such as the quarter or the year.`}
            className="py-14"
          />
        </div>
      ) : (
        <>
          <p style={{ fontSize: 13, color: MUTED }}>
            <strong style={{ color: 'var(--color-text)', fontWeight: 600 }}>{periodLabel}</strong>
            {' · '}{plural(totalRecognitions, 'approved recognition')} across{' '}
            {withLeaders.length} of {leaderData.length} Core Values
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {withLeaders.map(cv => <LeaderCard key={cv.core_value_id} cv={cv} />)}
          </div>

          {withoutLeaders.length > 0 && (
            <div className="vs-card" style={{ padding: '12px 16px' }}>
              <p style={{ fontSize: 13, color: MUTED, marginBottom: 10 }}>
                No approved recognitions in this period for:
              </p>
              <div className="flex flex-wrap gap-2">
                {withoutLeaders.map(cv => (
                  <CoreValueBadge key={cv.core_value_id} name={cv.core_value_name} slug={cv.slug as CoreValueSlug} size="sm" />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
