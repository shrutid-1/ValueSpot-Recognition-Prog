---
inclusion: always
---

# Touchcore ValueSpot — Design System

## Design Direction

The product feel: **Corporate + Modern + Human + Premium + Simple**

Reference products (for inspiration, not copying): Linear, Notion, Stripe, Ramp, Asana

## Colour Tokens

These are configured in `tailwind.config.ts` and available as Tailwind classes.

### Brand
```
navy:     #0F172A    → text-navy, bg-navy
blue:     #2563EB    → text-blue, bg-blue  (primary action)
blue-sec: #3B82F6    → text-blue-secondary
teal:     #14B8A6    → text-teal, bg-teal
```

### Surfaces
```
background:     #F8FAFC    → bg-background
surface:        #FFFFFF    → bg-surface
surface-sec:    #F1F5F9    → bg-surface-secondary
border:         #E2E8F0    → border-border
```

### Text
```
text-primary:   #0F172A
text-secondary: #475569
text-muted:     #64748B
text-disabled:  #94A3B8
```

### Status
```
success:    #16A34A
warning:    #F59E0B
danger:     #DC2626
info:       #2563EB
```

### Core Value Accents
These are used for Core Value cards, not as primary UI colours.
```
Adaptable:    Blue    #2563EB  → bg-value-adaptable
Transparent:  Teal    #14B8A6  → bg-value-transparent
Collaborative: Purple #7C3AED  → bg-value-collaborative
Innovative:   Orange  #EA580C  → bg-value-innovative
Accountable:  Green   #16A34A  → bg-value-accountable
```

Use soft tinted backgrounds (e.g., 10% opacity) rather than fully saturated backgrounds.

## Typography

Font: **Inter** (loaded via Google Fonts or Fontsource)

Scale:
```
text-xs:  12px
text-sm:  14px  ← Default body, table cells
text-base: 16px ← Body text
text-lg:  18px  ← Card titles, section headers
text-xl:  20px
text-2xl: 24px  ← Page subtitles
text-3xl: 30px  ← Page titles
text-4xl: 36px  ← Hero elements
```

Weight:
```
font-normal:  400  ← body text
font-medium:  500  ← labels, emphasis
font-semibold: 600 ← card titles, section headers
font-bold:    700  ← page titles, metric values
```

## Spacing

Use Tailwind's default scale. Prefer:
- `p-4` (16px) for card padding
- `p-6` (24px) for page sections
- `gap-4` for grid/flex gaps
- `space-y-6` for vertical section spacing

## Components

### Cards
```tsx
<div className="bg-surface border border-border rounded-xl p-6 shadow-sm">
```
- Always rounded-xl (12px)
- Always shadow-sm (never shadow-md or shadow-lg unless floating)
- Border always border-border

### Buttons
Primary:
```tsx
<Button className="bg-blue-600 hover:bg-blue-700 text-white font-medium">
```

Secondary:
```tsx
<Button variant="outline" className="border-border text-text-primary">
```

Ghost:
```tsx
<Button variant="ghost" className="text-text-secondary hover:text-text-primary">
```

### Form inputs
```tsx
<Input className="border-border focus:ring-blue-500 bg-surface" />
```

### Badges (Core Value)
Use soft coloured backgrounds:
```tsx
// Collaborative example
<span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full 
                  bg-purple-50 text-purple-700 text-xs font-medium">
  <Icon size={12} />
  Collaborative
</span>
```

## Layout

### Page structure
```
┌─────────────────────────────────────┐
│           TopBar (fixed)            │
├─────────┬───────────────────────────┤
│         │                           │
│ Sidebar │   Page Content            │
│         │   (max-w-7xl, mx-auto)    │
│ (fixed) │                           │
│         │                           │
└─────────┴───────────────────────────┘
```

Sidebar: 240px wide on desktop
Content: `max-w-7xl mx-auto px-6 py-8`

### Grid layouts
```tsx
// Stats grid
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">

// Content + sidebar
<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
```

## Icons

Use Lucide React exclusively. Import only what you use:
```typescript
import { Star, Award, Trophy, Zap, HandMetal } from 'lucide-react'
```

Standard sizes:
- Navigation: 18px
- Buttons: 16px
- Badges/labels: 12px
- Empty states: 48px

## Micro-interactions

Use Tailwind transition utilities:
```tsx
className="transition-all duration-200 ease-in-out"
```

- Core Value card selection: scale(1.02) + border colour change
- Button hover: slight background shift (50ms)
- Modal open/close: fade + slide (200ms)
- Badge unlock: subtle scale animation

**Never** use: bounce, spin (except loading), excessive movement

## Empty States

Pattern:
```tsx
<div className="flex flex-col items-center justify-center py-16 text-center">
  <Icon size={48} className="text-text-disabled mb-4" />
  <h3 className="text-lg font-semibold text-text-primary mb-2">
    No recognitions yet
  </h3>
  <p className="text-text-muted max-w-sm">
    Great behaviours happen every day. Be the first to recognize someone.
  </p>
  <Button className="mt-6">Give Recognition</Button>
</div>
```

## Avoid

- Excessive gradients (one subtle gradient max per page)
- Glassmorphism effects
- Shadow-lg or shadow-xl on cards
- Bright/saturated background colours on page sections
- Childish icons or gamification elements
- Excessive emojis in UI (text only, not decorative)
- Dense information layouts — use whitespace generously
- Horizontal scrolling on mobile
