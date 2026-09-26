import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from '@/lib/utils'

/**
 * Blueprint form label — Barlow 13px medium, neutral text.
 */
const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(className)}
    style={{
      fontSize: 13,
      fontWeight: 500,
      color: 'var(--color-text)',
      lineHeight: 1.3,
      fontFamily: 'Barlow, sans-serif',
      cursor: 'default',
    }}
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
