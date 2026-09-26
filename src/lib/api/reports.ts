/**
 * Recognition reports.
 *
 * Two quite different things live here, deliberately in one module because
 * they are one domain:
 *
 *   getExtract()              the row-level extract — every recognition in a
 *                             period that matches the filters, one row each
 *   getEmployeeReport()       what the recognition data SAYS about one person
 *   getScopedReport()         the same question, asked of the caller's whole
 *                             scope: the organisation, or a Manager's team
 *   getOrganizationReport()   the unfiltered organisation report the AI
 *                             insights are generated from
 *   getFilterOptions()        what the eight report filters may offer
 *   getInsights()             an AI interpretation, clearly labelled
 *
 * The extract remains the only place in the frontend that reads a
 * recognition's full narrative text in bulk.
 *
 * THE FACTUAL REPORTS ARE ONE CALL EACH.
 *
 * employee_report() and organization_report() (migration 043) aggregate
 * everything in the database and return one object: profile, counts by status,
 * core values with their behaviours and scenarios, badges, projects,
 * contributors, trend. The alternative — a query for the employee, one per core
 * value, one for badges, one per project — is the N+1 this shape exists to
 * avoid, and it would also be free to disagree with itself between round trips.
 *
 * AUTHORIZATION IS THE DATABASE'S, and none is performed here. Both functions
 * resolve the caller from the session and refuse through may_report_on() before
 * reading anything: a Manager is scoped to the active members of the active
 * projects they manage, HR and Super Admin are organisation-wide. The employee
 * id in a request is the SUBJECT, never the authority.
 */
import type { Employee, UserRole } from '@/types'
import type { ReportPeriod, ReportPeriodType } from '@/lib/date-utils'
import { supabase, toApiError, ApiError } from './client'

/**
 * The most rows one extract will return.
 *
 * The cap exists so the page cannot be asked to render and serialise an
 * unbounded result. It is NOT a silent truncation: `truncated` says the extract
 * hit the ceiling, the screen must say so, and the user can narrow the period
 * or the filters to get a complete one. recognition_extract() (061) enforces
 * the same number server-side.
 */
export const REPORT_ROW_LIMIT = 5000

// ── Filters ─────────────────────────────────────────────────

export type RecognitionSource = 'peer' | 'manager' | 'hr' | 'leadership'
export type ReportStatusFilter = 'pending' | 'approved' | 'rejected' | 'clarification_requested'

/**
 * The eight report filters, less the period, which travels separately.
 *
 * Every key is optional and an absent key means "any". Department and
 * employee describe the person RECOGNISED; project, core value, behaviour,
 * source and status describe the recognition. The database normalises this
 * object (report_filters_clean, 061) and ignores anything it does not know,
 * so a filter can only narrow a report — never widen the caller's scope.
 */
export interface ReportFilters {
  department_id?: string
  project_id?: string
  employee_id?: string
  core_value_id?: string
  behaviour_id?: string
  source?: RecognitionSource
  status?: ReportStatusFilter
}

export const RECOGNITION_SOURCES: Array<{ value: RecognitionSource; label: string }> = [
  { value: 'peer',       label: 'Peer' },
  { value: 'manager',    label: 'Manager' },
  { value: 'hr',         label: 'HR' },
  { value: 'leadership', label: 'Leadership' },
]

export const RECOGNITION_STATUSES: Array<{ value: ReportStatusFilter; label: string }> = [
  { value: 'approved',                label: 'Approved' },
  { value: 'pending',                 label: 'Pending' },
  { value: 'clarification_requested', label: 'Clarification requested' },
  { value: 'rejected',                label: 'Rejected' },
]

/** Drop empty keys, so equal filters always serialise — and cache — equally. */
export function compactFilters(filters: ReportFilters): ReportFilters {
  const out: ReportFilters = {}
  for (const key of Object.keys(filters).sort() as Array<keyof ReportFilters>) {
    const value = filters[key]
    if (value) (out as Record<string, string>)[key] = value
  }
  return out
}

/** What the filter dropdowns may offer the caller. Shape of report_filter_options() (061). */
export interface ReportFilterOptions {
  scope: 'organization' | 'team'
  departments: Array<{ id: string; name: string }>
  projects: Array<{ id: string; name: string; is_active: boolean }>
  core_values: Array<{ id: string; name: string; slug: string }>
  behaviours: Array<{ id: string; name: string; core_value_id: string }>
  employees: ReportSubject[]
}

// ── Extract ─────────────────────────────────────────────────

/** One recognition in the extract. Shape of recognition_extract() rows (061). */
export interface ExtractRow {
  id: string
  submitted_at: string | null
  approved_at: string | null
  status: string
  source: string | null
  nominator: string | null
  nominee: string
  nominee_employee_id: string
  core_value: string | null
  behaviour: string | null
  project: string | null
  nominator_dept: string | null
  nominee_dept: string | null
  /**
   * True when the caller may count this recognition but not read its story —
   * a Manager, for a team member's recognition that is not yet approved and
   * is being decided by somebody else. The two text fields are then null.
   */
  narrative_withheld: boolean
  what_happened: string | null
  what_impact: string | null
}

export interface ExtractResult {
  scope: 'organization' | 'team'
  rows: ExtractRow[]
  /** Counts EVERY matching recognition, including any beyond the cap. */
  summary: RecognitionCounts
  /** True when more recognitions matched than `limit`. */
  truncated: boolean
  limit: number
}

// ── Report shapes ───────────────────────────────────────────

/** An employee the caller may report on. Shape of report_subjects() (043, 061). */
export interface ReportSubject {
  id: string
  full_name: string
  employee_id: string
  email: string
  role: UserRole
  avatar_url: string | null
  department: string | null
  /** 061. Absent until that migration is applied. */
  department_id?: string | null
  projects: string[]
  /** 061. Absent until that migration is applied. */
  project_ids?: string[]
}

export interface RecognitionCounts {
  total: number
  approved: number
  pending: number
  rejected: number
  clarification_requested: number
}

export interface ReportCoreValue {
  id: string
  name: string
  slug: string
  accent_color: string | null
  count: number
  share_pct: number
  previous_count: number
  behaviours: Array<{ name: string; count: number }>
  scenarios: Array<{ name: string; count: number }>
}

export interface ReportTrend {
  granularity: 'week' | 'month'
  buckets: Array<{
    start: string
    label: string
    received?: number
    given?: number
    recognitions?: number
    employees_recognized?: number
  }>
  /**
   * False when fewer than three buckets hold any activity.
   *
   * The report then says "insufficient data for trend analysis" rather than
   * drawing a line through two points, and the AI layer is instructed to do
   * the same rather than describe a direction.
   */
  sufficient: boolean
}

export interface ReportPeriodBounds {
  start: string
  end: string
  previous_start: string | null
  previous_end: string | null
  days: number
}

/** One employee's factual report. Shape of employee_report() (043). */
export interface EmployeeReport {
  status: 'ok'
  generated_at: string
  period: ReportPeriodBounds
  /** The row filters the database applied (061); empty when unfiltered. */
  filters?: ReportFilters
  employee: Pick<Employee, 'id' | 'full_name' | 'employee_id' | 'role' | 'joined_at' | 'is_active'>
    & { department: string | null }
  recognition: {
    received: RecognitionCounts
    given: RecognitionCounts
    /** Distinct colleagues, not recognitions: nine from one person is not nine people. */
    unique_recognizers: number
    previous: { received_approved: number; given_approved: number } | null
  }
  core_values: ReportCoreValue[]
  behaviours: Array<{ name: string; core_value: string; count: number }>
  badges: {
    /** Standing now — a running annual total, NOT confined to the period. */
    current: Array<{
      core_value: string
      core_value_slug: string
      badge_level: number | null
      badge_name: string | null
      badge_description: string | null
      badge_icon: string | null
      recognition_count: number
      unique_recognizer_count: number
      period_type: string
      period_start: string
      period_end: string
      next_level_at: number | null
    }>
    /** What actually changed inside the period, from badge_history. */
    earned_in_period: Array<{
      core_value: string
      previous_level: number | null
      new_level: number
      badge_name: string | null
      achieved_at: string
    }>
  }
  projects: Array<{ id: string; name: string; joined_at: string | null; recognitions: number }>
  contributors: Array<{ id: string; full_name: string; count: number }>
  trend: ReportTrend
}

/** The consolidated organisation report. Shape of organization_report() (043). */
export interface OrganizationReport {
  status: 'ok'
  generated_at: string
  period: ReportPeriodBounds
  totals: {
    employees_active: number
    employees_recognized: number
    employees_giving: number
    /** Share of active employees who received at least one approved recognition. */
    participation_pct: number
    recognitions: RecognitionCounts
    previous_approved: number | null
  }
  core_values: Array<Omit<ReportCoreValue, 'behaviours' | 'scenarios'>>
  behaviours: Array<{ name: string; core_value: string; count: number }>
  badges: {
    by_level: Array<{ level: number; name: string; holders: number }>
    awarded_in_period: number
  }
  departments: Array<{ name: string; recognitions: number; employees_recognized: number }>
  projects: Array<{ name: string; recognitions: number; employees_recognized: number }>
  trend: ReportTrend
}

/** One employee's line in a consolidated report. */
export interface ScopedReportEmployee {
  id: string
  full_name: string
  employee_id: string
  email: string
  designation: string | null
  role: UserRole
  department: string | null
  projects: string[]
  received: RecognitionCounts
  given_approved: number
  unique_recognizers: number
  top_core_value: string | null
  badges_held: number
  top_badge_level: number | null
  top_badge_name: string | null
}

/**
 * The consolidated report, filtered. Shape of scoped_report() (061).
 *
 * The organisation report's shape, so every organisation view and the AI
 * glance read it unchanged, plus which scope the database chose from the
 * caller's role, the filters it actually applied, and one row per employee.
 */
export interface ScopedReport extends OrganizationReport {
  scope: 'organization' | 'team'
  filters: ReportFilters
  employees: ScopedReportEmployee[]
}

/**
 * The AI interpretation of a report.
 *
 * Prose only. Every number in a report comes from the factual sections above;
 * nothing in here is a metric, and the UI labels it as generated commentary
 * wherever it appears — including in exports.
 */
export interface ReportInsight {
  /**
   * The one-line takeaway (format 2). Absent on interpretations cached before
   * it existed; the page falls back to the summary's first sentence.
   */
  headline?: string
  summary: string
  strengths: string[]
  development_opportunities: string[]
  recommendations: string[]
  core_value_insights: string
  recognition_pattern: string
  badge_summary: string
  /** Where the data was too thin to support a conclusion. */
  evidence_limitations: string[]
}

export interface ReportInsightResult {
  insight: ReportInsight
  /** True when this came from the cache rather than a fresh generation. */
  cached: boolean
  provider: string
  model: string
  generated_at: string
}

/*
  Cast because supabase-types.ts is generated from the schema and has not been
  regenerated since 043 added these functions — the same reason referenceApi
  casts for selectable_recognition_projects(). Regenerating needs a local
  database (`npm run supabase:types` targets --local), which this change does
  not otherwise require.
*/
function callRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: unknown }> {
  return (supabase.rpc as unknown as (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>)(fn, args)
}

/** Turn a report function's non-ok status into the right message. */
function reportFailure(status: string | undefined, forbidden: string, fallback: string): ApiError {
  if (status === 'forbidden') return new ApiError(forbidden, 'forbidden')
  if (status === 'invalid_period') return new ApiError('That reporting period is not valid.', status)
  return new ApiError(fallback, status ?? 'unknown')
}

export const reportsApi = {
  /**
   * Every recognition in a period that matches the filters, one row each.
   *
   * ONE call to recognition_extract() (061), which scopes the rows exactly as
   * the reports are scoped — the organisation for HR and Super Admin, the team
   * for a Manager — and applies the cap itself. This used to be a paged query
   * against `nominations` from the browser, which only ever worked for HR: a
   * Manager's row policy admits just the recognitions assigned to them.
   */
  async getExtract(input: {
    period: ReportPeriod
    filters: ReportFilters
    limit?: number
  }): Promise<ExtractResult> {
    const { data, error } = await callRpc('recognition_extract', {
      p_start: input.period.start,
      p_end: input.period.end,
      p_filters: compactFilters(input.filters),
      p_limit: input.limit ?? REPORT_ROW_LIMIT,
    })

    if (error) throw toApiError(error, 'Could not generate that extract.')

    const result = data as ({ status?: string } & ExtractResult) | null
    if (result?.status !== 'ok') {
      throw reportFailure(
        result?.status,
        'You do not have access to recognitions for that selection.',
        'Could not generate that extract.',
      )
    }
    return result
  },

  /**
   * What the filter dropdowns may offer. Scoped by the database from the
   * session: a Manager is offered their projects, their team's departments
   * and their team; HR and Super Admin the organisation.
   */
  async getFilterOptions(): Promise<ReportFilterOptions> {
    const { data, error } = await callRpc('report_filter_options', {})

    if (error) throw toApiError(error, 'Could not load the report filters.')

    const result = data as ({ status?: string } & ReportFilterOptions) | null
    if (result?.status !== 'ok') {
      throw reportFailure(result?.status, 'Reports are not available to you.', 'Could not load the report filters.')
    }
    return result
  },

  /**
   * The consolidated report for the caller's scope — the organisation for HR
   * and Super Admin, their own team for a Manager — with one row per employee.
   *
   * Nothing here names the scope: scoped_report() (061) chooses it from the
   * caller's role, and the filters can only narrow it.
   */
  async getScopedReport(input: { period: ReportPeriod; filters: ReportFilters }): Promise<ScopedReport> {
    const { data, error } = await callRpc('scoped_report', {
      p_start: input.period.start,
      p_end: input.period.end,
      p_prev_start: input.period.previousStart,
      p_prev_end: input.period.previousEnd,
      p_filters: compactFilters(input.filters),
    })

    if (error) throw toApiError(error, 'Could not generate that report.')

    const result = data as { status?: string } | null
    if (result?.status !== 'ok') {
      throw reportFailure(
        result?.status,
        'You do not have access to a report for that selection.',
        'Could not generate that report.',
      )
    }
    return data as ScopedReport
  },

  /**
   * The employees this person may report on.
   *
   * No role argument and no team argument: report_subjects() reads the caller's
   * scope from the session. A Manager gets the active members of the active
   * projects they manage — once each, however many of those projects they are
   * on — and HR and a Super Admin get the organisation. There is nothing in the
   * request that could ask for somebody else's team.
   */
  async listSubjects(search?: string): Promise<ReportSubject[]> {
    const { data, error } = await callRpc('report_subjects', {
      p_search: search?.trim() || null,
    })

    if (error) throw toApiError(error, 'Could not load the employee list.')
    return (data as ReportSubject[] | null) ?? []
  },

  /**
   * One employee's factual report for a period.
   *
   * A refusal is raised rather than returned as an empty report: "you may not
   * see this" and "there is nothing to see" are different answers and the page
   * shows them differently.
   */
  async getEmployeeReport(input: {
    employeeId: string
    period: ReportPeriod
    /**
     * Project, core value, behaviour, source and status narrow the counts.
     * Department and employee choose the subject, so they are not sent.
     */
    filters?: ReportFilters
  }): Promise<EmployeeReport> {
    const f = input.filters ?? {}
    const rowFilters: ReportFilters = {
      project_id: f.project_id,
      core_value_id: f.core_value_id,
      behaviour_id: f.behaviour_id,
      source: f.source,
      status: f.status,
    }
    const { data, error } = await callRpc('employee_report', {
      p_employee_id: input.employeeId,
      p_start: input.period.start,
      p_end: input.period.end,
      p_prev_start: input.period.previousStart,
      p_prev_end: input.period.previousEnd,
      p_filters: compactFilters(rowFilters),
    })

    if (error) throw toApiError(error, 'Could not generate that report.')

    const result = data as { status?: string } | null
    if (result?.status !== 'ok') {
      throw reportFailure(
        result?.status,
        'You do not have access to reports for this employee.',
        'Could not generate that report.',
      )
    }
    return data as EmployeeReport
  },

  /** The consolidated organisation report. HR and Super Admin only. */
  async getOrganizationReport(input: { period: ReportPeriod }): Promise<OrganizationReport> {
    const { data, error } = await callRpc('organization_report', {
      p_start: input.period.start,
      p_end: input.period.end,
      p_prev_start: input.period.previousStart,
      p_prev_end: input.period.previousEnd,
    })

    if (error) throw toApiError(error, 'Could not generate the organisation report.')

    const result = data as { status?: string } | null
    if (result?.status !== 'ok') {
      throw reportFailure(
        result?.status,
        'Organisation-wide reports are available to HR and Super Admins.',
        'Could not generate the organisation report.',
      )
    }
    return data as OrganizationReport
  },

  /**
   * The AI interpretation of a report.
   *
   * Goes through the generate-report-insights Edge Function, never to a model
   * from here: the provider key is a Supabase Function secret and there is no
   * code path from the browser to it. That function re-fetches the facts from
   * the database rather than trusting anything sent from here, so the model is
   * always describing verified data and a caller cannot feed it its own.
   *
   * ALWAYS FAILS SOFT. A missing key, a rate limit, an unreachable provider or
   * an unusable response all arrive as an ApiError the page renders as "AI
   * insights are currently unavailable" beside a factual report that is already
   * on screen. AI is an enhancement layer; nothing here may take the report
   * down with it.
   */
  async getInsights(input: {
    scope: 'employee' | 'organization'
    employeeId?: string
    periodType: ReportPeriodType
    period: ReportPeriod
  }): Promise<ReportInsightResult> {
    const { data, error } = await supabase.functions.invoke('generate-report-insights', {
      body: {
        scope: input.scope,
        employee_id: input.employeeId ?? null,
        period_type: input.periodType,
        start: input.period.start,
        end: input.period.end,
        previous_start: input.period.previousStart,
        previous_end: input.period.previousEnd,
      },
    })

    if (!error) {
      const result = data as {
        insight: ReportInsight
        cached?: boolean
        provider: string
        model: string
        generated_at: string
      }
      return {
        insight: result.insight,
        cached: Boolean(result.cached),
        provider: result.provider,
        model: result.model,
        generated_at: result.generated_at,
      }
    }

    /*
      The refusal body carries the reason, and invoke() puts it out of reach on
      the error object — so it is read back off the Response, the same way
      employeesApi.deleteEmployee and recognitionsApi.decide do. It matters here
      because "not configured yet" and "the provider is rate limiting us" are
      different things for whoever has to fix them.
    */
    const response = (error as { context?: Response }).context
    const httpStatus = typeof response?.status === 'number' ? response.status : null

    if (response && typeof response.json === 'function') {
      const body = await response.json().catch(() => null) as
        { error?: string; status?: string; message?: string } | null

      /*
        TWO DIFFERENT BODIES arrive here, and reading only the first is what
        made a broken deployment indistinguishable from a busy model.

        The Edge Function answers with { error, status }. The platform GATEWAY,
        when the function is not deployed or the request never reaches it,
        answers with { message } and no `error` key at all — so `body?.error`
        alone fell through to the generic sentence below and told the user
        nothing. employeesApi.deleteEmployee already had this exact branch; this
        one should have been written the same way and was not.
      */
      const detail = body?.error ?? body?.message
      if (detail) {
        throw new ApiError(detail, body?.status ?? 'ai_unavailable', error)
      }
    }

    // Nothing usable in the body. Say which layer failed rather than repeating
    // "unavailable", so the next person knows where to look.
    if (httpStatus === 404) {
      throw new ApiError(
        'AI insights are not installed on this project yet — the ' +
        'generate-report-insights function is not deployed.',
        'function_not_deployed',
        error,
      )
    }

    throw new ApiError(
      httpStatus
        ? `The AI service could not be reached (server returned ${httpStatus}).`
        : 'The AI service could not be reached.',
      'ai_unavailable',
      error,
    )
  },
}
