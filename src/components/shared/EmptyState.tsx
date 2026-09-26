import React from 'react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  secondaryAction?: {
    label: string
    onClick: () => void
  }
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center text-center', className)}
      style={{ padding: '48px 24px' }}
    >
      {icon && (
        <div
          aria-hidden="true"
          style={{
            width: 56,
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid var(--color-divider)',
            color: 'var(--color-neutral-400)',
            marginBottom: 16,
            // Blueprint corner marks via box-shadow trick
            position: 'relative',
          }}
        >
          {icon}
        </div>
      )}
      <h3
        className="font-condensed"
        style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text)', marginBottom: 6 }}
      >
        {title}
      </h3>
      {description && (
        <p
          style={{
            fontSize: 13,
            color: 'var(--color-neutral-600)',
            maxWidth: 320,
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="flex items-center gap-2" style={{ marginTop: 20 }}>
          {secondaryAction && (
            <button className="vs-btn" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </button>
          )}
          {action && (
            <button
              className="vs-btn vs-btn-primary relative"
              onClick={action.onClick}
            >
              <i className="corner tl" />
              <i className="corner tr" />
              <i className="corner bl" />
              <i className="corner br" />
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
