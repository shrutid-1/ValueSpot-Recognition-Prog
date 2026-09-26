import { SlidersHorizontal, X } from 'lucide-react'
import {
  RECOGNITION_SOURCES, RECOGNITION_STATUSES,
  type ReportFilters, type ReportFilterOptions,
} from '@/lib/api'
import { describeFilters, type FilterKey } from '@/lib/report-filters'

/**
 * The seven report filters that sit beside the period: department, project,
 * employee, core value, behaviour, source, status.
 *
 * The options come from report_filter_options() (061), already scoped — a
 * Manager is offered their own projects, their team's departments and their
 * team. Nothing here decides scope; a filter can only narrow a report.
 *
 * The dropdowns keep each other honest so an impossible combination is hard to
 * reach by accident: choosing a core value drops a behaviour from another
 * value, choosing a behaviour fills in its value, and narrowing by department
 * or project drops an employee who no longer fits.
 */

const selectStyle: React.CSSProperties = { height: 32, fontSize: 13 }

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label
        htmlFor={id}
        style={{ display: 'block', fontSize: 12, color: 'var(--color-neutral-600)', marginBottom: 4 }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

export function ReportFiltersPanel({ options, loading, error, filters, onChange }: {
  options: ReportFilterOptions | undefined
  loading: boolean
  error: string | null
  filters: ReportFilters
  onChange: (next: ReportFilters) => void
}) {
  const team = options?.scope === 'team'

  // The employee dropdown follows the department and project filters.
  const employees = (options?.employees ?? []).filter(e =>
    (!filters.department_id || e.department_id === filters.department_id)
    && (!filters.project_id || (e.project_ids ?? []).includes(filters.project_id)),
  )

  const behaviours = options?.behaviours ?? []
  const coreValues = options?.core_values ?? []

  function set(key: FilterKey, value: string) {
    const next: ReportFilters = { ...filters, [key]: value || undefined }

    if (key === 'core_value_id' && next.behaviour_id) {
      const b = behaviours.find(x => x.id === next.behaviour_id)
      if (!value || b?.core_value_id !== value) next.behaviour_id = undefined
    }
    if (key === 'behaviour_id' && value) {
      const b = behaviours.find(x => x.id === value)
      if (b) next.core_value_id = b.core_value_id
    }
    if ((key === 'department_id' || key === 'project_id') && next.employee_id && options) {
      const e = options.employees.find(x => x.id === next.employee_id)
      const fits = e
        && (!next.department_id || e.department_id === next.department_id)
        && (!next.project_id || (e.project_ids ?? []).includes(next.project_id))
      if (!fits) next.employee_id = undefined
    }
    onChange(next)
  }

  const active = describeFilters(filters, options)

  return (
    <div className="vs-card">
      <div
        className="flex items-start justify-between gap-3 flex-wrap"
        style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--color-divider)' }}
      >
        <div>
          <h3 className="font-condensed flex items-center gap-1.5" style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
            <SlidersHorizontal size={14} aria-hidden="true" /> Filters
          </h3>
          <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 3, lineHeight: 1.45 }}>
            Apply to every report on this page. Department and employee match the person recognised;
            the others match the recognition itself.
            {team && ' Only your team is ever included.'}
          </p>
        </div>
        {active.length > 0 && (
          <button
            className="vs-btn"
            style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => onChange({})}
          >
            <X size={12} aria-hidden="true" /> Clear all ({active.length})
          </button>
        )}
      </div>

      <div style={{ padding: '14px 16px 16px' }}>
        {error && (
          <p role="alert" style={{ fontSize: 13, color: 'var(--color-accent-800)', marginBottom: 10 }}>
            {error}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field id="flt-dept" label="Department">
            <select id="flt-dept" className="vs-input w-full" style={selectStyle} disabled={loading}
              value={filters.department_id ?? ''} onChange={e => set('department_id', e.target.value)}>
              <option value="">All departments</option>
              {(options?.departments ?? []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>

          <Field id="flt-project" label="Project">
            <select id="flt-project" className="vs-input w-full" style={selectStyle} disabled={loading}
              value={filters.project_id ?? ''} onChange={e => set('project_id', e.target.value)}>
              <option value="">{team ? 'All my projects' : 'All projects'}</option>
              {(options?.projects ?? []).map(p => (
                <option key={p.id} value={p.id}>{p.name}{p.is_active ? '' : ' (archived)'}</option>
              ))}
            </select>
          </Field>

          <Field id="flt-employee" label="Employee">
            <select id="flt-employee" className="vs-input w-full" style={selectStyle} disabled={loading}
              value={filters.employee_id ?? ''} onChange={e => set('employee_id', e.target.value)}>
              <option value="">{team ? 'Everyone on my team' : 'All employees'}</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.full_name} · {e.employee_id}</option>
              ))}
            </select>
          </Field>

          <Field id="flt-value" label="Core Value">
            <select id="flt-value" className="vs-input w-full" style={selectStyle} disabled={loading}
              value={filters.core_value_id ?? ''} onChange={e => set('core_value_id', e.target.value)}>
              <option value="">All core values</option>
              {coreValues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>

          <Field id="flt-behaviour" label="Behaviour">
            <select id="flt-behaviour" className="vs-input w-full" style={selectStyle} disabled={loading}
              value={filters.behaviour_id ?? ''} onChange={e => set('behaviour_id', e.target.value)}>
              <option value="">All behaviours</option>
              {filters.core_value_id
                ? behaviours
                    .filter(b => b.core_value_id === filters.core_value_id)
                    .map(b => <option key={b.id} value={b.id}>{b.name}</option>)
                : coreValues.map(v => (
                    <optgroup key={v.id} label={v.name}>
                      {behaviours.filter(b => b.core_value_id === v.id)
                        .map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </optgroup>
                  ))}
            </select>
          </Field>

          <Field id="flt-source" label="Source">
            <select id="flt-source" className="vs-input w-full" style={selectStyle}
              value={filters.source ?? ''} onChange={e => set('source', e.target.value)}>
              <option value="">All sources</option>
              {RECOGNITION_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>

          <Field id="flt-status" label="Status">
            <select id="flt-status" className="vs-input w-full" style={selectStyle}
              value={filters.status ?? ''} onChange={e => set('status', e.target.value)}>
              <option value="">All statuses</option>
              {RECOGNITION_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
        </div>

        {active.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" style={{ marginTop: 12 }} aria-label="Active filters">
            {active.map(a => (
              <li key={a.key}>
                <button
                  className="vs-tag vs-tag-neutral"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, cursor: 'pointer', border: 'none' }}
                  onClick={() => set(a.key, '')}
                  aria-label={`Remove filter ${a.label}: ${a.value}`}
                >
                  <span style={{ opacity: 0.75 }}>{a.label}:</span> {a.value} <X size={11} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
