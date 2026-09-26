import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Blueprint badge / tag component.
 * Brand-harmonised value family — no semantic colors (nothing here means
 * pass or fail; these identify a Core Value and nothing else).
 * Tag variant mapping:
 *   default  → accent filled (approved, Core Value names)
 *   neutral  → neutral fill  (metadata, pending)
 *   outline  → accent border transparent (behaviour, declined)
 *   secondary → neutral muted
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap font-[Barlow,sans-serif]',
  {
    variants: {
      variant: {
        // Accent tag (approved / active / published)
        default:
          'bg-[var(--color-accent-100)] text-[var(--color-accent-800)] border-0',
        // Neutral tag (pending / draft / metadata)
        secondary:
          'bg-[var(--color-neutral-100)] text-[var(--color-neutral-800)] border-0',
        // Outline tag (declined / clarification / behaviour)
        outline:
          'bg-transparent border border-[var(--color-accent-400)] text-[var(--color-accent-700)]',
        // Dark filled (active / strong emphasis)
        destructive:
          'bg-[var(--color-accent-800)] text-[var(--color-on-accent,var(--color-bg))] border-0',
        // All legacy core-value variants collapse to the accent tag
        adaptable:     'bg-[color-mix(in_srgb,#2a6ea8_14%,var(--color-bg))] text-[#2a6ea8] border border-[color-mix(in_srgb,#2a6ea8_30%,transparent)]',
        transparent:   'bg-[color-mix(in_srgb,#5b6b78_14%,var(--color-bg))] text-[#5b6b78] border border-[color-mix(in_srgb,#5b6b78_30%,transparent)]',
        collaborative: 'bg-[color-mix(in_srgb,#be3a66_14%,var(--color-bg))] text-[#be3a66] border border-[color-mix(in_srgb,#be3a66_30%,transparent)]',
        innovative:    'bg-[color-mix(in_srgb,#a25a0b_14%,var(--color-bg))] text-[#a25a0b]   border border-[color-mix(in_srgb,#a25a0b_30%,transparent)]',
        accountable:   'bg-[color-mix(in_srgb,#c42a20_14%,var(--color-bg))] text-[#c42a20] border border-[color-mix(in_srgb,#c42a20_30%,transparent)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      className={cn(badgeVariants({ variant }), className)}
      style={{ padding: '3px 8px', letterSpacing: '0.02em', ...props.style }}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
