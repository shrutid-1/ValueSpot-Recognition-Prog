import { HelpCircle } from 'lucide-react'
import { useScenarios } from '@/hooks/queries'
import type { Scenario } from '@/types'
import { Skeleton } from '@/components/shared/SkeletonLoader'
import { cn } from '@/lib/utils'

interface Step4ScenarioProps {
  behaviourId: string
  coreValueId: string
  selected: Scenario | null
  onSelect: (scenario: Scenario | null) => void
}

const OTHER_SCENARIO: Scenario = {
  id: 'other',
  behaviour_id: '',
  core_value_id: '',
  name: 'A different situation',
  description: "My situation is similar but doesn't match the options above",
  examples: null,
  display_order: 999,
  is_active: true,
  archived_at: null,
  created_at: '',
  updated_at: '',
}

function ScenarioSkeleton() {
  return (
    <div className="rounded-xl border border-border p-3.5">
      <div className="flex items-start gap-2.5">
        <Skeleton className="h-1.5 w-1.5 rounded-full mt-2 shrink-0" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
    </div>
  )
}

export function Step4Scenario({ behaviourId, coreValueId, selected, onSelect }: Step4ScenarioProps) {
  /*
    Narrow by behaviour when one was chosen, else by core value — the same
    precedence as before, now expressed once in referenceApi.listScenarios
    instead of reconstructed here.
  */
  const { data: scenarios = [], isPending: loading } =
    useScenarios({ behaviourId, coreValueId })

  const all = [...scenarios, OTHER_SCENARIO]

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">What was the situation?</h2>
        <p className="text-sm text-text-muted mt-1">
          Choose the scenario that best describes the context. You'll describe exactly what happened in the next step.
        </p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <ScenarioSkeleton key={i} />)}
        </div>
      ) : (
        <div className="space-y-2" role="listbox" aria-label="Scenarios">
          {all.map(s => {
            const isSelected = selected?.id === s.id
            const isOther    = s.id === 'other'
            return (
              <button
                key={s.id}
                role="option"
                aria-selected={isSelected}
                className={cn(
                  'w-full text-left rounded-xl border p-3.5 transition-all duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                  isSelected
                    ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-300'
                    : 'bg-surface border-border hover:bg-surface-secondary hover:border-border',
                  isOther && 'border-dashed'
                )}
                onClick={() => onSelect(isOther ? null : s)}
              >
                <div className="flex items-start gap-2.5">
                  {isOther ? (
                    <HelpCircle size={15} className="text-text-muted shrink-0 mt-0.5" aria-hidden="true" />
                  ) : (
                    <div
                      className={cn(
                        'h-1.5 w-1.5 rounded-full shrink-0 mt-2',
                        isSelected ? 'bg-blue-600' : 'bg-text-disabled'
                      )}
                      aria-hidden="true"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      'text-sm font-medium leading-snug',
                      isSelected ? 'text-blue-700' : isOther ? 'text-text-muted' : 'text-text-primary'
                    )}>
                      {s.name}
                    </p>
                    {s.description && (
                      <p className="text-xs text-text-muted mt-0.5 leading-relaxed">{s.description}</p>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
