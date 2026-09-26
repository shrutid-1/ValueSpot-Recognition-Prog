import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

/**
 * Blueprint switch — rectangular track (not pill), accent when checked.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    className={cn('relative inline-flex shrink-0 cursor-pointer items-center transition-colors', className)}
    style={{
      width: 36,
      height: 20,
      border: '1px solid var(--color-divider)',
      background: 'var(--color-neutral-300)',
    }}
    data-checked={props.checked ? '' : undefined}
    ref={ref}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className="pointer-events-none block transition-transform"
      style={{
        width: 14,
        height: 14,
        background: 'var(--color-bg)',
        border: '1px solid var(--color-divider)',
      }}
    />
    <style>{`
      [data-state="checked"].switch-root { background: var(--color-accent); border-color: var(--color-accent); }
      [data-state="checked"] [data-radix-switch-thumb] { transform: translateX(18px); }
      [data-state="unchecked"] [data-radix-switch-thumb] { transform: translateX(2px); }
    `}</style>
  </SwitchPrimitive.Root>
))
Switch.displayName = SwitchPrimitive.Root.displayName

export { Switch }
