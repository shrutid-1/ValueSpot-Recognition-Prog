/**
 * The ValueSpot wordmark, drawn to Touchcore's.
 *
 * The parent logo is a pure wordmark: wide square-geometric uppercase, split
 * across two colours at the word seam — TOUCH in the signal red, CORE in
 * chrome white — with one letter carrying the whole identity: the O of CORE
 * is a ring with a red dot at its centre rather than a plain counter.
 *
 * ValueSpot is built on the same three moves, on its own seam:
 *
 *   · VALUE takes the red, SPOT takes the chrome. Same split, same order.
 *   · The O of SPOT becomes the ring-and-dot. It is the only O in the name,
 *     which is why the mark lands cleanly rather than having to be chosen.
 *   · Michroma carries it. Touchcore's face is a Eurostile Extended — square
 *     bowls, monoline strokes, rounded corners, very wide — and Michroma is
 *     the closest of those available as a web font.
 *
 * The O is SVG rather than a letter because it has to be: no font ships a
 * dotted O, and faking one with a pseudo-element would come apart the moment
 * the wordmark is resized. Everything is sized in `em` off the one `size`
 * prop, so the glyph tracks the text at any scale.
 *
 * `tone` says what the mark is sitting ON, not what colour it is:
 * `onDark` for the Employee portal and the auth brand panel, `onLight` for
 * the administrative rail and anything on a white card. The red deepens on
 * light so it clears AA against white; the logo red itself is too bright
 * there, and is used unchanged on dark where it belongs.
 */

/** The logo red, exactly as it appears in the Touchcore mark. */
const RED_ON_DARK = '#E3352B'
/** The same hue carried down the value scale until white/dark text-safe. */
const RED_ON_LIGHT = '#C42A20'

const LETTER_ON_DARK = '#FFFFFF'
const LETTER_ON_LIGHT = '#16161A'

export const LOGO_FONT =
  "'Michroma', 'Orbitron', 'Barlow Condensed', system-ui, sans-serif"

/**
 * The weight.
 *
 * Michroma ships ONE weight, so `font-weight: 700` has no face to reach for.
 * A browser would synthesise the bold itself — by stroking the outline, which
 * is what happens below, except the browser picks the amount and the SVG O
 * cannot be told what it picked. Stroking it here instead keeps the letters
 * and the ring on the same weight at every size, which is the whole point:
 * the O is a letter, and a letter that is lighter than its neighbours reads
 * as a mistake rather than as a mark.
 *
 * In em, so it tracks the type. A stroke sits centred on the outline, so it
 * thickens a stem by about its own width.
 */
const STEM = 0.028

/*
  The ring, in the SVG's own units.

  The stroke is the STEM above carried into a 24-unit box drawn at 0.78em:
  0.028em / 0.78em * 24 ≈ 0.86 units on top of the 2.7 it was. The radius comes
  down by half of that gain so the OUTER diameter does not move — the ring still
  measures the same as the cap height beside it, it is just drawn heavier.
*/
const RING_R = 9.0
const RING_W = 3.5

export type LogoTone = 'onDark' | 'onLight'

function palette(tone: LogoTone) {
  return tone === 'onDark'
    ? { red: RED_ON_DARK, letter: LETTER_ON_DARK }
    : { red: RED_ON_LIGHT, letter: LETTER_ON_LIGHT }
}

/**
 * The dotted O, as a letter-shaped box.
 *
 * Width is a touch over 1em because that is roughly Michroma's O advance —
 * the point is that the glyph occupies the space a real O would, so the
 * letterspacing either side of it stays even.
 */
function DottedO({ letter, red }: { letter: string; red: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1.02em',
        height: '1em',
        /*
          Michroma's caps sit above the em-box centre, so centring the glyph on
          the line box alone leaves it riding low against its neighbours. The
          nudge puts the ring on the cap-height axis.
        */
        transform: 'translateY(-0.055em)',
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        style={{ width: '0.78em', height: '0.78em', display: 'block', overflow: 'visible' }}
        focusable="false"
      >
        <circle cx="12" cy="12" r={RING_R} fill="none" stroke={letter} strokeWidth={RING_W} />
        <circle cx="12" cy="12" r="3.3" fill={red} />
      </svg>
    </span>
  )
}

export interface ValueSpotLogoProps {
  /** Type size in px. Everything else is derived from it. */
  size?: number
  /** What the logo is sitting on. */
  tone?: LogoTone
  /** Accessible name. Pass null when an ancestor already labels the logo. */
  title?: string | null
  className?: string
}

export function ValueSpotLogo({
  size = 18,
  tone = 'onLight',
  title = 'ValueSpot',
  className,
}: ValueSpotLogoProps) {
  const { red, letter } = palette(tone)

  return (
    <span
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: LOGO_FONT,
        fontSize: size,
        fontWeight: 400,
        lineHeight: 1,
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}
    >
      <span style={{ color: red, WebkitTextStroke: `${STEM}em ${red}` }}>Value</span>
      <span style={{ color: letter, WebkitTextStroke: `${STEM}em ${letter}` }}>Sp</span>
      <DottedO letter={letter} red={red} />
      <span style={{ color: letter, WebkitTextStroke: `${STEM}em ${letter}` }}>t</span>
    </span>
  )
}

/**
 * The square mark: the logo reduced to the one letter that carries it.
 *
 * Used where a wordmark will not fit — the navigation disc, the rail tile,
 * the favicon. The ground is the logo's own black, on a white rail as much as
 * on a dark page, because that black IS the brand rather than a background
 * that happens to be behind it.
 */
export function ValueSpotMark({
  size = 34,
  radius = 999,
  className,
}: {
  size?: number
  /** 999 for a disc, a number for a rounded tile. */
  radius?: number
  className?: string
}) {
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: radius,
        background: '#0B0B0B',
        flexShrink: 0,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        style={{ width: size * 0.58, height: size * 0.58, display: 'block' }}
        focusable="false"
      >
        <circle cx="12" cy="12" r={RING_R} fill="none" stroke="#FFFFFF" strokeWidth={RING_W} />
        <circle cx="12" cy="12" r="3.3" fill={RED_ON_DARK} />
      </svg>
    </span>
  )
}
