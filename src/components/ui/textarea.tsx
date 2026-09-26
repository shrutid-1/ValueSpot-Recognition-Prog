import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string
}

/**
 * Blueprint-style textarea — square, surface background, divider border.
 * Accent border on focus. Resize vertical only.
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, id, ...props }, ref) => {
    const errorId = error ? `${id}-error` : undefined

    return (
      <div className="w-full">
        <textarea
          id={id}
          className={cn(
            'vs-input',
            'resize-y',
            error && 'border-[var(--color-accent-800)]',
            className
          )}
          style={{ minHeight: 90 }}
          ref={ref}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
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
Textarea.displayName = 'Textarea'

export { Textarea }
