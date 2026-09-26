import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Blueprint-style button.
 * Primary: filled accent with corner marks. All others: transparent/bordered.
 * No border-radius. Barlow Condensed font.
 */
const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap',
    'font-condensed font-semibold text-sm',
    'transition-colors duration-120',
    'disabled:pointer-events-none disabled:opacity-45',
    'focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2',
  ].join(' '),
  {
    variants: {
      variant: {
        default:
          'bg-[var(--color-accent)] text-[var(--color-on-accent,var(--color-bg))] border border-[var(--color-accent)] ' +
          'hover:bg-[var(--color-accent-700)] hover:border-[var(--color-accent-700)]',
        destructive:
          'bg-[var(--color-accent-800)] text-[var(--color-on-accent,var(--color-bg))] border border-[var(--color-accent-800)] ' +
          'hover:bg-[var(--color-accent-900)] hover:border-[var(--color-accent-900)]',
        outline:
          'bg-transparent text-[var(--color-text)] border border-[var(--color-divider)] ' +
          'hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] hover:border-[var(--color-accent-400)] hover:text-[var(--color-accent-800)]',
        secondary:
          'bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-divider)] ' +
          'hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]',
        ghost:
          'bg-transparent text-[var(--color-accent-700)] border border-transparent ' +
          'hover:bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] hover:text-[var(--color-accent-800)]',
        link:
          'bg-transparent text-[var(--color-accent-700)] border border-transparent underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        default: 'h-9 px-4 py-1.5 text-sm',
        sm:      'h-7 px-3 py-1 text-xs',
        lg:      'h-10 px-5 py-2 text-base',
        icon:    'h-9 w-9 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    const isPrimary = !variant || variant === 'default'
    const isDestructive = variant === 'destructive'

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading}
        {...props}
      >
        {/* Blueprint corner marks on primary & destructive buttons */}
        {(isPrimary || isDestructive) && !loading && (
          <>
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
          </>
        )}
        {loading ? (
          <>
            <svg
              className="animate-spin"
              width="14"
              height="14"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
