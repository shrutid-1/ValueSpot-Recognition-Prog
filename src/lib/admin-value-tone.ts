/**
 * Core Value → mark colour, for the ADMINISTRATIVE portals.
 *
 * The Employee portal has its own five tones in value-tone.ts, and they are
 * deliberately LIGHT: in that design a value most often appears as a solid
 * fill under near-black text, so a dark tone would be unusable there. On a
 * white panel the same five are unusable the other way round — Transparent is
 * near-white and disappears entirely.
 *
 * So this is the same five identities at full strength, chosen to clear 4.5:1
 * as text on a white panel and to stay distinct from one another at the size
 * they are actually used: a 6px dot, an 8px bar, a pill label.
 *
 * An unknown or newly added value falls back to a neutral slate rather than to
 * a random colour: HR can add a sixth at any time and it should look
 * deliberate.
 */

export const ADMIN_VALUE_TONE: Record<string, string> = {
  adaptable:     '#2A6EA8',  // steel
  transparent:   '#5B6B78',  // graphite
  collaborative: '#BE3A66',  // rose
  innovative:    '#A25A0B',  // amber
  accountable:   '#C42A20',  // the signal red
}

export const ADMIN_TONE_FALLBACK = '#6B6B70'

/** Normalise a slug, a display name, or a name with odd spacing or casing. */
function toneKey(input: string | null | undefined): string {
  return (input ?? '').toLowerCase().replace(/[^a-z]/g, '')
}

/**
 * A value's tone as a CSS colour: the portal's --value-* token, with the hex
 * above as its fallback. Dark mode re-points those tokens at lighter marks
 * (styles/theme-modes.css), which is the only way a tone used as TEXT on its
 * own tint stays readable on a dark panel. Callers use it only as a CSS value.
 */
export function adminValueTone(slugOrName: string | null | undefined): string {
  const key = toneKey(slugOrName)
  return key in ADMIN_VALUE_TONE
    ? `var(--value-${key}, ${ADMIN_VALUE_TONE[key]})`
    : `var(--ad-text-2, ${ADMIN_TONE_FALLBACK})`
}
