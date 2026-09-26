import {
  Coffee, GraduationCap, HeartPulse, Sparkles, Ticket,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { RewardCategory } from '@/types'

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
*/
export const CATEGORY_MARK: Record<RewardCategory, { icon: LucideIcon; label: string }> = {
  everyday:    { icon: Coffee,        label: 'Everyday' },
  experiences: { icon: Ticket,        label: 'Experiences' },
  learning:    { icon: GraduationCap, label: 'Learning' },
  wellness:    { icon: HeartPulse,    label: 'Wellness' },
  recognition: { icon: Sparkles,      label: 'Recognition' },
}

/**
 * The mark for a shelf that may no longer exist.
 *
 * A redemption keeps its reward's name in a snapshot but joins the catalogue
 * for the category, and HR can delete the reward. Falling back to Everyday
 * keeps the card whole rather than leaving a hole where the glyph goes.
 */
export function markFor(category: RewardCategory | null | undefined) {
  return (category && CATEGORY_MARK[category]) || CATEGORY_MARK.everyday
}
