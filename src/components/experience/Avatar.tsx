import { getInitials } from '@/lib/utils'
import { cn } from '@/lib/utils'

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg'

const SIZES: Record<AvatarSize, { box: number; font: number }> = {
  xs: { box: 26, font: 10 },
  sm: { box: 34, font: 12 },
  md: { box: 42, font: 14 },
  lg: { box: 54, font: 17 },
}

interface AvatarProps {
  name: string
  avatarUrl?: string | null
  size?: AvatarSize
  className?: string
}

/**
 * A person.
 *
 * Deliberately undecorated: no accent ring, no glow, no gradient. In an
 * earlier pass every avatar carried a coloured halo to signal whether the
 * recognition was received or given — which put emphasis on a fact the
 * sentence beside it already states, and made a page of people look like a
 * page of status indicators. The words carry the meaning; this carries the
 * face.
 *
 * A broken image URL falls back to initials rather than to a broken-image
 * glyph: the img sits over the initials and removes itself on error.
 */
export function Avatar({ name, avatarUrl, size = 'md', className }: AvatarProps) {
  const { box, font } = SIZES[size]

  return (
    <span
      className={cn('vsx-avatar', className)}
      style={{ width: box, height: box, fontSize: font }}
    >
      <span aria-hidden="true">{getInitials(name)}</span>
      {avatarUrl && (
        <img
          src={avatarUrl}
          alt=""
          style={{ position: 'absolute', inset: 0 }}
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      )}
      <span className="sr-only">{name}</span>
    </span>
  )
}
