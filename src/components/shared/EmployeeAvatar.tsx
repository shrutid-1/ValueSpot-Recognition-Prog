import { cn } from '@/lib/utils'
import { getInitials } from '@/lib/utils'

interface EmployeeAvatarProps {
  name: string
  avatarUrl?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  showName?: boolean
  role?: string
  /**
   * Secondary line under the name when `showName` is set — normally the email
   * address, which is what tells two people with the same name apart.
   */
  subtitle?: string
}

const SIZE_MAP: Record<string, { box: number; font: number }> = {
  xs: { box: 24, font: 9 },
  sm: { box: 30, font: 11 },
  md: { box: 36, font: 12 },
  lg: { box: 44, font: 14 },
  xl: { box: 56, font: 16 },
}

/**
 * Square initials tile — blueprint style, never circular.
 * Uses the same .vs-avatar class from globals.css.
 */
export function EmployeeAvatar({
  name,
  avatarUrl,
  size = 'md',
  className,
  showName = false,
  role,
  subtitle,
}: EmployeeAvatarProps) {
  const { box, font } = SIZE_MAP[size] ?? SIZE_MAP.md
  const initials = getInitials(name)

  const tile = (
    <div
      className={cn('vs-avatar', className)}
      style={{ width: box, height: box, fontSize: font }}
      title={name}
      aria-label={name}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name}
          style={{ width: box, height: box, objectFit: 'cover', display: 'block' }}
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      ) : (
        initials
      )}
    </div>
  )

  if (!showName) return tile

  return (
    <div className="flex items-center gap-2.5">
      {tile}
      <div className="min-w-0">
        <p
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--color-text)',
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </p>
        {subtitle && (
          <p
            title={subtitle}
            style={{
              fontSize: 11,
              color: 'var(--color-neutral-600)',
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {subtitle}
          </p>
        )}
        {role && (
          <p
            style={{
              fontSize: 11,
              color: 'var(--color-neutral-600)',
              textTransform: 'capitalize',
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {role.replace('_', ' ')}
          </p>
        )}
      </div>
    </div>
  )
}
