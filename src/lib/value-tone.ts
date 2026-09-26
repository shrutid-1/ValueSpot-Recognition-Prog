/**
 * Core Value → mark colour, for the Employee portal.
 *
 * The administrative portals map every value onto one steel-blue family,
 * which is right for a table. Here each value needs its own identity: it is
 * the pill on a recognition, the dot in the value matrix and the circular
 * mark on the rail.
 *
 * The five are drawn from the portal's own palette rather than from a hue
 * wheel, and every one of them is LIGHT — deliberately. In this design a
 * value most often appears as a solid fill with near-black text on it, so a
 * dark tone would be unusable in the place the tones are used most. All five
 * clear 7.7:1 as text on a panel and 8:1 or better as a fill under #0B0B0B.
 *
 * They sit on the Touchcore axis — the signal red at one end, platinum at the
 * other — with three supporting hues between. Five categories have to be told
 * apart on a chart, which one brand hue cannot do, so the family is
 * harmonised with the brand rather than collapsed into it.
 *
 * Kept in step with --vsx-v-* in employee-theme.css.
 *
 * An unknown or newly added value falls back to white rather than to a random
 * colour: HR can add a sixth at any time and it should look deliberate.
 */

import type { CSSProperties } from 'react'
import { CORE_VALUE_COLORS, type CoreValueSlug } from './constants'

export const VALUE_TONE: Record<string, string> = {
  adaptable:     '#92B9DB',  // steel
  transparent:   '#EDF1F5',  // platinum
  collaborative: '#F0A0AE',  // rose
  innovative:    '#FFC06B',  // amber
  accountable:   '#FF8578',  // the signal red, lightened for a fill
}

export const TONE_FALLBACK = '#EDF1F5'

/** Normalise a slug, a display name, or a name with odd spacing or casing. */
export function toneKey(input: string | null | undefined): string {
  return (input ?? '').toLowerCase().replace(/[^a-z]/g, '')
}

/**
 * A value's tone, as a CSS colour.
 *
 * Returned as a reference to the portal's --vsx-v-* token (with the hex above
 * as its fallback) rather than as the hex itself, so the same mark follows the
 * theme it is painted in: light pastels on the dark canvas, the deep marks in
 * light mode and in the administrative portals. Every caller uses it as a CSS
 * value — a background, a colour, a --tone property — never as a number.
 */
export function valueTone(slugOrName: string | null | undefined): string {
  const key = toneKey(slugOrName)
  return key in VALUE_TONE
    ? `var(--vsx-v-${key}, ${VALUE_TONE[key]})`
    : `var(--vsx-v-fallback, ${TONE_FALLBACK})`
}

/**
 * Both of a value's tones, as inline custom properties, for a screen that is
 * rendered in either portal.
 *
 * `--vt-d` is the light fill tone above, for the dark Employee canvas; `--vt-l`
 * is the darker mark that reads on the administrative portal's white panels.
 * The screen's stylesheet picks one by the theme it finds itself in.
 */
export function valueToneVars(slug: string): CSSProperties {
  return {
    '--vt-l': CORE_VALUE_COLORS[slug as CoreValueSlug] ?? '#c42a20',
    '--vt-d': valueTone(slug),
  } as CSSProperties
}
