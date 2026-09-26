import React from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  subtitle?: string
  kicker?: string
  actions?: React.ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, kicker, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn('flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3', className)}
      style={{ marginBottom: 24 }}
    >
      <div className="min-w-0">
        {kicker && (
          <p
            className="vs-kicker"
            style={{ marginBottom: 4 }}
          >
            {kicker}
          </p>
        )}
        <h1
          className="font-condensed"
          style={{ fontSize: 34, fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.015em', color: 'var(--color-text)' }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            style={{
              fontSize: 14,
              color: 'var(--color-neutral-600)',
              marginTop: 4,
              lineHeight: 1.5,
              maxWidth: 560,
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0 self-start">
          {actions}
        </div>
      )}
    </div>
  )
}
