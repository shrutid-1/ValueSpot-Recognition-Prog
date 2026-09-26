import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

const Tabs = TabsPrimitive.Root

/**
 * Blueprint tab list — segmented control style.
 * Bordered group, square, active tab gets accent fill.
 */
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('inline-flex', className)}
    style={{
      border: '1px solid var(--color-divider)',
      overflow: 'hidden',
    }}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap font-condensed font-semibold',
      'transition-colors duration-120 cursor-pointer',
      'disabled:pointer-events-none disabled:opacity-50',
      'data-[state=active]:bg-[var(--color-accent)] data-[state=active]:text-[var(--color-on-accent,var(--color-bg))]',
      'focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-[-2px]',
      className
    )}
    style={{
      padding: '6px 16px',
      fontSize: 13,
      color: 'var(--color-neutral-600)',
      background: 'transparent',
      borderRight: '1px solid var(--color-divider)',
    }}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('mt-4 focus-visible:outline-none', className)}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
