/**
 * The at-a-glance figures shown beside the AI interpretation.
 *
 * Every number here is lifted from the verified report the database counted —
 * never from the AI text. The interpretation panel shows them so a reader can
 * take in the situation before reading a word of commentary, and so the
 * commentary always sits next to the facts it is about.
 */
import type { EmployeeReport, OrganizationReport } from '@/lib/api'
import type { ReportPeriodType } from '@/lib/date-utils'

export interface GlanceStat {
  label: string
  value: string
  /** Change against the previous period, when the report has one. */
  delta?: number | null
  /** Per-bucket values for a sparkline — only when the report has enough data for a trend. */
  spark?: number[]
  /** A short extra line, e.g. "+1 this period". */
  note?: string
}

export interface GlanceValue {
  name: string
  count: number
}

export interface GlanceBadge {
  coreValue: string
  name: string
  level: number
}

export interface ReportGlance {
  stats: GlanceStat[]
  /** Every core value in the report, most recognized first. */
  values: GlanceValue[]
  /** Badges currently held — employee reports only. */
  badges?: GlanceBadge[]
}

/** "month", "quarter", "year" — for "vs last month". */
export function periodNoun(type: ReportPeriodType): string {
  return type === 'monthly' ? 'month' : type === 'quarterly' ? 'quarter' : 'year'
}

const byCount = (a: GlanceValue, b: GlanceValue) => b.count - a.count || a.name.localeCompare(b.name)

export function employeeGlance(r: EmployeeReport): ReportGlance {
  const prev = r.recognition.previous
  const held = r.badges.current.filter(b => (b.badge_level ?? 0) > 0)
  const earned = r.badges.earned_in_period.length

  return {
    stats: [
      {
        label: 'Recognitions received',
        value: String(r.recognition.received.approved),
        delta: prev ? r.recognition.received.approved - prev.received_approved : null,
        spark: r.trend.sufficient ? r.trend.buckets.map(b => b.received ?? 0) : undefined,
      },
      {
        label: 'Recognitions given',
        value: String(r.recognition.given.approved),
        delta: prev ? r.recognition.given.approved - prev.given_approved : null,
        spark: r.trend.sufficient ? r.trend.buckets.map(b => b.given ?? 0) : undefined,
      },
      {
        label: r.recognition.unique_recognizers === 1 ? 'Colleague recognized them' : 'Colleagues recognized them',
        value: String(r.recognition.unique_recognizers),
      },
      {
        label: held.length === 1 ? 'Badge held' : 'Badges held',
        value: String(held.length),
        note: earned > 0 ? `+${earned} earned this period` : undefined,
      },
    ],
    values: r.core_values.map(v => ({ name: v.name, count: v.count })).sort(byCount),
    badges: held
      .map(b => ({ coreValue: b.core_value, name: b.badge_name ?? `Level ${b.badge_level}`, level: b.badge_level ?? 0 }))
      .sort((a, b) => b.level - a.level || a.coreValue.localeCompare(b.coreValue)),
  }
}

export function organizationGlance(r: OrganizationReport): ReportGlance {
  const t = r.totals
  return {
    stats: [
      {
        label: 'Recognitions approved',
        value: String(t.recognitions.approved),
        delta: t.previous_approved === null ? null : t.recognitions.approved - t.previous_approved,
        spark: r.trend.sufficient ? r.trend.buckets.map(b => b.recognitions ?? 0) : undefined,
      },
      {
        label: 'Employees recognized',
        value: `${t.employees_recognized} of ${t.employees_active}`,
      },
      {
        label: 'Participation',
        value: `${t.participation_pct}%`,
        note: `${t.employees_giving} ${t.employees_giving === 1 ? 'person' : 'people'} gave recognition`,
      },
      {
        label: 'Badges awarded',
        value: String(r.badges.awarded_in_period),
      },
    ],
    values: r.core_values.map(v => ({ name: v.name, count: v.count })).sort(byCount),
  }
}
