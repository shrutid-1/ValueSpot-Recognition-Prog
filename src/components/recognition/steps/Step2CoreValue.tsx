import { useCoreValues } from '@/hooks/queries'
import type { CoreValue } from '@/types'
import { Skeleton } from '@/components/shared/SkeletonLoader'
import { cn } from '@/lib/utils'
import type { CoreValueSlug } from '@/lib/constants'
import { CORE_VALUE_BG, CORE_VALUE_TEXT, CORE_VALUE_BORDER, CORE_VALUE_RING } from '@/lib/constants'

interface Step2CoreValueProps {
  selected: CoreValue | null
  onSelect: (cv: CoreValue) => void
}

// Map slug → icon initial as fallback (no string manipulation for icon names in prod)
const CV_INITIALS: Partial<Record<CoreValueSlug, string>> = {
  adaptable:     'A',
  transparent:   'T',
  collaborative: 'C',
  innovative:    'I',
  accountable:   'Ac',
}

function CoreValueCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 flex items-start gap-3">
      <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  )
}

export function Step2CoreValue({ selected, onSelect }: Step2CoreValueProps) {
  // Shared cache: the same five rows the HR screens read. Re-entering the
  // wizard within the stale window costs no request at all.
  const { data: coreValues = [], isPending: loading } = useCoreValues()

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">Which Core Value does this reflect?</h2>
        <p className="text-sm text-text-muted mt-1">Select the value that best describes what you observed.</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <CoreValueCardSkeleton key={i} />)}
        </div>
      ) : (
        <div className="space-y-2.5" role="listbox" aria-label="Core Values">
          {coreValues.map(cv => {
            const slug      = cv.slug as CoreValueSlug
            const bg        = CORE_VALUE_BG[slug]     ?? 'bg-blue-50'
            const text      = CORE_VALUE_TEXT[slug]   ?? 'text-blue-700'
            const border    = CORE_VALUE_BORDER[slug] ?? 'border-blue-200'
            const ring      = CORE_VALUE_RING[slug]   ?? 'ring-blue-400'
            const isSelected = selected?.id === cv.id

            return (
              <button
                key={cv.id}
                role="option"
                aria-selected={isSelected}
                className={cn(
                  'w-full text-left rounded-xl border p-4 transition-all duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2', ring,
                  isSelected
                    ? `${bg} ${border} ring-2 scale-[1.01]`
                    : `bg-surface border-border hover:${bg} hover:${border}`
                )}
                onClick={() => onSelect(cv)}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn('h-9 w-9 rounded-lg flex items-center justify-center shrink-0 text-sm font-bold', bg, text)}
                    aria-hidden="true"
                  >
                    {CV_INITIALS[slug] ?? cv.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn('font-semibold text-sm leading-snug', isSelected ? text : 'text-text-primary')}>
                      {cv.name}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5 leading-relaxed line-clamp-2">
                      {cv.definition}
                    </p>
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
