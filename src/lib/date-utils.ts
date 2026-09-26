import { format, formatDistanceToNow, parseISO, startOfMonth, endOfMonth } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

const DEFAULT_TIMEZONE = 'Asia/Kolkata'

/** Format a UTC ISO string for display in IST */
export function formatIST(utcDate: string, fmt = 'dd MMM yyyy'): string {
  const zoned = toZonedTime(parseISO(utcDate), DEFAULT_TIMEZONE)
  return format(zoned, fmt)
}

/** Format a UTC ISO string with time in IST */
export function formatISTDateTime(utcDate: string): string {
  return formatIST(utcDate, 'dd MMM yyyy, hh:mm a')
}

/** Relative time like "2 hours ago" */
export function timeAgo(utcDate: string): string {
  return formatDistanceToNow(parseISO(utcDate), { addSuffix: true })
}

/** Get current date in IST as Date object */
export function nowIST(): Date {
  return toZonedTime(new Date(), DEFAULT_TIMEZONE)
}

/** Get the start/end of the current calendar year (for annual badge period) */
export function currentAnnualPeriod(): { start: string; end: string } {
  const now = nowIST()
  const year = now.getFullYear()
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  }
}

/**
 * Get the Touchcore financial year quarter boundaries.
 * Q1 = Apr–Jun, Q2 = Jul–Sep, Q3 = Oct–Dec, Q4 = Jan–Mar
 * q1StartMonth is 1-indexed (4 = April by default, configurable)
 */
export function getFinancialQuarter(
  date: Date,
  q1StartMonth = 4
): { quarter: number; start: Date; end: Date; label: string } {
  const month = date.getMonth() + 1 // 1-indexed
  const year = date.getFullYear()

  // Normalize month relative to Q1 start
  const offset = ((month - q1StartMonth + 12) % 12)
  const quarter = Math.floor(offset / 3) + 1

  // Quarter start month (1-indexed)
  const qStartMonth = ((q1StartMonth - 1 + (quarter - 1) * 3) % 12) + 1
  const qStartYear = qStartMonth > month
    ? year - 1
    : month === 1 && qStartMonth > 9 ? year - 1 : year

  const startDate = new Date(qStartYear, qStartMonth - 1, 1)
  const endDate = endOfMonth(new Date(qStartYear, qStartMonth + 1, 1))

  return {
    quarter,
    start: startDate,
    end: endDate,
    label: `Q${quarter} FY${year}`,
  }
}

/** Get current financial quarter label */
export function currentQuarterLabel(q1StartMonth = 4): string {
  return getFinancialQuarter(nowIST(), q1StartMonth).label
}

/** Get quarter boundaries as ISO date strings */
export function getQuarterBounds(
  quarter: number,
  fiscalYear: number,
  q1StartMonth = 4
): { start: string; end: string } {
  const qStartMonth = ((q1StartMonth - 1 + (quarter - 1) * 3) % 12) + 1
  // Q4 (Jan–Mar) belongs to the NEXT calendar year if Q1 starts in April
  const calendarYear = quarter === 4 && q1StartMonth === 4 ? fiscalYear + 1 : fiscalYear

  const start = new Date(calendarYear, qStartMonth - 1, 1)
  const end = endOfMonth(new Date(calendarYear, qStartMonth + 1, 1))

  return {
    start: format(start, 'yyyy-MM-dd'),
    end: format(end, 'yyyy-MM-dd'),
  }
}

/** Format a date range as a readable string */
export function formatDateRange(start: string, end: string): string {
  return `${formatIST(start, 'dd MMM')} – ${formatIST(end, 'dd MMM yyyy')}`
}

/** Get the start/end of a given month */
export function getMonthBounds(year: number, month: number): { start: string; end: string } {
  const date = new Date(year, month - 1, 1)
  return {
    start: format(startOfMonth(date), 'yyyy-MM-dd'),
    end: format(endOfMonth(date), 'yyyy-MM-dd'),
  }
}

/** Get today in IST as YYYY-MM-DD */
export function todayIST(): string {
  return format(nowIST(), 'yyyy-MM-dd')
}

/* ── Report periods ──────────────────────────────────────────
   One place that answers "what dates does this report cover, and what does it
   compare against". Monthly, quarterly and annual reports all resolve through
   here, so the bounds a report is generated from are the same bounds it prints
   and the same bounds the previous-period comparison is offset from.

   QUARTERS ARE THE COMPANY'S FINANCIAL QUARTERS, not calendar ones: Q1 is
   Apr–Jun, matching getFinancialQuarter() above and the quarter picker the
   Reports page has always shown. That convention predates this feature and is
   what the existing badge periods and exports already use.
*/

export type ReportPeriodType = 'monthly' | 'quarterly' | 'annual'

export interface ReportPeriod {
  type: ReportPeriodType
  /** Inclusive IST calendar dates, `yyyy-MM-dd`. */
  start: string
  end: string
  /** The equivalent previous period, for comparison. Same shape. */
  previousStart: string
  previousEnd: string
  /** For display: "September 2026", "Q2 FY2026", "2026". */
  label: string
  /** For display: "1 Sep 2026 – 30 Sep 2026". */
  rangeLabel: string
}

export interface ReportPeriodSelection {
  /** Monthly only, `yyyy-MM`. */
  month?: string
  /** Quarterly only, 1–4 over the FINANCIAL year. */
  quarter?: number
  /** Quarterly and annual. For quarters this is the financial year. */
  year?: number
}

function rangeLabelFor(start: string, end: string): string {
  return `${formatIST(start, 'd MMM yyyy')} – ${formatIST(end, 'd MMM yyyy')}`
}

/**
 * Resolve a report period and the equivalent period before it.
 *
 * The previous period is a genuine shift of the same unit, never "the 30 days
 * before": September compares with August, Q2 with Q1, 2026 with 2025. A
 * comparison against a window of a different length would make every figure
 * look like it moved.
 */
export function reportPeriod(
  type: ReportPeriodType,
  selection: ReportPeriodSelection = {},
): ReportPeriod {
  const now = nowIST()

  if (type === 'monthly') {
    const source = selection.month ?? format(now, 'yyyy-MM')
    const [y, m] = source.split('-').map(Number)
    const current = getMonthBounds(y, m)
    // Month 0 rolls to December of the previous year; date-fns' Date
    // constructor normalises it, so there is no special case to get wrong.
    const prevDate = new Date(y, m - 2, 1)
    const previous = getMonthBounds(prevDate.getFullYear(), prevDate.getMonth() + 1)

    return {
      type,
      start: current.start,
      end: current.end,
      previousStart: previous.start,
      previousEnd: previous.end,
      label: format(new Date(y, m - 1, 1), 'MMMM yyyy'),
      rangeLabel: rangeLabelFor(current.start, current.end),
    }
  }

  if (type === 'quarterly') {
    const fiscalYear = selection.year ?? now.getFullYear()
    const quarter = selection.quarter ?? getFinancialQuarter(now).quarter
    const current = getQuarterBounds(quarter, fiscalYear)

    // Q1's predecessor is Q4 of the previous financial year.
    const prevQuarter = quarter === 1 ? 4 : quarter - 1
    const prevFiscalYear = quarter === 1 ? fiscalYear - 1 : fiscalYear
    const previous = getQuarterBounds(prevQuarter, prevFiscalYear)

    return {
      type,
      start: current.start,
      end: current.end,
      previousStart: previous.start,
      previousEnd: previous.end,
      label: `Q${quarter} FY${fiscalYear}`,
      rangeLabel: rangeLabelFor(current.start, current.end),
    }
  }

  const year = selection.year ?? now.getFullYear()
  return {
    type,
    start: `${year}-01-01`,
    end: `${year}-12-31`,
    previousStart: `${year - 1}-01-01`,
    previousEnd: `${year - 1}-12-31`,
    label: String(year),
    rangeLabel: rangeLabelFor(`${year}-01-01`, `${year}-12-31`),
  }
}
