import { useCallback } from 'react'
import {
  BookOpen, Coffee, Dumbbell, Gamepad2, Gift, Globe, GraduationCap, Heart,
  HeartPulse, Laptop, Leaf, Music, Palette, Plane, ShoppingBag, Sparkles,
  Star, Ticket, Trophy, UtensilsCrossed,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { RewardCategory, StoreCategory } from '@/types'
import { useStoreCategories } from '@/hooks/queries'

/*
  One glyph per SHELF, not per reward.

  A cup on the Coffee Voucher and a film reel on the Movie Voucher is the
  short road to a children's rewards app. The category mark says where in the
  store you are, which is information the card would otherwise have to spell
  out in words, and it repeats across rewards rather than illustrating each
  one.

  Lifted out of RewardCard when My Redemptions arrived: a redeemed reward has
  to wear the same mark as the one on the shelf, or the two screens stop
  looking like the same store.

  Since migration 062 the shelves are rows HR edits, so a shelf names its
  glyph by KEY (`reward_categories.icon`) and this is the set of keys HR may
  choose from. The database stores the key only; an unknown one — a glyph
  retired from this list — draws as the fallback rather than breaking a card.
*/
export const CATEGORY_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  'coffee':          { icon: Coffee,          label: 'Coffee' },
  'ticket':          { icon: Ticket,          label: 'Ticket' },
  'graduation-cap':  { icon: GraduationCap,   label: 'Learning' },
  'heart-pulse':     { icon: HeartPulse,      label: 'Wellness' },
  'sparkles':        { icon: Sparkles,        label: 'Sparkles' },
  'gift':            { icon: Gift,            label: 'Gift' },
  'trophy':          { icon: Trophy,          label: 'Trophy' },
  'star':            { icon: Star,            label: 'Star' },
  'heart':           { icon: Heart,           label: 'Heart' },
  'book-open':       { icon: BookOpen,        label: 'Book' },
  'utensils':        { icon: UtensilsCrossed, label: 'Food' },
  'shopping-bag':    { icon: ShoppingBag,     label: 'Shopping' },
  'plane':           { icon: Plane,           label: 'Travel' },
  'dumbbell':        { icon: Dumbbell,        label: 'Fitness' },
  'leaf':            { icon: Leaf,            label: 'Nature' },
  'music':           { icon: Music,           label: 'Music' },
  'gamepad':         { icon: Gamepad2,        label: 'Games' },
  'laptop':          { icon: Laptop,          label: 'Tech' },
  'palette':         { icon: Palette,         label: 'Creative' },
  'globe':           { icon: Globe,           label: 'Giving' },
}

/** What a new shelf wears until HR picks something else. */
export const DEFAULT_CATEGORY_ICON = 'gift'

/** The glyph for a key, falling back rather than failing on one we no longer ship. */
export function iconFor(key: string | null | undefined): LucideIcon {
  return (key && CATEGORY_ICONS[key]?.icon) || Gift
}

/*
  The glyphs the five original shelves were seeded with (062), used only for
  the moment before the category list arrives so their cards do not swap
  glyph on load. The list itself is the authority once it is here.
*/
const SEEDED_SHELF_ICONS: Record<string, string> = {
  everyday: 'coffee',
  experiences: 'ticket',
  learning: 'graduation-cap',
  wellness: 'heart-pulse',
  recognition: 'sparkles',
}

/** "wellness" → "Wellness", "team-days" → "Team days". */
function humanise(slug: string): string {
  const words = slug.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The mark for a shelf that may no longer exist.
 *
 * A redemption keeps its reward's name in a snapshot but joins the catalogue
 * for the category, and HR can delete the reward (null) or rename the shelf.
 * Until the category list has loaded, the slug itself is shown in words —
 * for the original five that reads exactly like their label, so nothing
 * flickers.
 */
export function markFor(
  category: RewardCategory | null | undefined,
  categories: StoreCategory[] | undefined,
): { icon: LucideIcon; label: string } {
  if (!category) return { icon: Gift, label: 'Reward' }
  const found = categories?.find(c => c.slug === category)
  if (found) return { icon: iconFor(found.icon), label: found.label }
  return { icon: iconFor(SEEDED_SHELF_ICONS[category]), label: humanise(category) }
}

/**
 * `markFor`, bound to the cached category list.
 *
 * Every card calls this, and every card shares the one query behind it, so a
 * store of seventy rewards still asks for the categories once.
 */
export function useCategoryMark() {
  const { data } = useStoreCategories()
  return useCallback(
    (category: RewardCategory | null | undefined) => markFor(category, data),
    [data],
  )
}
