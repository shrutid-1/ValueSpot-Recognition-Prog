import React from 'react'
import { cn } from '@/lib/utils'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface MetricCardProps {
  label: string
  value: number | string
  icon?: React.ReactNode
  /**
   * Retained so existing call sites keep compiling, and deliberately unused.
   *
   * It carried a raw Tailwind tint class (`bg-blue-50` and friends) from
   * before the blueprint system, which is exactly the drift this pass removes
   * — the icon well is now an accent wash from the design tokens, the same on
   * every card. Nothing behavioural hangs on it.
   */
  iconBg?: string
  trend?: number       // positive = up, negative = down, 0 = flat
  trendLabel?: string
  highlight?: boolean  // draws attention to the card (e.g. pending items)
  className?: string
  onClick?: () => void
}

export function MetricCard({
  label,
  value,
  icon,
  trend,
  trendLabel,
  highlight = false,
  className,
  onClick,
}: MetricCardProps) {
  const TrendIcon =
    trend == null ? null : trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus

  /*
    Direction is carried by the ICON, not by a colour, so the ramp being
    monochrome costs nothing here — and nobody has to distinguish two shades
    of steel blue to read a trend.
  */
  const trendColor =
    trend == null
      ? undefined
      : trend === 0
        ? 'var(--color-neutral-700)'
        : 'var(--color-accent-800)'

  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag
      className={cn(
        'vs-card relative text-left w-full',
        onClick && 'vs-card-interactive',
        className,
      )}
      style={{
        padding: 16,
        overflow: 'visible',
        borderColor: highlight ? 'var(--color-accent)' : undefined,
        background: highlight ? 'var(--accent-soft)' : undefined,
      }}
      onClick={onClick}
      // button type suppresses implicit submit inside forms
      {...(onClick ? { type: 'button' as const } : {})}
    >
      <i className="corner tl" /><i className="corner tr" />
      <i className="corner bl" /><i className="corner br" />

      {icon && (
        <div
          aria-hidden="true"
          style={{
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--accent-emphasis)',
            color: 'var(--color-accent-800)',
            marginBottom: 10,
          }}
        >
          {icon}
        </div>
      )}

      <p
        className="font-condensed vs-metric-value"
        style={{ fontSize: 30, lineHeight: 1 }}
      >
        {value}
      </p>
      <p style={{ fontSize: 12, color: 'var(--color-neutral-700)', marginTop: 5, lineHeight: 1.35 }}>
        {label}
      </p>

      {TrendIcon && trendLabel && (
        <div
          className="flex items-center gap-1"
          style={{ marginTop: 9, fontSize: 11, fontWeight: 500, color: trendColor }}
        >
          <TrendIcon size={12} aria-hidden="true" />
          <span>{trendLabel}</span>
        </div>
      )}
    </Tag>
  )
}
