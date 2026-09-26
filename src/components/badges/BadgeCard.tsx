import React from 'react'
import { Trophy, Star, Award, Zap } from 'lucide-react'
import type { BadgeDefinition } from '@/types'
import { cn } from '@/lib/utils'

interface BadgeCardProps {
  definition: BadgeDefinition
  earned?: boolean
  className?: string
}

const BADGE_ICONS: Record<number, React.ReactNode> = {
  1: <Star size={18} />,
  2: <Star size={18} />,
  3: <Award size={18} />,
  4: <Zap size={18} />,
  5: <Trophy size={18} />,
}

export function BadgeCard({ definition, earned = false, className }: BadgeCardProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3 transition-all',
        earned
          ? 'border-current bg-opacity-10'
          : 'border-border bg-surface opacity-50',
        className
      )}
      style={earned ? {
        borderColor: definition.accent_color + '60',
        backgroundColor: definition.accent_color + '10',
        color: definition.accent_color,
      } : undefined}
    >
      <div
        className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
        style={earned ? { backgroundColor: definition.accent_color + '20', color: definition.accent_color } : { backgroundColor: '#F3F0F0', color: '#9A9A9E' }}
        aria-hidden="true"
      >
        {BADGE_ICONS[definition.level] ?? <Star size={18} />}
      </div>
      <div>
        <p className={cn('text-sm font-semibold', earned ? '' : 'text-text-muted')}>
          {definition.name}
        </p>
        <p className="text-xs text-text-muted">
          {definition.minimum_count}
          {definition.maximum_count ? `–${definition.maximum_count}` : '+'}
          {' '}recognitions
        </p>
      </div>
    </div>
  )
}
