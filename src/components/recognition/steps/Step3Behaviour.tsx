import { HelpCircle } from 'lucide-react'
import { useBehaviours } from '@/hooks/queries'
import type { Behaviour } from '@/types'
import { Skeleton } from '@/components/shared/SkeletonLoader'
import { cn } from '@/lib/utils'

interface Step3BehaviourProps {
  coreValueId: string
  selected: Behaviour | null
  onSelect: (behaviour: Behaviour | null) => void
}

const OTHER_BEHAVIOUR: Behaviour = {
  id: 'other', core_value_id: '', name: 'Other',
  description: 'The behaviour I observed is not listed above',
  examples: null, display_order: 999, is_active: true,
  archived_at: null, created_at: '', updated_at: '',
}

function BehaviourSkeleton() {
  return (
    <div className="rounded-lg border border-border p-3.5">
      <div className="flex items-center gap-2.5">
        <Skeleton className="h-2 w-2 rounded-full shrink-0" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-60" />
        </div>
      </div>
    </div>
  )
}

export function Step3Behaviour({ coreValueId, selected, onSelect }: Step3BehaviourProps) {
  // Keyed by core value, so stepping back and forward reuses the cache.
  const { data: behaviours = [], isPending: loading } = useBehaviours(coreValueId)

  const all = [...behaviours, OTHER_BEHAVIOUR]

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">What behaviour did you observe?</h2>
        <p className="text-sm text-text-muted mt-1">Choose the one that best describes what you saw.</p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <BehaviourSkeleton key={i} />)}
        </div>
      ) : (
        <div className="space-y-2" role="listbox" aria-label="Behaviours">
          {all.map(b => {
            const isSelected = selected?.id === b.id
            const isOther    = b.id === 'other'
            return (
              <button
                key={b.id}
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
                onClick={() => onSelect(isOther ? null : b)}
              >
                <div className="flex items-center gap-2.5">
                  {isOther ? (
                    <HelpCircle size={15} className="text-text-muted shrink-0" aria-hidden="true" />
                  ) : (
                    <div
                      className={cn('h-2 w-2 rounded-full shrink-0', isSelected ? 'bg-blue-600' : 'bg-text-disabled')}
                      aria-hidden="true"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      'text-sm font-medium leading-snug',
                      isSelected ? 'text-blue-700' : isOther ? 'text-text-muted' : 'text-text-primary'
                    )}>
                      {b.name}
                    </p>
                    {b.description && !isOther && (
                      <p className="text-xs text-text-muted mt-0.5 leading-relaxed">{b.description}</p>
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
