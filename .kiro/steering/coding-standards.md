---
inclusion: always
---

# Touchcore ValueSpot — Coding Standards

## TypeScript

- Strict mode always enabled
- No `any` types — use `unknown` and type-narrow if needed
- All function parameters and return types must be explicitly typed
- Use interfaces for object shapes, type aliases for unions/intersections
- Generate Supabase types with `npx supabase gen types` — never write DB types manually

## React Components

- Functional components with hooks only — no class components
- Component file = one default export (the component)
- Props interface defined above the component
- Use named exports for utility components; default export for page components

```typescript
// Correct
interface RecognitionCardProps {
  nomination: Nomination
  onAppreciate: (id: string) => void
}

export function RecognitionCard({ nomination, onAppreciate }: RecognitionCardProps) {
  // ...
}
```

## Forms

All forms use React Hook Form + Zod:

```typescript
const schema = z.object({
  whatHappened: z.string().min(20, 'Please describe what happened (at least 20 characters)'),
  whatImpact: z.string().min(20, 'Please describe the impact (at least 20 characters)'),
})

const form = useForm<z.infer<typeof schema>>({
  resolver: zodResolver(schema),
})
```

Never use uncontrolled inputs without React Hook Form for anything that submits to Supabase.

## Error Handling

Always handle errors explicitly:

```typescript
const { data, error } = await supabase.from('nominations').select('*')
if (error) {
  // Log for debugging, show human-readable message to user
  console.error('Failed to fetch nominations:', error)
  setError('Unable to load recognitions. Please try again.')
  return
}
```

Never expose raw Supabase error messages to users. Always translate to human-readable form.

## Loading States

Every data fetch must show a skeleton loader, not an empty screen:

```typescript
if (loading) return <SkeletonLoader rows={5} />
if (error) return <ErrorState message={error} onRetry={refetch} />
if (data.length === 0) return <EmptyState ... />
return <DataComponent data={data} />
```

## Naming Conventions

- Components: PascalCase (`RecognitionCard`, `BadgeProgress`)
- Hooks: camelCase with `use` prefix (`useRecognition`, `useBadges`)
- Utilities: camelCase (`formatDate`, `calculateBadgeLevel`)
- Constants: SCREAMING_SNAKE_CASE (`MAX_RECOGNITIONS_PER_DAY`)
- Database column names: snake_case (match Supabase schema)
- TypeScript types/interfaces: PascalCase (`Nomination`, `BadgeDefinition`)
- Files: kebab-case for non-component files (`date-utils.ts`, `supabase-types.ts`)

## Tailwind Usage

Use the design system tokens defined in tailwind.config.ts. Do NOT use arbitrary Tailwind values unless absolutely necessary.

```tsx
// Correct — uses design system
<div className="bg-surface border border-border rounded-lg p-6">

// Avoid — arbitrary value
<div className="bg-[#ffffff] p-[24px]">
```

Use `cn()` utility (from `src/lib/utils.ts`) for conditional classes:
```tsx
import { cn } from '@/lib/utils'
<div className={cn('base-class', isActive && 'active-class')} />
```

## Supabase Queries

Always use `.select()` with specific columns, never `select('*')` in production queries:

```typescript
// Correct
const { data } = await supabase
  .from('nominations')
  .select('id, what_happened, status, nominee:nominee_id(full_name, avatar_url)')
  .eq('status', 'approved')
  .order('approved_at', { ascending: false })
  .range(offset, offset + pageSize - 1)
```

Always use `.range()` for pagination — never load entire tables.

## Date Handling

All dates are stored in UTC. Display in IST using date-fns:

```typescript
import { format, parseISO } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

function formatIST(utcDate: string): string {
  const zoned = toZonedTime(parseISO(utcDate), 'Asia/Kolkata')
  return format(zoned, 'dd MMM yyyy, hh:mm a')
}
```

Never do timezone conversion math manually.

## Accessibility

- All interactive elements have accessible names (`aria-label` or visible text)
- Form inputs have associated `<label>` elements
- Error messages are associated with their inputs via `aria-describedby`
- Focus is managed in modals and drawers (trap focus, restore on close)
- Color is never the only differentiator (always add text/icon)
- Use semantic HTML: `<button>` for actions, `<a>` for navigation, `<nav>` for navigation regions

## Imports

Use path alias `@/` for src imports:

```typescript
import { supabase } from '@/lib/supabase'
import { RecognitionCard } from '@/components/recognition/RecognitionCard'
```

Configure in tsconfig.json and vite.config.ts.
