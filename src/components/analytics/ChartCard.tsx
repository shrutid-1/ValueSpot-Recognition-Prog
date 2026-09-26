import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface ChartCardProps {
  title: string
  subtitle?: string
  children: React.ReactNode
  action?: React.ReactNode
  className?: string
}

export function ChartCard({ title, subtitle, children, action, className }: ChartCardProps) {
  return (
    <Card className={cn(className)}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{title}</CardTitle>
            {subtitle && (
              <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>
            )}
          </div>
          {action && (
            <div className="shrink-0">{action}</div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        {children}
      </CardContent>
    </Card>
  )
}
