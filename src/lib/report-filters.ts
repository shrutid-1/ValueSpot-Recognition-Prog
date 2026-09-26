import {
  RECOGNITION_SOURCES, RECOGNITION_STATUSES,
  type ReportFilters, type ReportFilterOptions,
} from '@/lib/api'

/**
 * The report filters' vocabulary: what each is called, in what order they are
 * shown, and how a chosen value reads back as words — on the chips above a
 * report and on the "Filters" sheet of every export, so a spreadsheet that
 * outlives the page still says what it was a report OF.
 */

export type FilterKey = keyof ReportFilters

export const FILTER_ORDER: FilterKey[] = [
  'department_id', 'project_id', 'employee_id',
  'core_value_id', 'behaviour_id', 'source', 'status',
]

export const FILTER_LABELS: Record<FilterKey, string> = {
  department_id: 'Department',
  project_id:    'Project',
  employee_id:   'Employee',
  core_value_id: 'Core Value',
  behaviour_id:  'Behaviour',
  source:        'Source',
  status:        'Status',
}

/** The filters that narrow recognitions, as opposed to choosing people. */
export const ROW_FILTER_KEYS: FilterKey[] = ['project_id', 'core_value_id', 'behaviour_id', 'source', 'status']

export function hasRowFilters(filters: ReportFilters): boolean {
  return ROW_FILTER_KEYS.some(k => Boolean(filters[k]))
}

export function activeFilterCount(filters: ReportFilters): number {
  return FILTER_ORDER.filter(k => Boolean(filters[k])).length
}

/** A filter value as words. Falls back to "selected" when options are not loaded yet. */
export function filterValueLabel(
  key: FilterKey,
  value: string,
  options: ReportFilterOptions | undefined,
): string {
  switch (key) {
    case 'department_id': return options?.departments.find(d => d.id === value)?.name ?? 'Selected department'
    case 'project_id':    return options?.projects.find(p => p.id === value)?.name ?? 'Selected project'
    case 'employee_id': {
      const e = options?.employees.find(x => x.id === value)
      return e ? `${e.full_name} (${e.employee_id})` : 'Selected employee'
    }
    case 'core_value_id': return options?.core_values.find(v => v.id === value)?.name ?? 'Selected core value'
    case 'behaviour_id':  return options?.behaviours.find(b => b.id === value)?.name ?? 'Selected behaviour'
    case 'source':        return RECOGNITION_SOURCES.find(s => s.value === value)?.label ?? value
    case 'status':        return RECOGNITION_STATUSES.find(s => s.value === value)?.label ?? value
  }
}

export function describeFilters(
  filters: ReportFilters,
  options: ReportFilterOptions | undefined,
): Array<{ key: FilterKey; label: string; value: string }> {
  return FILTER_ORDER
    .filter(k => Boolean(filters[k]))
    .map(k => ({ key: k, label: FILTER_LABELS[k], value: filterValueLabel(k, filters[k] as string, options) }))
}

/** The rows of an export's "Filters" sheet. The period comes first. */
export function filterSheetRows(
  periodLabel: string,
  rangeLabel: string,
  filters: ReportFilters,
  options: ReportFilterOptions | undefined,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [
    { 'Filter': 'Period', 'Value': `${periodLabel} (${rangeLabel})` },
  ]
  const described = describeFilters(filters, options)
  if (described.length === 0) {
    rows.push({ 'Filter': 'Filters', 'Value': 'None — every recognition in scope' })
  }
  for (const d of described) rows.push({ 'Filter': d.label, 'Value': d.value })
  return rows
}
