import React from 'react'
import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
  style?: React.CSSProperties
}

/** Base animated skeleton block — no border-radius in blueprint system */
export function Skeleton({ className, style }: SkeletonProps) {
  return (
    <div
      className={cn(className)}
      style={{
        background: 'var(--color-neutral-300)',
        animation: 'pulse 1.5s cubic-bezier(0.4,0,0.6,1) infinite',
        ...style,
      }}
      aria-hidden="true"
    />
  )
}

interface SkeletonLoaderProps {
  rows?: number
  className?: string
}

export function SkeletonLoader({ rows = 3, className }: SkeletonLoaderProps) {
  return (
    <div className={cn('space-y-3', className)} aria-label="Loading…" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton style={{ width: 36, height: 36, flexShrink: 0 }} />
          <div className="flex-1 space-y-2">
            <Skeleton style={{ height: 13, width: '65%' }} />
            <Skeleton style={{ height: 11, width: '40%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function CardSkeleton() {
  return (
    <div
      className="vs-card"
      style={{ padding: 16, marginBottom: 1 }}
      aria-hidden="true"
    >
      <div className="flex items-center gap-3" style={{ marginBottom: 10 }}>
        <Skeleton style={{ width: 36, height: 36, flexShrink: 0 }} />
        <div className="flex-1">
          <Skeleton style={{ height: 13, width: '40%', marginBottom: 6 }} />
          <Skeleton style={{ height: 11, width: '30%' }} />
        </div>
      </div>
      <Skeleton style={{ height: 11, width: '100%', marginBottom: 5 }} />
      <Skeleton style={{ height: 11, width: '85%', marginBottom: 5 }} />
      <Skeleton style={{ height: 11, width: '60%' }} />
    </div>
  )
}

export function MetricCardSkeleton() {
  return (
    <div className="vs-card" style={{ padding: 16 }} aria-hidden="true">
      <Skeleton style={{ height: 34, width: 52, marginBottom: 8 }} />
      <Skeleton style={{ height: 12, width: 80 }} />
    </div>
  )
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="vs-card overflow-hidden" aria-hidden="true">
      {/* Header */}
      <div
        className="flex gap-4"
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--color-divider)',
          background: 'color-mix(in srgb, var(--color-neutral-300) 40%, transparent)',
        }}
      >
        <Skeleton style={{ height: 10, width: 100 }} />
        <Skeleton style={{ height: 10, width: 70 }} />
        <div style={{ flex: 1 }} />
        <Skeleton style={{ height: 10, width: 50 }} />
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4"
          style={{
            padding: '10px 12px',
            borderBottom: i < rows - 1 ? '1px solid var(--color-divider)' : 'none',
          }}
        >
          <Skeleton style={{ width: 32, height: 32, flexShrink: 0 }} />
          <div className="flex-1">
            <Skeleton style={{ height: 12, width: '35%', marginBottom: 5 }} />
            <Skeleton style={{ height: 10, width: '50%' }} />
          </div>
          <Skeleton style={{ height: 20, width: 60 }} />
          <Skeleton style={{ height: 12, width: 36 }} />
        </div>
      ))}
    </div>
  )
}

export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div
      style={{
        width: '100%',
        height,
        background: 'var(--color-neutral-200)',
        animation: 'pulse 1.5s cubic-bezier(0.4,0,0.6,1) infinite',
      }}
      aria-hidden="true"
    />
  )
}
