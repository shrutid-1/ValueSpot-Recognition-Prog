import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Blueprint card system.
 * Card = transparent background, 1px divider border, square corners.
 * Overflow visible so blueprint corner marks (if added) extend past borders.
 */
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, style, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('vs-card', className)}
      style={{ overflow: 'visible', ...style }}
      {...props}
    />
  )
)
Card.displayName = 'Card'

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col', className)}
      style={{ padding: '14px 16px 10px' }}
      {...props}
    />
  )
)
CardHeader.displayName = 'CardHeader'

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('font-condensed', className)}
      style={{
        fontSize: 16,
        fontWeight: 600,
        color: 'var(--color-text)',
        letterSpacing: '-0.01em',
        lineHeight: 1.2,
        margin: 0,
      }}
      {...props}
    />
  )
)
CardTitle.displayName = 'CardTitle'

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn(className)}
      style={{ fontSize: 13, color: 'var(--color-neutral-600)', marginTop: 3 }}
      {...props}
    />
  )
)
CardDescription.displayName = 'CardDescription'

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, style, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(className)}
      style={{ padding: '0 16px 16px', ...style }}
      {...props}
    />
  )
)
CardContent.displayName = 'CardContent'

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, style, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center', className)}
      style={{
        padding: '10px 16px',
        borderTop: '1px solid var(--color-divider)',
        ...style,
      }}
      {...props}
    />
  )
)
CardFooter.displayName = 'CardFooter'

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
