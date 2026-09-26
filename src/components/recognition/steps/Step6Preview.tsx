import { Award, FolderKanban, AlertCircle } from 'lucide-react'
import type { WizardData } from '@/pages/employee/GiveRecognitionPage'
import { Button } from '@/components/ui/button'
import { EmployeeAvatar } from '@/components/shared/EmployeeAvatar'
import { CoreValueBadge } from '@/components/shared/CoreValueBadge'
import type { CoreValueSlug } from '@/lib/constants'

interface Step6PreviewProps {
  data: WizardData
  submitting: boolean
  error: string | null
  /**
   * Advisory notice from the check-duplicate function when this colleague was
   * recently recognised for the same Core Value (REQ-010-04). Advisory only —
   * it never blocks submission.
   */
  duplicateWarning?: string | null
  onSubmit: () => void
}

export function Step6Preview({ data, submitting, error, duplicateWarning, onSubmit }: Step6PreviewProps) {
  const { nominee, coreValue, behaviour, scenario, whatHappened, whatImpact, projectName } = data

  if (!nominee || !coreValue) return null

  const slug = coreValue.slug as CoreValueSlug

  return (
    <div className="p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">Review your recognition</h2>
        <p className="text-sm text-text-muted mt-1">
          This is how your recognition will appear after approval.
        </p>
      </div>

      {/* Preview card */}
      <div className="rounded-xl border border-border bg-surface-secondary p-5 space-y-4">
        {/* Nominee */}
        <div className="flex items-center gap-3">
          <EmployeeAvatar name={nominee.full_name} avatarUrl={nominee.avatar_url} size="lg" />
          <div>
            <p className="font-semibold text-text-primary">{nominee.full_name}</p>
            <p className="text-xs text-text-muted">{nominee.email}</p>
          </div>
        </div>

        <hr className="border-border" />

        {/* Core Value */}
        <div className="flex items-center gap-2">
          <Award size={15} className="text-text-muted" aria-hidden="true" />
          <span className="text-xs text-text-muted">Core Value:</span>
          <CoreValueBadge name={coreValue.name} slug={slug} />
        </div>

        {/* Behaviour */}
        {behaviour && (
          <div>
            <p className="text-xs text-text-muted mb-0.5">Behaviour</p>
            <p className="text-sm text-text-primary">{behaviour.name}</p>
          </div>
        )}

        {/* Scenario */}
        {scenario && (
          <div>
            <p className="text-xs text-text-muted mb-0.5">Scenario</p>
            <p className="text-sm text-text-primary">{scenario.name}</p>
          </div>
        )}

        {/* Story */}
        <div>
          <p className="text-xs text-text-muted mb-1">What happened</p>
          <blockquote className="text-sm text-text-secondary leading-relaxed border-l-2 border-border pl-3">
            {whatHappened}
          </blockquote>
        </div>

        <div>
          <p className="text-xs text-text-muted mb-1">Impact</p>
          <p className="text-sm text-text-secondary leading-relaxed">{whatImpact}</p>
        </div>

        {/* Project */}
        {projectName && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <FolderKanban size={13} aria-hidden="true" />
            {projectName}
          </div>
        )}
      </div>

      {/* Possible duplicate — advisory, does not prevent submitting */}
      {duplicateWarning && !error && (
        <div
          className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm"
          role="status"
          style={{
            background: 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg))',
            border: '1px solid var(--color-accent-400)',
            color: 'var(--color-accent-800)',
          }}
        >
          <AlertCircle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
          {duplicateWarning}
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700"
          role="alert"
        >
          <AlertCircle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
          {error}
        </div>
      )}

      <Button
        className="w-full"
        size="lg"
        onClick={onSubmit}
        loading={submitting}
        disabled={submitting}
      >
        Submit Recognition
      </Button>

      <p className="text-xs text-text-muted text-center">
        Your recognition will be sent to the relevant manager for validation before it's published.
      </p>
    </div>
  )
}
