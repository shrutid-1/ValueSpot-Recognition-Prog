import { EmployeeAvatar } from '@/components/shared/EmployeeAvatar'
import { CoreValueBadge } from '@/components/shared/CoreValueBadge'
import { Badge } from '@/components/ui/badge'
import { BADGE_LEVEL_NAMES } from '@/lib/constants'
import type { CoreValueSlug } from '@/lib/constants'
import { cn } from '@/lib/utils'

interface LeaderCardProps {
  rank?: number
  employeeName: string
  avatarUrl?: string | null
  coreValueName?: string
  coreValueSlug?: CoreValueSlug
  recognitionCount: number
  uniqueRecognizers: number
  badgeLevel?: number | null
  isJoint?: boolean
  className?: string
}

/*
  Rank tone.

  Was gold / silver / bronze, which is podium language the rest of this
  product does not speak — and three raw Tailwind hues inside a monochrome
  steel-blue system. The ramp now darkens toward first place, and the rank
  NUMBER carries the meaning either way, so nothing here depends on telling
  two shades apart.
*/
const RANK_TONE: Record<number, string> = {
  1: 'var(--color-accent-800)',
  2: 'var(--color-accent-600)',
  3: 'var(--color-accent-500)',
}

export function LeaderCard({
  rank,
  employeeName,
  avatarUrl,
  coreValueName,
  coreValueSlug,
  recognitionCount,
  uniqueRecognizers,
  badgeLevel,
  isJoint = false,
  className,
}: LeaderCardProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      {/* Rank number */}
      {rank != null && (
        <span
          className="font-condensed shrink-0 tabular-nums text-right"
          style={{
            fontSize: 15,
            fontWeight: 600,
            width: 20,
            color: RANK_TONE[rank] ?? 'var(--color-neutral-700)',
          }}
          aria-label={`Rank ${rank}`}
        >
          {rank}
        </span>
      )}

      {/* Avatar */}
      <EmployeeAvatar name={employeeName} avatarUrl={avatarUrl} size="md" className="shrink-0" />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p
            className="truncate"
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}
          >
            {employeeName}
          </p>
          {isJoint && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">Joint</Badge>
          )}
          {badgeLevel && (
            <span
              className="vs-tag shrink-0"
              style={{
                fontSize: 10,
                padding: '2px 6px',
                background: 'var(--accent-emphasis)',
                color: 'var(--color-accent-800)',
              }}
            >
              {BADGE_LEVEL_NAMES[badgeLevel]}
            </span>
          )}
        </div>
        <p style={{ fontSize: 11, color: 'var(--color-neutral-700)', marginTop: 2 }}>
          <span className="tabular-nums">{recognitionCount}</span>
          {' '}recognition{recognitionCount !== 1 ? 's' : ''}
          {' · '}
          <span className="tabular-nums">{uniqueRecognizers}</span> unique
        </p>
      </div>

      {/* Core Value tag */}
      {coreValueName && coreValueSlug && (
        <CoreValueBadge
          name={coreValueName}
          slug={coreValueSlug}
          size="sm"
          className="shrink-0"
        />
      )}
    </div>
  )
}
