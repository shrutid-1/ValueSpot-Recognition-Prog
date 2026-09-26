import { useMemo, useState } from 'react'
import { FileText, Download, Search, Sparkles, AlertCircle, Info, EyeOff } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import {
  useReportSubjects, useEmployeeReport, useScopedReport, useReportInsights, useReportFilterOptions,
} from '@/hooks/queries'
import {
  reportsApi, compactFilters,
  type EmployeeReport, type OrganizationReport, type ScopedReport, type ScopedReportEmployee,
  type ReportInsight, type ReportFilters, type ReportFilterOptions, type ExtractResult,
} from '@/lib/api'
import { errorMessage } from '@/lib/query'
import { PageHeader } from '@/components/shared/PageHeader'
import { CardSkeleton } from '@/components/shared/SkeletonLoader'
import { EmptyState } from '@/components/shared/EmptyState'
import { EmployeeAvatar } from '@/components/shared/EmployeeAvatar'
import { exportCSV, exportXLSX } from '@/lib/export-utils'
import { InsightsView } from '@/components/reports/InsightsView'
import { ReportFiltersPanel } from '@/components/reports/ReportFiltersPanel'
import { employeeGlance, organizationGlance, periodNoun, type ReportGlance } from '@/lib/report-glance'
import {
  describeFilters, filterSheetRows, hasRowFilters, activeFilterCount,
} from '@/lib/report-filters'
import { format } from 'date-fns'
import {
  reportPeriod, formatIST, nowIST, getFinancialQuarter,
  type ReportPeriodType, type ReportPeriod,
} from '@/lib/date-utils'

/**
 * Reports, for Managers, HR and Super Admins.
 *
 * ONE page, and the scope is not decided here. Every report on it is scoped by
 * the database from the caller's session (may_report_on, 043):
 *
 *   Manager      THEIR TEAM — the active members of the active projects they
 *                manage. A team report covering every one of those people, an
 *                individual report for any of them, and a recognition extract
 *                of theirs.
 *   HR Admin     the organisation: the same three, across everyone
 *   Super Admin  the same as HR
 *
 * The overview tab is labelled "Team report" or "Organisation" from the scope
 * the DATABASE reports back, not from the role in the browser.
 *
 * FILTERS. Period, department, project, employee, core value, behaviour,
 * source and status apply to every report on the page. They can only narrow:
 * the database normalises them (report_filters_clean, 061), and an employee
 * outside the caller's scope is refused rather than reported as zero.
 *
 * FACTS AND INTERPRETATION ARE KEPT APART, visually and structurally. Every
 * number on this page is counted by the database. The AI section is loaded
 * separately, after the facts are on screen, and is labelled as generated
 * commentary everywhere it appears — including in the export. It describes the
 * UNFILTERED organisation report or an unfiltered individual report, because
 * those are the facts the insights function reads; with filters applied the
 * page says so instead of pairing commentary with numbers it was not about.
 *
 * NOTHING IS GENERATED UNTIL IT IS ASKED FOR. Opening this page fetches a list
 * of names and the filter options, and the overview report. An individual
 * report loads when somebody is chosen. The interpretation is generated only
 * on request, once its report has rendered.
 */

type Tab = 'overview' | 'employee' | 'extract'
type Sheet = { name: string; data: Record<string, unknown>[] }

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  approved:                { label: 'Approved',     cls: 'vs-tag-accent'   },
  rejected:                { label: 'Rejected',     cls: 'vs-tag-outline'  },
  pending:                 { label: 'Pending',      cls: 'vs-tag-neutral'  },
  clarification_requested: { label: 'Clarification', cls: 'vs-tag-neutral' },
  draft:                   { label: 'Draft',        cls: 'vs-tag-neutral'  },
}

const SOURCE_LABEL: Record<string, string> = { peer: 'Peer', manager: 'Manager', hr: 'HR', leadership: 'Leadership' }

// ── Small shared pieces ─────────────────────────────────────

function Section({ title, subtitle, children, action }: {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="vs-card" style={{ overflow: 'visible' }}>
      <div
        className="flex items-start justify-between gap-3 flex-wrap"
        style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--color-divider)' }}
      >
        <div style={{ minWidth: 0 }}>
          <h3 className="font-condensed" style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
            {title}
          </h3>
          {subtitle && (
            <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 3, lineHeight: 1.45 }}>
              {subtitle}
            </p>
          )}
        </div>
        {action}
      </div>
      <div style={{ padding: '14px 16px 16px' }}>{children}</div>
    </section>
  )
}

function Metric({ label, value, delta }: { label: string; value: number | string; delta?: number | null }) {
  return (
    <div className="vs-card" style={{ padding: 14 }}>
      <p className="font-condensed" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </p>
      <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 5 }}>{label}</p>
      {/*
        The change is shown as a change, not as a verdict. No green-good /
        red-bad colouring: a quieter month is not a failing one, and the page
        should not editorialise a number it merely subtracted.
      */}
      {delta !== undefined && delta !== null && (
        <p style={{ fontSize: 11, color: 'var(--color-neutral-600)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
          {delta > 0 ? '+' : ''}{delta} vs previous period
        </p>
      )}
    </div>
  )
}

/** A labelled proportion bar. Used for core values, departments and projects. */
function DistributionRow({ label, count, share, total, accent }: {
  label: string; count: number; share?: number; total: number; accent?: string | null
}) {
  const pct = total > 0 ? (count / total) * 100 : 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="flex items-baseline justify-between gap-3">
        <span style={{ fontSize: 13, color: 'var(--color-text)', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 12, color: 'var(--color-neutral-600)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {count}{share !== undefined ? ` · ${share}%` : ''}
        </span>
      </div>
      <div style={{ height: 6, background: 'var(--color-neutral-200, #e5e5e5)', borderRadius: 3, overflow: 'hidden' }}>
        <div
          style={{
            width: `${Math.max(pct, count > 0 ? 2 : 0)}%`,
            height: '100%',
            background: accent ?? 'var(--color-accent)',
            transition: 'width 200ms',
          }}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}

function TrendBars({ trend }: { trend: EmployeeReport['trend'] | OrganizationReport['trend'] }) {
  if (!trend.sufficient) {
    return (
      <p className="flex items-start gap-1.5" style={{ fontSize: 13, color: 'var(--color-neutral-600)', lineHeight: 1.5 }}>
        <Info size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
        Insufficient data for trend analysis — fewer than three periods with recorded activity.
      </p>
    )
  }

  const values = trend.buckets.map(b => (b.recognitions ?? b.received ?? 0))
  const max = Math.max(1, ...values)

  return (
    <div className="flex items-end gap-1.5" style={{ height: 120, overflowX: 'auto' }}>
      {trend.buckets.map((b, i) => {
        const v = values[i]
        return (
          <div key={b.start} className="flex flex-col items-center gap-1.5" style={{ minWidth: 38, flex: 1 }}>
            <span style={{ fontSize: 11, color: 'var(--color-neutral-600)', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
            <div
              title={`${b.label}: ${v}`}
              style={{
                width: '100%',
                height: Math.max(3, (v / max) * 76),
                background: v > 0 ? 'var(--color-accent)' : 'var(--color-neutral-300, #d4d4d4)',
                borderRadius: '2px 2px 0 0',
              }}
              aria-hidden="true"
            />
            <span style={{ fontSize: 10, color: 'var(--color-neutral-600)', whiteSpace: 'nowrap' }}>{b.label}</span>
          </div>
        )
      })}
    </div>
  )
}

/** One line saying which filters a report was produced under. */
function FilterLine({ filters, options }: { filters: ReportFilters; options: ReportFilterOptions | undefined }) {
  const described = describeFilters(filters, options)
  return (
    <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 3, lineHeight: 1.5 }}>
      {described.length === 0
        ? 'No filters — every recognition in scope.'
        : <>Filtered by {described.map(d => `${d.label}: ${d.value}`).join(' · ')}</>}
    </p>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5" style={{ fontSize: 13, color: 'var(--color-neutral-600)', lineHeight: 1.55 }}>
      <Info size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 3 }} />
      <span>{children}</span>
    </p>
  )
}

// ── AI insights ─────────────────────────────────────────────

/**
 * The interpretation layer.
 *
 * Deliberately rendered inside a visibly distinct panel with a standing
 * disclaimer. The whole feature depends on nobody mistaking this for the
 * measured data eight sections above it: the numbers are counted, this is
 * written about them, and the difference matters when somebody quotes it in a
 * performance conversation.
 */
function AIInsights({ scope, employeeId, period, periodType, ready, glance }: {
  scope: 'employee' | 'organization'
  employeeId?: string
  period: ReportPeriod
  periodType: ReportPeriodType
  /** The factual report has loaded. Nothing is generated before this is true. */
  ready: boolean
  /** The report's own figures, shown beside the commentary. Counted, not generated. */
  glance: ReportGlance
}) {
  const [requested, setRequested] = useState(false)

  const query = useReportInsights({
    scope, employeeId, periodType, period,
    enabled: ready && requested,
  })

  const insight = query.data?.insight

  return (
    <Section
      title="AI insights"
      subtitle="Generated commentary on the figures above. Not a measurement, and not an assessment of performance."
      action={
        !requested ? (
          <button
            className="vs-btn ad-btn-insights relative"
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, whiteSpace: 'nowrap' }}
            onClick={() => setRequested(true)}
            disabled={!ready}
          >
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <Sparkles size={13} aria-hidden="true" /> Generate insights
          </button>
        ) : undefined
      }
    >
      {!requested && (
        <p style={{ fontSize: 13, color: 'var(--color-neutral-600)', lineHeight: 1.55 }}>
          The report above is complete without this. Generate an interpretation when you want one —
          it is produced on request rather than automatically, so opening a report costs nothing.
        </p>
      )}

      {requested && query.isLoading && (
        <div role="status" className="flex items-center gap-3">
          <span className="vs-bar-loader" aria-hidden="true">
            <span /><span /><span /><span />
          </span>
          <p style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>Reading the report…</p>
        </div>
      )}

      {/*
        The failure state, which is the important one. The factual report is
        already on screen and stays there; this says only that the commentary
        is missing, and why.
      */}
      {query.isError && (
        <div
          role="status"
          className="flex items-start gap-2"
          style={{ fontSize: 13, color: 'var(--color-neutral-700)', lineHeight: 1.55 }}
        >
          <AlertCircle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-accent-800)' }} />
          {/*
            The REASON is the headline, not a fixed sentence with the reason
            repeated underneath it. "AI insights are currently unavailable"
            printed twice — once as a title and once as the detail — was what
            this rendered before, which told the reader nothing twice over.
          */}
          <div>
            <p style={{ fontWeight: 600, color: 'var(--color-text)' }}>
              {errorMessage(query.error, 'The AI service could not be reached.')}
            </p>
            <p style={{ marginTop: 4, color: 'var(--color-neutral-600)' }}>
              Every figure in this report was counted by the database and is unaffected.
            </p>
            <button
              className="vs-btn"
              style={{ fontSize: 12, marginTop: 8 }}
              onClick={() => query.refetch()}
              disabled={query.isFetching}
            >
              {query.isFetching ? 'Trying…' : 'Try again'}
            </button>
          </div>
        </div>
      )}

      {insight && (
        <InsightsView
          insight={insight}
          glance={glance}
          periodWord={periodNoun(periodType)}
          footer={
            <p style={{ fontSize: 11.5, color: 'var(--color-neutral-600)', lineHeight: 1.5, borderTop: '1px solid var(--color-divider)', paddingTop: 10 }}>
              AI-generated interpretation of the measured data above, produced by{' '}
              {query.data?.model} ({query.data?.provider}) on{' '}
              {query.data?.generated_at ? formatIST(query.data.generated_at) : '—'}
              {query.data?.cached ? ' and served from cache' : ''}.
              Recognition data records what colleagues chose to write down; it is not a performance
              evaluation, and this commentary should not be read as one.
            </p>
          }
        />
      )}
    </Section>
  )
}

/** Shown in place of the AI section when filters are applied. */
function InsightsNeedUnfiltered() {
  return (
    <Section title="AI insights" subtitle="Generated commentary, available for unfiltered reports.">
      <Notice>
        AI insights describe the complete report for the period. Clear the recognition filters to
        generate them — commentary on the full report shown beside filtered figures would be
        describing numbers that are not on screen.
      </Notice>
    </Section>
  )
}

// ── Export helpers ──────────────────────────────────────────

/**
 * Turn a report into labelled sheets.
 *
 * The AI sheet is named "AI Insights (generated)" and every row is prefixed, so
 * a spreadsheet that outlives this page still says which half was measured and
 * which half was written. Every workbook ends with a "Filters" sheet for the
 * same reason: a filtered report that forgets its filters is a wrong report.
 */
function employeeSheets(r: EmployeeReport, filterRows: Record<string, unknown>[], insight?: ReportInsight): Sheet[] {
  const sheets: Sheet[] = [
    { name: 'Summary', data: [{
      'Employee': r.employee.full_name,
      'Employee ID': r.employee.employee_id,
      'Role': r.employee.role,
      'Department': r.employee.department ?? '',
      'Period start': r.period.start,
      'Period end': r.period.end,
      'Received (total)': r.recognition.received.total,
      'Received (approved)': r.recognition.received.approved,
      'Received (pending)': r.recognition.received.pending,
      'Received (rejected)': r.recognition.received.rejected,
      'Given (total)': r.recognition.given.total,
      'Given (approved)': r.recognition.given.approved,
      'Unique recognizers': r.recognition.unique_recognizers,
      'Generated at': r.generated_at,
    }] },
    { name: 'Core Values', data: r.core_values.map(v => ({
      'Core Value': v.name, 'Recognitions': v.count, 'Share %': v.share_pct,
      'Previous period': v.previous_count,
      'Top behaviours': v.behaviours.map(b => `${b.name} (${b.count})`).join('; '),
    })) },
    { name: 'Behaviours', data: r.behaviours.map(b => ({
      'Behaviour': b.name, 'Core Value': b.core_value, 'Recognitions': b.count,
    })) },
    { name: 'Badges', data: r.badges.current.map(b => ({
      'Core Value': b.core_value, 'Level': b.badge_level ?? '', 'Badge': b.badge_name ?? '',
      'Recognitions': b.recognition_count, 'Unique recognizers': b.unique_recognizer_count,
      'Period': `${b.period_start} – ${b.period_end}`,
    })) },
    { name: 'Projects', data: r.projects.map(p => ({
      'Project': p.name, 'Recognitions in period': p.recognitions,
    })) },
    { name: 'Recognized by', data: r.contributors.map(c => ({
      'Colleague': c.full_name, 'Recognitions given': c.count,
    })) },
    { name: 'Trend', data: r.trend.buckets.map(b => ({
      'Period': b.label, 'Received': b.received ?? 0, 'Given': b.given ?? 0,
    })) },
  ]

  if (insight) sheets.push({ name: 'AI Insights (generated)', data: insightRows(insight) })
  sheets.push({ name: 'Filters', data: filterRows })
  return sheets
}

function employeeRow(e: ScopedReportEmployee): Record<string, unknown> {
  return {
    'Employee': e.full_name,
    'Employee ID': e.employee_id,
    'Email': e.email,
    'Designation': e.designation ?? '',
    'Department': e.department ?? '',
    'Project': e.projects.join(', '),
    'Received (total)': e.received.total,
    'Received (approved)': e.received.approved,
    'Received (pending)': e.received.pending,
    'Received (clarification)': e.received.clarification_requested,
    'Received (rejected)': e.received.rejected,
    'Given (approved)': e.given_approved,
    'Unique recognizers': e.unique_recognizers,
    'Most recognised value': e.top_core_value ?? '',
    'Badges held': e.badges_held,
    'Highest badge': e.top_badge_name ?? '',
  }
}

function scopedSheets(r: ScopedReport, filterRows: Record<string, unknown>[]): Sheet[] {
  const team = r.scope === 'team'
  return [
    { name: 'Summary', data: [{
      'Report': team ? 'Team report' : 'Organisation report',
      'Period start': r.period.start,
      'Period end': r.period.end,
      [team ? 'Team members' : 'Active employees']: r.totals.employees_active,
      'Employees recognized': r.totals.employees_recognized,
      'Recognizers': r.totals.employees_giving,
      'Participation %': r.totals.participation_pct,
      'Recognitions (total)': r.totals.recognitions.total,
      'Recognitions (approved)': r.totals.recognitions.approved,
      'Recognitions (pending)': r.totals.recognitions.pending,
      'Recognitions (clarification)': r.totals.recognitions.clarification_requested,
      'Recognitions (rejected)': r.totals.recognitions.rejected,
      'Previous period (approved)': r.totals.previous_approved ?? '',
      'Badges awarded in period': r.badges.awarded_in_period,
      'Generated at': r.generated_at,
    }] },
    { name: 'Employees', data: r.employees.map(employeeRow) },
    { name: 'Core Values', data: r.core_values.map(v => ({
      'Core Value': v.name, 'Recognitions': v.count, 'Share %': v.share_pct,
      'Previous period': v.previous_count,
    })) },
    { name: 'Behaviours', data: r.behaviours.map(b => ({
      'Behaviour': b.name, 'Core Value': b.core_value, 'Recognitions': b.count,
    })) },
    { name: 'Badges', data: r.badges.by_level.map(b => ({
      'Level': b.level, 'Badge': b.name, 'Holders': b.holders,
    })) },
    { name: 'Departments', data: r.departments.map(d => ({
      'Department': d.name, 'Recognitions': d.recognitions, 'Employees recognized': d.employees_recognized,
    })) },
    { name: 'Projects', data: r.projects.map(p => ({
      'Project': p.name, 'Recognitions': p.recognitions, 'Employees recognized': p.employees_recognized,
    })) },
    { name: 'Trend', data: r.trend.buckets.map(b => ({
      'Period': b.label, 'Recognitions': b.recognitions ?? 0,
      'Employees recognized': b.employees_recognized ?? 0,
    })) },
    { name: 'Filters', data: filterRows },
  ]
}

function insightRows(insight: ReportInsight): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [
    { 'Section': 'NOTE', 'AI-generated content': 'The rows below are AI-generated interpretation, not measured data.' },
    ...(insight.headline ? [{ 'Section': 'Headline', 'AI-generated content': insight.headline }] : []),
    { 'Section': 'Summary', 'AI-generated content': insight.summary },
  ]
  const lists: Array<[string, string[]]> = [
    ['Strength', insight.strengths],
    ['Development opportunity', insight.development_opportunities],
    ['Recommendation', insight.recommendations],
    ['Evidence limitation', insight.evidence_limitations],
  ]
  for (const [label, items] of lists) {
    for (const item of items) rows.push({ 'Section': label, 'AI-generated content': item })
  }
  rows.push({ 'Section': 'Core value insights', 'AI-generated content': insight.core_value_insights })
  rows.push({ 'Section': 'Recognition pattern', 'AI-generated content': insight.recognition_pattern })
  rows.push({ 'Section': 'Badge summary', 'AI-generated content': insight.badge_summary })
  return rows
}

function ExportButtons({ sheets, filename, csv }: {
  sheets: Sheet[]
  filename: string
  /** Which sheet the CSV carries, since CSV is one table. Defaults to the first. */
  csv?: { sheet: string; label: string }
}) {
  const csvSheet = sheets.find(s => s.name === csv?.sheet) ?? sheets[0]
  return (
    <div className="flex gap-2 flex-wrap">
      <button
        className="vs-btn"
        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
        onClick={() => exportXLSX(sheets, filename)}
      >
        <Download size={13} aria-hidden="true" /> Export XLSX
      </button>
      <button
        className="vs-btn"
        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
        onClick={() => exportCSV(csvSheet.data, `${filename}-${csvSheet.name.toLowerCase().replace(/\s+/g, '-')}`)}
        disabled={csvSheet.data.length === 0}
      >
        <Download size={13} aria-hidden="true" /> Export CSV ({csv?.label ?? 'summary'})
      </button>
    </div>
  )
}

// ── Report views ────────────────────────────────────────────

function EmployeeReportView({ report, period, filters, options }: {
  report: EmployeeReport
  period: ReportPeriod
  filters: ReportFilters
  options: ReportFilterOptions | undefined
}) {
  const r = report
  const totalValueRecognitions = r.core_values.reduce((sum, v) => sum + v.count, 0)
  const prevReceived = r.recognition.previous?.received_approved ?? null
  const rowFilters = describeFilters(filters, options).filter(d => d.key !== 'department_id' && d.key !== 'employee_id')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Profile */}
      <div className="vs-card" style={{ padding: '14px 16px' }}>
        <div className="flex items-center gap-3">
          <EmployeeAvatar name={r.employee.full_name} avatarUrl={null} size="md" />
          <div className="min-w-0">
            <p className="font-condensed" style={{ fontSize: 19, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.2 }}>
              {r.employee.full_name}
            </p>
            <p style={{ fontSize: 12.5, color: 'var(--color-neutral-600)', marginTop: 2 }}>
              {r.employee.employee_id}
              {r.employee.department ? ` · ${r.employee.department}` : ''}
              {r.projects.length > 0 ? ` · ${r.projects.map(p => p.name).join(', ')}` : ''}
            </p>
            <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 3 }}>
              {period.label} · {period.rangeLabel} · generated {formatIST(r.generated_at)}
            </p>
            {rowFilters.length > 0 && (
              <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 3, lineHeight: 1.5 }}>
                Counts limited to {rowFilters.map(d => `${d.label}: ${d.value}`).join(' · ')}.
                Badge standing is a running total and is narrowed only by core value.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Recognition summary */}
      <Section
        title="Recognition summary"
        subtitle="Counted from recognition records for this period. Only approved recognitions are achievements; pending and rejected ones are shown for completeness."
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric label="Received (approved)" value={r.recognition.received.approved}
            delta={prevReceived === null ? null : r.recognition.received.approved - prevReceived} />
          <Metric label="Given (approved)" value={r.recognition.given.approved} />
          <Metric label="Colleagues who recognized them" value={r.recognition.unique_recognizers} />
          <Metric label="Awaiting review" value={r.recognition.received.pending} />
        </div>
        {r.recognition.received.total === 0 && r.recognition.given.total === 0 && (
          <p style={{ fontSize: 13, color: 'var(--color-neutral-600)', marginTop: 12, lineHeight: 1.55 }}>
            No recognition activity recorded during this period{rowFilters.length > 0 ? ' under these filters' : ''}.
            That is a fact about the recognition records, not an assessment of the work.
          </p>
        )}
      </Section>

      {/* Core values */}
      <Section
        title="Core value analysis"
        subtitle="Approved recognitions by core value. A low count means little recognition was recorded for that value — it is not evidence of an improvement area."
      >
        {totalValueRecognitions === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>
            No approved recognitions were recorded against any core value in this period.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {r.core_values.map(v => (
              <div key={v.id}>
                <DistributionRow
                  label={v.name} count={v.count} share={v.share_pct}
                  total={totalValueRecognitions} accent={v.accent_color}
                />
                {(v.behaviours.length > 0 || v.scenarios.length > 0) && (
                  <p style={{ fontSize: 11.5, color: 'var(--color-neutral-600)', marginTop: 4, lineHeight: 1.5 }}>
                    {v.behaviours.length > 0 && (
                      <>Behaviours: {v.behaviours.map(b => `${b.name} (${b.count})`).join(', ')}</>
                    )}
                    {v.behaviours.length > 0 && v.scenarios.length > 0 && ' · '}
                    {v.scenarios.length > 0 && (
                      <>Scenarios: {v.scenarios.map(s => `${s.name} (${s.count})`).join(', ')}</>
                    )}
                  </p>
                )}
                {v.previous_count > 0 && (
                  <p style={{ fontSize: 11.5, color: 'var(--color-neutral-600)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                    Previous period: {v.previous_count} → {v.count}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Behaviours */}
      <Section title="Behaviour analysis" subtitle="The behaviours this employee's recognitions cited most often.">
        {r.behaviours.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>
            No behaviours were recorded on recognitions in this period.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {r.behaviours.map(b => (
              <DistributionRow
                key={`${b.core_value}-${b.name}`}
                label={`${b.name}`} count={b.count}
                total={Math.max(...r.behaviours.map(x => x.count))}
              />
            ))}
          </div>
        )}
      </Section>

      {/* Badges */}
      <Section title="Badges and achievements" subtitle="Badge standing is a running annual total; progression shows what changed inside this period.">
        {r.badges.current.length === 0 && r.badges.earned_in_period.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>
            No badges earned during this period.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {r.badges.current.map(b => (
              <div key={`${b.core_value}-${b.period_start}`} className="flex items-baseline justify-between gap-3">
                <div>
                  <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>
                    {b.badge_name ?? `Level ${b.badge_level}`} — {b.core_value}
                  </p>
                  {b.badge_description && (
                    <p style={{ fontSize: 11.5, color: 'var(--color-neutral-600)', marginTop: 1 }}>{b.badge_description}</p>
                  )}
                </div>
                <span style={{ fontSize: 12, color: 'var(--color-neutral-600)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {b.recognition_count} recognitions
                  {b.next_level_at ? ` · next at ${b.next_level_at}` : ''}
                </span>
              </div>
            ))}
            {r.badges.earned_in_period.length > 0 && (
              <div style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 10 }}>
                <p className="vs-kicker" style={{ marginBottom: 5 }}>Earned in this period</p>
                {r.badges.earned_in_period.map((b, i) => (
                  <p key={i} style={{ fontSize: 12.5, color: 'var(--color-neutral-700)', lineHeight: 1.6 }}>
                    {b.badge_name ?? `Level ${b.new_level}`} — {b.core_value}
                    {b.previous_level ? ` (from level ${b.previous_level})` : ''} · {formatIST(b.achieved_at)}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>

      {/* Projects */}
      <Section title="Project participation" subtitle="Active project memberships, with recognitions filed against each project in this period.">
        {r.projects.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>
            No active project memberships recorded.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {r.projects.map(p => (
              <DistributionRow
                key={p.id} label={p.name} count={p.recognitions}
                total={Math.max(1, ...r.projects.map(x => x.recognitions))}
              />
            ))}
          </div>
        )}
      </Section>

      {/* Contributors */}
      <Section title="Recognized by" subtitle="Colleagues whose recognitions of this employee were approved in the period.">
        {r.contributors.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>
            No approved recognitions were received in this period.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {r.contributors.map(c => (
              <div key={c.id} className="flex items-baseline justify-between gap-3">
                <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{c.full_name}</span>
                <span style={{ fontSize: 12, color: 'var(--color-neutral-600)', fontVariantNumeric: 'tabular-nums' }}>
                  {c.count} recognition{c.count !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Trend */}
      <Section
        title="Recognition trend"
        subtitle={`Approved recognitions by ${r.trend.granularity} across the period.`}
      >
        <TrendBars trend={r.trend} />
      </Section>
    </div>
  )
}

type SortKey = 'name' | 'approved' | 'pending' | 'given' | 'badges'

/**
 * One row per employee in scope — the "report on everyone" a Manager asked for,
 * and HR's organisation-wide equivalent. Quiet people are rows reading zero,
 * not missing rows.
 */
function EmployeeBreakdown({ employees, team, onOpen }: {
  employees: ScopedReportEmployee[]
  team: boolean
  onOpen: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('approved')
  const [showAll, setShowAll] = useState(false)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = q
      ? employees.filter(e =>
          [e.full_name, e.employee_id, e.email, e.designation ?? '', e.department ?? '', ...e.projects]
            .some(v => v.toLowerCase().includes(q)))
      : employees
    const by: Record<SortKey, (a: ScopedReportEmployee, b: ScopedReportEmployee) => number> = {
      name:     (a, b) => a.full_name.localeCompare(b.full_name),
      approved: (a, b) => b.received.approved - a.received.approved || a.full_name.localeCompare(b.full_name),
      pending:  (a, b) => b.received.pending - a.received.pending || a.full_name.localeCompare(b.full_name),
      given:    (a, b) => b.given_approved - a.given_approved || a.full_name.localeCompare(b.full_name),
      badges:   (a, b) => b.badges_held - a.badges_held || a.full_name.localeCompare(b.full_name),
    }
    return [...matched].sort(by[sort])
  }, [employees, query, sort])

  const LIMIT = 50
  const visible = showAll ? rows : rows.slice(0, LIMIT)

  const header = (key: SortKey | null, label: string, align: 'left' | 'right' = 'right') => (
    <th style={{ whiteSpace: 'nowrap', textAlign: align }} aria-sort={key && sort === key ? 'descending' : undefined}>
      {key ? (
        <button
          onClick={() => setSort(key)}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit',
            textTransform: 'inherit', letterSpacing: 'inherit',
            color: 'inherit', fontWeight: sort === key ? 700 : 'inherit',
            textDecoration: sort === key ? 'underline' : 'none', textUnderlineOffset: 3,
          }}
        >
          {label}
        </button>
      ) : label}
    </th>
  )

  return (
    <Section
      title={team ? 'Every team member' : 'Every employee'}
      subtitle={team
        ? 'One row per person on the projects you manage, including anyone with no recognition yet. Choose a name for their full report.'
        : 'One row per active employee in the selection, including anyone with no recognition yet. Choose a name for their full report.'}
    >
      <div className="relative" style={{ marginBottom: 12, maxWidth: 360 }}>
        <Search size={15} aria-hidden="true"
          style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-neutral-500)' }} />
        <input
          type="search"
          className="vs-input w-full"
          style={{ height: 32, fontSize: 13, paddingLeft: 32 }}
          placeholder="Search name, ID, email, department…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="Search the employee table"
        />
      </div>

      {employees.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>
          {team
            ? 'Nobody in this selection is on a project you manage.'
            : 'No active employees match this selection.'}
        </p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>No one matches “{query}”.</p>
      ) : (
        <>
          <div className="overflow-x-auto" style={{ margin: '0 -16px' }}>
            <table className="vs-table w-full" style={{ minWidth: 860 }}>
              <thead>
                <tr style={{ background: 'color-mix(in srgb, var(--color-neutral-300) 30%, transparent)' }}>
                  {header('name', 'Employee', 'left')}
                  {header(null, 'Department', 'left')}
                  {header(null, 'Project', 'left')}
                  {header('approved', 'Approved')}
                  {header('pending', 'Pending')}
                  {header(null, 'Rejected')}
                  {header('given', 'Given')}
                  {header(null, 'Recognizers')}
                  {header(null, 'Top value', 'left')}
                  {header('badges', 'Badges')}
                </tr>
              </thead>
              <tbody>
                {visible.map(e => (
                  <tr key={e.id}>
                    <td>
                      <button
                        onClick={() => onOpen(e.id)}
                        className="text-left"
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
                        title={`Open ${e.full_name}'s report`}
                      >
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{e.full_name}</span>
                        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-neutral-600)' }}>
                          {e.employee_id}{e.designation ? ` · ${e.designation}` : ''}
                        </span>
                      </button>
                    </td>
                    <td style={{ color: 'var(--color-neutral-700)', fontSize: 12.5 }}>{e.department ?? '—'}</td>
                    <td style={{ color: 'var(--color-neutral-700)', fontSize: 12.5 }}>{e.projects.join(', ') || '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--color-text)' }}>{e.received.approved}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-700)' }}>
                      {e.received.pending + e.received.clarification_requested}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-700)' }}>{e.received.rejected}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-700)' }}>{e.given_approved}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-700)' }}>{e.unique_recognizers}</td>
                    <td style={{ color: 'var(--color-neutral-700)', fontSize: 12.5 }}>{e.top_core_value ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-700)', whiteSpace: 'nowrap' }}>
                      {e.badges_held}{e.top_badge_name ? ` · ${e.top_badge_name}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--color-neutral-600)', marginTop: 10, lineHeight: 1.5 }}>
            Approved, pending and rejected count recognitions received and submitted in the period;
            pending includes those awaiting clarification. Given counts approved recognitions they wrote.
            Badges are held in the current annual period.
          </p>
          {rows.length > LIMIT && (
            <button className="vs-btn" style={{ fontSize: 12, marginTop: 10 }} onClick={() => setShowAll(v => !v)}>
              {showAll ? `Show first ${LIMIT}` : `Show all ${rows.length}`}
            </button>
          )}
        </>
      )}
    </Section>
  )
}

function ScopedReportView({ report, period, options, updating, onOpenEmployee }: {
  report: ScopedReport
  period: ReportPeriod
  options: ReportFilterOptions | undefined
  updating: boolean
  onOpenEmployee: (id: string) => void
}) {
  const r = report
  const team = r.scope === 'team'
  const totalValues = r.core_values.reduce((s, v) => s + v.count, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, opacity: updating ? 0.6 : 1, transition: 'opacity 150ms' }}>
      <div className="vs-card" style={{ padding: '14px 16px' }}>
        <p className="font-condensed" style={{ fontSize: 19, fontWeight: 600, color: 'var(--color-text)' }}>
          {team ? 'Team report' : 'Organisation report'} — {period.label}
        </p>
        <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 3 }}>
          {period.rangeLabel} · generated {formatIST(r.generated_at)}
          {updating ? ' · updating…' : ''}
        </p>
        <FilterLine filters={r.filters} options={options} />
      </div>

      <Section
        title={team ? 'Team summary' : 'Organisation summary'}
        subtitle={team
          ? 'Aggregated across the active members of the projects you manage.'
          : 'Aggregated across every active employee in the selection, not assembled from individual reports.'}
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <Metric label={team ? 'Team members' : 'Active employees'} value={r.totals.employees_active} />
          <Metric label="Employees recognized" value={r.totals.employees_recognized} />
          <Metric label={team ? 'People who recognized them' : 'Employees giving'} value={r.totals.employees_giving} />
          <Metric label="Participation" value={`${r.totals.participation_pct}%`} />
          <Metric
            label="Recognitions approved"
            value={r.totals.recognitions.approved}
            delta={r.totals.previous_approved === null
              ? null
              : r.totals.recognitions.approved - r.totals.previous_approved}
          />
          <Metric label="Badges awarded" value={r.badges.awarded_in_period} />
        </div>
        <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 10, fontVariantNumeric: 'tabular-nums' }}>
          {r.totals.recognitions.total} submitted in the period: {r.totals.recognitions.approved} approved ·{' '}
          {r.totals.recognitions.pending} pending · {r.totals.recognitions.clarification_requested} awaiting clarification ·{' '}
          {r.totals.recognitions.rejected} rejected
        </p>
      </Section>

      <EmployeeBreakdown employees={r.employees} team={team} onOpen={onOpenEmployee} />

      <Section title="Core value distribution" subtitle="Where recognition was recorded. Lower activity for a value reflects the recognition data, not performance.">
        {totalValues === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>
            No approved recognitions were recorded in this period.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {r.core_values.map(v => (
              <div key={v.id}>
                <DistributionRow label={v.name} count={v.count} share={v.share_pct} total={totalValues} accent={v.accent_color} />
                {v.previous_count > 0 && (
                  <p style={{ fontSize: 11.5, color: 'var(--color-neutral-600)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                    Previous period: {v.previous_count} → {v.count}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Most recognized behaviours">
        {r.behaviours.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>No behaviours recorded in this period.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {r.behaviours.slice(0, 10).map(b => (
              <DistributionRow key={`${b.core_value}-${b.name}`} label={`${b.name} · ${b.core_value}`}
                count={b.count} total={Math.max(...r.behaviours.map(x => x.count))} />
            ))}
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Departments" subtitle="From the department recorded on each recognition at submission.">
          {r.departments.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>No data for this period.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {r.departments.slice(0, 10).map(d => (
                <DistributionRow key={d.name} label={d.name} count={d.recognitions}
                  total={Math.max(...r.departments.map(x => x.recognitions))} />
              ))}
            </div>
          )}
        </Section>

        <Section title="Projects" subtitle="The project each recognition was filed against.">
          {r.projects.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>No data for this period.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {r.projects.slice(0, 10).map(p => (
                <DistributionRow key={p.name} label={p.name} count={p.recognitions}
                  total={Math.max(...r.projects.map(x => x.recognitions))} />
              ))}
            </div>
          )}
        </Section>
      </div>

      <Section title="Badge distribution" subtitle={team ? 'Team members holding each badge level.' : 'Employees holding each badge level.'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {r.badges.by_level.map(b => (
            <DistributionRow key={b.level} label={`${b.name} (level ${b.level})`} count={b.holders}
              total={Math.max(1, ...r.badges.by_level.map(x => x.holders))} />
          ))}
        </div>
      </Section>

      <Section title="Recognition over time" subtitle={`Approved recognitions by ${r.trend.granularity}.`}>
        <TrendBars trend={r.trend} />
      </Section>
    </div>
  )
}

// ── Extract ─────────────────────────────────────────────────

function extractSheetRows(x: ExtractResult): Record<string, unknown>[] {
  return x.rows.map(r => ({
    'Date': r.submitted_at ? formatIST(r.submitted_at) : '',
    'Status': STATUS_STYLE[r.status]?.label ?? r.status,
    'Nominator': r.nominator ?? '',
    'Nominee': r.nominee,
    'Nominee ID': r.nominee_employee_id,
    'Core Value': r.core_value ?? '',
    'Behaviour': r.behaviour ?? '',
    'Project': r.project ?? '',
    'Nominator Dept': r.nominator_dept ?? '',
    'Nominee Dept': r.nominee_dept ?? '',
    'Source': SOURCE_LABEL[r.source ?? ''] ?? r.source ?? '',
    'What Happened': r.narrative_withheld ? '(not visible to you — awaiting another approver)' : (r.what_happened ?? ''),
    'Impact': r.narrative_withheld ? '' : (r.what_impact ?? ''),
  }))
}

// ── The page ────────────────────────────────────────────────

export default function ReportsPage() {
  const { employee } = useAuth()
  const orgWide = employee?.role === 'hr_admin' || employee?.role === 'super_admin'

  const [tab, setTab] = useState<Tab>('overview')

  // Period selection, shared by every tab.
  const [periodType, setPeriodType] = useState<ReportPeriodType>('monthly')
  const [month, setMonth]     = useState(format(nowIST(), 'yyyy-MM'))
  const [quarter, setQuarter] = useState(getFinancialQuarter(nowIST()).quarter)
  const [year, setYear]       = useState(nowIST().getFullYear())

  const period = reportPeriod(periodType, { month, quarter, year })

  // The seven other filters, shared by every tab.
  const [filters, setFilters] = useState<ReportFilters>({})
  const options = useReportFilterOptions()
  const optionsData = options.data

  // The individual report's subject IS the employee filter, so choosing a
  // name here and choosing one in the Filters panel are the same action.
  const selectedId = filters.employee_id ?? null
  const selectEmployee = (id: string | null) =>
    setFilters(f => compactFilters({ ...f, employee_id: id ?? undefined }))

  const [search, setSearch] = useState('')
  const subjects = useReportSubjects(search)
  // The picker follows the department and project filters.
  const pickable = (subjects.data ?? []).filter(s =>
    (!filters.department_id || s.department_id === filters.department_id)
    && (!filters.project_id || (s.project_ids ?? []).includes(filters.project_id)))

  // Each report loads only while its own tab is open.
  const scoped = useScopedReport(period, filters, tab === 'overview')
  const employeeReport = useEmployeeReport(tab === 'employee' ? selectedId ?? undefined : undefined, period, filters)

  const scope = optionsData?.scope ?? (orgWide ? 'organization' : 'team')
  const team = scope === 'team'
  const filterRows = filterSheetRows(period.label, period.rangeLabel, filters, optionsData)
  const filterCount = activeFilterCount(filters)

  // The extract is generated on request and remembers what it was generated FOR.
  const paramsKey = JSON.stringify({ s: period.start, e: period.end, f: compactFilters(filters) })
  const [extract, setExtract] = useState<{ result: ExtractResult; key: string; filterRows: Record<string, unknown>[] } | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)

  const runExtract = async () => {
    setExtracting(true)
    setExtractError(null)
    try {
      const result = await reportsApi.getExtract({ period, filters })
      setExtract({ result, key: paramsKey, filterRows })
    } catch (err) {
      setExtract(null)
      setExtractError(errorMessage(err, 'Could not generate that extract. Please try again.'))
    }
    setExtracting(false)
  }

  const tabs: Array<[Tab, string]> = [
    ['overview', team ? 'Team report' : 'Organisation'],
    ['employee', 'Employee reports'],
    ['extract', 'Recognition extract'],
  ]

  const openEmployee = (id: string) => {
    selectEmployee(id)
    setTab('employee')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const withheld = extract?.result.rows.filter(r => r.narrative_withheld).length ?? 0

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        kicker={orgWide ? 'Insights' : 'Team'}
        title="Reports"
        subtitle={orgWide
          ? 'Organisation-wide and individual recognition reports, by period, with filters.'
          : 'Recognition reports for everyone on the projects you manage — the whole team, or one person at a time.'}
      />

      {/* Period configuration */}
      <div className="vs-card">
        <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--color-divider)' }}>
          <h3 className="font-condensed" style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
            Reporting period
          </h3>
          <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 3 }}>
            {period.label} · {period.rangeLabel}
          </p>
        </div>
        <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="vs-seg" style={{ width: 'fit-content' }}>
            {(['monthly', 'quarterly', 'annual'] as ReportPeriodType[]).map(t => (
              <button
                key={t}
                style={{
                  padding: '6px 16px', fontSize: 13,
                  fontFamily: 'inherit', fontWeight: 600,
                  border: 'none', borderRight: '1px solid var(--color-divider)',
                  background: periodType === t ? 'var(--color-accent)' : 'transparent',
                  color: periodType === t ? 'var(--color-bg)' : 'var(--color-neutral-600)',
                  cursor: 'pointer', textTransform: 'capitalize',
                }}
                onClick={() => setPeriodType(t)}
                aria-pressed={periodType === t}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            {periodType === 'monthly' && (
              <div>
                <label htmlFor="rep-month" style={{ display: 'block', fontSize: 12, color: 'var(--color-neutral-600)', marginBottom: 4 }}>Month</label>
                <input id="rep-month" type="month" className="vs-input" style={{ height: 32, fontSize: 13 }}
                  value={month} onChange={e => e.target.value && setMonth(e.target.value)} />
              </div>
            )}
            {periodType === 'quarterly' && (
              <>
                <div>
                  <label htmlFor="rep-q" style={{ display: 'block', fontSize: 12, color: 'var(--color-neutral-600)', marginBottom: 4 }}>Quarter</label>
                  <select id="rep-q" className="vs-input" style={{ height: 32, fontSize: 13 }}
                    value={quarter} onChange={e => setQuarter(Number(e.target.value))}>
                    <option value={1}>Q1 (Apr–Jun)</option><option value={2}>Q2 (Jul–Sep)</option>
                    <option value={3}>Q3 (Oct–Dec)</option><option value={4}>Q4 (Jan–Mar)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="rep-fy" style={{ display: 'block', fontSize: 12, color: 'var(--color-neutral-600)', marginBottom: 4 }}>Financial year</label>
                  <input id="rep-fy" type="number" min={2020} max={2099} className="vs-input"
                    style={{ height: 32, fontSize: 13, width: 88 }}
                    value={year} onChange={e => Number(e.target.value) >= 2000 && setYear(Number(e.target.value))} />
                </div>
              </>
            )}
            {periodType === 'annual' && (
              <div>
                <label htmlFor="rep-year" style={{ display: 'block', fontSize: 12, color: 'var(--color-neutral-600)', marginBottom: 4 }}>Year</label>
                <input id="rep-year" type="number" min={2020} max={2099} className="vs-input"
                  style={{ height: 32, fontSize: 13, width: 88 }}
                  value={year} onChange={e => Number(e.target.value) >= 2000 && setYear(Number(e.target.value))} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <ReportFiltersPanel
        options={optionsData}
        loading={options.isLoading}
        error={options.isError ? errorMessage(options.error, 'The report filters could not be loaded.') : null}
        filters={filters}
        onChange={next => setFilters(compactFilters(next))}
      />

      {/* Tabs */}
      <div className="vs-seg" style={{ width: 'fit-content', maxWidth: '100%', overflowX: 'auto' }} role="tablist">
        {tabs.map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            style={{
              padding: '6px 16px', fontSize: 13,
              fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap',
              border: 'none', borderRight: '1px solid var(--color-divider)',
              background: tab === t ? 'var(--color-accent)' : 'transparent',
              color: tab === t ? 'var(--color-bg)' : 'var(--color-neutral-600)',
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Team / organisation report ── */}
      {tab === 'overview' && (
        <>
          {scoped.isLoading && <CardSkeleton />}
          {scoped.isError && !scoped.data && (
            <p className="flex items-center gap-1.5" role="alert" style={{ fontSize: 13, color: 'var(--color-accent-800)' }}>
              <AlertCircle size={14} aria-hidden="true" />
              {errorMessage(scoped.error, team ? 'Could not generate the team report.' : 'Could not generate the organisation report.')}
            </p>
          )}
          {scoped.data && (
            <>
              <ExportButtons
                sheets={scopedSheets(scoped.data, filterSheetRows(period.label, period.rangeLabel, scoped.data.filters, optionsData))}
                filename={`valuespot-${scoped.data.scope === 'team' ? 'team' : 'organisation'}-${periodType}-${period.start}`}
                csv={{ sheet: 'Employees', label: 'employees' }}
              />
              <ScopedReportView
                report={scoped.data}
                period={period}
                options={optionsData}
                updating={scoped.isPlaceholderData}
                onOpenEmployee={openEmployee}
              />
              {/*
                AI commentary exists for the organisation report as a whole.
                A Manager's team report has no generated commentary: the
                insights function describes an organisation or one person.
              */}
              {scoped.data.scope === 'organization' && (
                filterCount === 0 && !scoped.isPlaceholderData ? (
                  <AIInsights
                    scope="organization"
                    periodType={periodType}
                    period={period}
                    ready={Boolean(scoped.data)}
                    glance={organizationGlance(scoped.data)}
                  />
                ) : <InsightsNeedUnfiltered />
              )}
            </>
          )}
        </>
      )}

      {/* ── Employee reports ── */}
      {tab === 'employee' && (
        <>
          <div className="vs-card">
            <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--color-divider)' }}>
              <h3 className="font-condensed" style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
                {team ? 'Your team' : 'Select an employee'}
              </h3>
              <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 3, lineHeight: 1.45 }}>
                {team
                  ? 'The active members of the active projects you manage. This list is built in the database from your project assignments.'
                  : 'Anyone in the organisation.'}
                {(filters.department_id || filters.project_id) && ' Narrowed by the department and project filters.'}
              </p>
            </div>
            <div style={{ padding: '14px 16px 16px' }}>
              <div className="relative" style={{ marginBottom: 12 }}>
                <Search size={15} aria-hidden="true"
                  style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-neutral-500)' }} />
                <input
                  type="search"
                  className="vs-input w-full"
                  style={{ height: 34, fontSize: 13, paddingLeft: 32 }}
                  placeholder="Search by name, employee ID or email…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  aria-label="Search employees"
                />
              </div>

              {subjects.isLoading && <p style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>Loading…</p>}

              {subjects.isError && (
                <p role="alert" style={{ fontSize: 13, color: 'var(--color-accent-800)' }}>
                  {errorMessage(subjects.error, 'Could not load the employee list.')}
                </p>
              )}

              {subjects.data && pickable.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--color-neutral-600)', lineHeight: 1.55 }}>
                  {search
                    ? `No employees match "${search}".`
                    : subjects.data.length > 0
                      ? 'No one matches the department and project filters.'
                      : orgWide
                        ? 'No active employees found.'
                        : 'No employees are assigned to the projects you manage. Ask HR to add members to a project you run.'}
                </p>
              )}

              {pickable.length > 0 && (
                <ul style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 280, overflowY: 'auto' }}>
                  {pickable.map(s => (
                    <li key={s.id}>
                      <button
                        className="w-full flex items-center gap-2.5 text-left"
                        style={{
                          padding: '7px 9px',
                          borderRadius: 6,
                          border: 'none',
                          cursor: 'pointer',
                          background: selectedId === s.id
                            ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)'
                            : 'transparent',
                        }}
                        onClick={() => selectEmployee(selectedId === s.id ? null : s.id)}
                        aria-pressed={selectedId === s.id}
                      >
                        <EmployeeAvatar name={s.full_name} avatarUrl={s.avatar_url} size="sm" />
                        <span className="flex-1 min-w-0">
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>
                            {s.full_name}
                          </span>
                          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-neutral-600)' }}>
                            {s.employee_id}
                            {s.department ? ` · ${s.department}` : ''}
                            {s.projects.length > 0 ? ` · ${s.projects.join(', ')}` : ''}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {!selectedId && (
            <EmptyState
              icon={<FileText size={36} />}
              title="No employee selected"
              description={team
                ? 'Choose someone above, or use the Employee filter, to generate their report. For everyone at once, open the Team report tab.'
                : 'Choose someone above, or use the Employee filter, to generate their recognition report for the selected period.'}
            />
          )}

          {selectedId && employeeReport.isLoading && <CardSkeleton />}

          {selectedId && employeeReport.isError && (
            <p className="flex items-center gap-1.5" role="alert" style={{ fontSize: 13, color: 'var(--color-accent-800)' }}>
              <AlertCircle size={14} aria-hidden="true" />
              {errorMessage(employeeReport.error, 'Could not generate that report.')}
            </p>
          )}

          {selectedId && employeeReport.data && (
            <>
              <ExportButtons
                sheets={employeeSheets(employeeReport.data, filterRows)}
                filename={`valuespot-${employeeReport.data.employee.employee_id}-${periodType}-${period.start}`}
              />
              <EmployeeReportView report={employeeReport.data} period={period} filters={filters} options={optionsData} />
              {hasRowFilters(filters) ? <InsightsNeedUnfiltered /> : (
                <AIInsights
                  key={selectedId}
                  scope="employee"
                  employeeId={selectedId}
                  periodType={periodType}
                  period={period}
                  ready={Boolean(employeeReport.data)}
                  glance={employeeGlance(employeeReport.data)}
                />
              )}
            </>
          )}
        </>
      )}

      {/* ── Recognition extract ── */}
      {tab === 'extract' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="vs-btn vs-btn-primary relative"
              style={{ height: 32, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
              onClick={runExtract}
              disabled={extracting}
              aria-busy={extracting}
            >
              <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
              <FileText size={13} aria-hidden="true" />
              {extracting ? 'Generating…' : extract ? 'Regenerate extract' : 'Generate extract'}
            </button>
            <p style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>
              Every recognition {team ? 'received by your team' : ''} submitted in {period.label}
              {filterCount > 0 ? ', matching the filters' : ''} — one row each, for a spreadsheet.
            </p>
          </div>

          {extractError && <p className="text-sm text-danger" role="alert">{extractError}</p>}

          {extract && extract.key !== paramsKey && (
            <div className="vs-card" role="status" style={{ padding: '12px 14px', borderLeft: '3px solid var(--color-accent-700)' }}>
              <p style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.5 }}>
                The period or filters have changed since this extract was generated. Regenerate it to match.
              </p>
            </div>
          )}

          {/*
            The extract is capped. Saying so is the whole point of the cap — a
            spreadsheet that is quietly missing rows is worse than one that is
            openly incomplete.
          */}
          {extract?.result.truncated && (
            <div className="vs-card" role="status" style={{ padding: '12px 14px', borderLeft: '3px solid var(--color-accent-700)' }}>
              <p style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.5 }}>
                <strong>This extract is incomplete.</strong>{' '}
                {extract.result.summary.total.toLocaleString()} recognitions match, and only the{' '}
                {extract.result.limit.toLocaleString()} most recent are shown and exported.
                Choose a shorter period or add filters to export the full set.
              </p>
            </div>
          )}

          {extract && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <Metric label="Total" value={extract.result.summary.total} />
                <Metric label="Approved" value={extract.result.summary.approved} />
                <Metric label="Pending" value={extract.result.summary.pending} />
                <Metric label="Clarification" value={extract.result.summary.clarification_requested} />
                <Metric label="Rejected" value={extract.result.summary.rejected} />
              </div>

              {withheld > 0 && (
                <p className="flex items-start gap-1.5" style={{ fontSize: 12.5, color: 'var(--color-neutral-600)', lineHeight: 1.5 }}>
                  <EyeOff size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                  {withheld} recognition{withheld !== 1 ? 's are' : ' is'} counted without its story: not yet
                  approved and being decided by another approver. Stories become visible once approved.
                </p>
              )}

              <div className="flex gap-2 flex-wrap">
                <button className="vs-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
                  disabled={extract.result.rows.length === 0}
                  onClick={() => exportCSV(extractSheetRows(extract.result), `valuespot-${periodType}-extract`)}>
                  <Download size={13} aria-hidden="true" /> Export CSV
                </button>
                <button className="vs-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
                  onClick={() => exportXLSX([
                    { name: 'Recognitions', data: extractSheetRows(extract.result) },
                    { name: 'Filters', data: extract.filterRows },
                  ], `valuespot-${periodType}-extract`)}>
                  <Download size={13} aria-hidden="true" /> Export XLSX
                </button>
              </div>

              {extract.result.rows.length === 0 ? (
                <EmptyState
                  icon={<FileText size={36} />}
                  title="No recognitions match"
                  description="Nothing was submitted in this period under these filters."
                />
              ) : (
                <div className="vs-card" style={{ overflow: 'hidden' }}>
                  <div className="overflow-x-auto">
                    <table className="vs-table w-full" style={{ minWidth: 820 }}>
                      <thead>
                        <tr style={{ background: 'color-mix(in srgb, var(--color-neutral-300) 30%, transparent)' }}>
                          {['Date', 'Nominee', 'Nominator', 'Core Value', 'Behaviour', 'Project', 'Status', 'Source'].map(h => (
                            <th key={h} style={{ whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {extract.result.rows.slice(0, 25).map(r => {
                          const s = STATUS_STYLE[r.status] ?? { label: r.status, cls: 'vs-tag-neutral' }
                          return (
                            <tr key={r.id}>
                              <td style={{ whiteSpace: 'nowrap', color: 'var(--color-neutral-600)', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                                {r.submitted_at ? formatIST(r.submitted_at) : '—'}
                              </td>
                              <td style={{ fontWeight: 500, color: 'var(--color-text)' }}>{r.nominee}</td>
                              <td style={{ color: 'var(--color-neutral-700)' }}>{r.nominator ?? '—'}</td>
                              <td style={{ color: 'var(--color-neutral-700)' }}>{r.core_value ?? '—'}</td>
                              <td style={{ color: 'var(--color-neutral-700)', fontSize: 12.5 }}>{r.behaviour ?? '—'}</td>
                              <td style={{ color: 'var(--color-neutral-700)' }}>{r.project ?? '—'}</td>
                              <td><span className={`vs-tag ${s.cls}`}>{s.label}</span></td>
                              <td style={{ color: 'var(--color-neutral-700)' }}>{SOURCE_LABEL[r.source ?? ''] ?? r.source ?? '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {extract.result.rows.length > 25 && (
                    <div style={{ padding: '10px 12px', borderTop: '1px solid var(--color-divider)', background: 'color-mix(in srgb, var(--color-neutral-300) 20%, transparent)' }}>
                      <p style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>
                        Showing first 25 of <strong style={{ color: 'var(--color-text)' }}>{extract.result.rows.length}</strong> rows — export to see all records.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
