import React from 'react'
import { cn } from '@/lib/utils'
import type { CoreValueSlug } from '@/lib/constants'

/**
 * Per-value tone colours, read from the design system rather than held here.
 *
 * --value-<slug> is defined in globals.css as the steel-blue family this
 * badge was drawn against, and REDEFINED inside the administrative portals,
 * whose palette is red and whose panels are white — where the pale tints
 * would be unreadable. Taking the tone from the variable means the badge
 * follows whichever system it is rendered in, and there is one place to
 * change a value's colour instead of five.
 *
 * The literal is the fallback for a value whose slug is not one of the five —
 * HR can add a sixth at any time.
 */
const TONE_FALLBACK = '#c42a20'

function toneVar(slug: string): string {
  return `var(--value-${slug}, ${TONE_FALLBACK})`
}

interface CoreValueBadgeProps {
  name: string
  slug?: string
  accentColor?: string
  icon?: React.ReactNode
  size?: 'sm' | 'md'
  className?: string
}

export function CoreValueBadge({
  name,
  slug,
  accentColor,
  icon,
  size = 'sm',
  className,
}: CoreValueBadgeProps) {
  const normalizedSlug = (slug ?? name.toLowerCase().replace(/\s+/g, '-')) as CoreValueSlug
  const tone = accentColor ?? toneVar(normalizedSlug)

  const fontSize = size === 'sm' ? 11 : 13
  const paddingV = size === 'sm' ? '3px' : '4px'
  const paddingH = size === 'sm' ? '8px' : '10px'

  return (
    <span
      className={cn('vs-tag inline-flex items-center gap-1', className)}
      style={{
        fontSize,
        padding: `${paddingV} ${paddingH}`,
        background: `color-mix(in srgb, ${tone} 14%, var(--color-bg))`,
        /*
          The tone DARKENED toward the text colour rather than used raw.

          Two of the five value tones are pale blues — Innovative lands around
          1.8:1 against this tint, which is not readable at 11px. Mixing each
          tone toward the ink keeps the values distinguishable from one
          another while putting every one of them above AA. The value's name
          is the real identifier either way; the tint only supports it.
        */
        color: `color-mix(in srgb, ${tone} 45%, var(--color-text))`,
        border: `1px solid color-mix(in srgb, ${tone} 30%, transparent)`,
        /*
          Barlow, unless the portal around it says otherwise. The
          administrative system runs on one grotesque and sets
          --vs-badge-font; the Employee portal defines nothing, so this badge
          is exactly the badge it was.
        */
        fontFamily: 'var(--vs-badge-font, Barlow, sans-serif)',
        fontWeight: 500,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
      }}
    >
      {icon && <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center' }}>{icon}</span>}
      {name}
    </span>
  )
}
