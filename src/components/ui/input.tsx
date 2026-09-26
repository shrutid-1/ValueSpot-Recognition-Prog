import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string
}

/**
 * Blueprint-style input — square, surface background, divider border.
 * Accent border on focus. No border-radius.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, 'aria-describedby': ariaDescribedBy, id, ...props }, ref) => {
    const errorId = error ? `${id}-error` : undefined

    return (
      <div className="w-full">
        <input
          id={id}
          type={type}
          className={cn(
            'vs-input',
            error && 'border-[var(--color-accent-800)]',
            className
          )}
          style={{ height: 36 }}
          ref={ref}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : ariaDescribedBy}
          {...props}
        />
        {error && (
          <p
            id={errorId}
            role="alert"
            style={{
              marginTop: 4,
              fontSize: 12,
              color: 'var(--color-accent-800)',
              fontFamily: 'Barlow, sans-serif',
            }}
          >
            {error}
          </p>
        )}
      </div>
    )
  }
)
Input.displayName = 'Input'

export { Input }
