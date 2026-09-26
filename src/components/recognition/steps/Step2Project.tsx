import { useState } from 'react'
import { FolderKanban, AlertTriangle } from 'lucide-react'
import { useSelectableProjects } from '@/hooks/queries'
import { SkeletonLoader } from '@/components/shared/SkeletonLoader'
import type { SelectableProject } from '@/lib/api'

interface Step2ProjectProps {
  selectedId: string | null
  onSelect: (project: SelectableProject) => void
}

/**
 * Which project this recognition is about.
 *
 * An explicit, mandatory choice by the person giving the recognition — they
 * are the one who saw the work, so they are the one who knows which project it
 * belonged to. It is deliberately NOT inferred from the nominee: people are
 * regularly recognised for work outside whatever project they are nominally
 * assigned to, and inferring it would silently file the recognition against
 * the wrong one.
 *
 * The choice also settles who approves, because a project's manager approves
 * its recognitions. That consequence is shown here so it is visible before
 * submitting — but it is shown, not decided. The approver is re-derived by the
 * database on insert from this project, and nothing the browser sends can
 * change it.
 */
export function Step2Project({ selectedId, onSelect }: Step2ProjectProps) {
  const query = useSelectableProjects()
  const projects = query.data ?? []

  const [choice, setChoice] = useState<string>(selectedId ?? '')
  const [error, setError] = useState<string | null>(null)

  const chosen = projects.find(p => p.project_id === choice) ?? null

  const submit = () => {
    if (!chosen) {
      setError('Select the project this recognition relates to.')
      return
    }
    setError(null)
    onSelect(chosen)
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">Which project was this?</h2>
        <p className="text-sm text-text-muted mt-1">
          Choose the project the work belonged to. Its Project Manager reviews the
          recognition.
        </p>
      </div>

      {query.isLoading ? (
        <SkeletonLoader rows={3} />
      ) : projects.length === 0 ? (
        <div
          className="flex items-start gap-2.5 p-3 rounded-lg"
          style={{ border: '1px solid var(--color-divider)' }}
        >
          <AlertTriangle size={16} className="text-danger shrink-0" style={{ marginTop: 2 }} aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-text-primary">No projects available</p>
            <p className="text-sm text-text-muted" style={{ marginTop: 3, lineHeight: 1.5 }}>
              A recognition has to be filed against an active project that has a
              Project Manager, and there are none yet. Ask HR to set one up.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <label htmlFor="recognition-project" className="text-sm font-medium text-text-primary">
              Project{' '}
              <span className="text-danger" aria-hidden="true">*</span>
            </label>
            <select
              id="recognition-project"
              className="w-full h-10 rounded-lg border border-border bg-surface px-3 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              value={choice}
              onChange={e => { setChoice(e.target.value); setError(null) }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'project-error' : undefined}
              autoFocus
            >
              <option value="">Select a project…</option>
              {projects.map(p => (
                <option key={p.project_id} value={p.project_id}>{p.project_name}</option>
              ))}
            </select>
            {error && (
              <p id="project-error" className="text-sm text-danger" role="alert">{error}</p>
            )}
          </div>

          {/* Confirmation of the consequence, not a choice of approver. */}
          {chosen && (
            <div className="p-3 rounded-lg" style={{ border: '1px solid var(--color-divider)' }}>
              <div className="flex items-center gap-2">
                <FolderKanban size={15} className="text-text-muted shrink-0" aria-hidden="true" />
                <p className="text-sm font-medium text-text-primary">{chosen.project_name}</p>
              </div>
              <p className="text-xs text-text-muted" style={{ marginTop: 5, lineHeight: 1.5 }}>
                Goes to <strong className="text-text-primary">{chosen.manager_name}</strong> for approval.
              </p>
            </div>
          )}

          <button
            className="vs-btn vs-btn-primary relative w-full"
            onClick={submit}
            disabled={!chosen}
            aria-disabled={!chosen}
          >
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            Continue
          </button>
        </>
      )}
    </div>
  )
}
