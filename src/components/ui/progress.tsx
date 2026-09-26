import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'
import { cn } from '@/lib/utils'

/**
 * Blueprint progress bar — no border-radius, 4px track, accent fill.
 * Matches .vs-progress-track from globals.css.
 */
const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
    fillColor?: string
  }
>(({ className, value, fillColor, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn('relative w-full overflow-hidden vs-progress-track', className)}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="h-full transition-all duration-300 ease-out"
      style={{
        width: `${value ?? 0}%`,
        background: fillColor ?? 'var(--color-accent)',
      }}
    />
  </ProgressPrimitive.Root>
))
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
