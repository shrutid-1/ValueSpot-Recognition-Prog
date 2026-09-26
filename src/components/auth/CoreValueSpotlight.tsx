import { useState } from 'react'
import { CORE_VALUE_SLUGS, CORE_VALUE_COLORS, type CoreValueSlug } from '@/lib/constants'

/** Names and definitions, as the Core Values are seeded. */
const VALUES: Record<CoreValueSlug, { name: string; definition: string }> = {
  adaptable:     { name: 'Adaptable',     definition: 'Adjusts positively to changing requirements, priorities and technologies.' },
  transparent:   { name: 'Transparent',   definition: 'Communicates openly, honestly and responsibly.' },
  collaborative: { name: 'Collaborative', definition: 'Works effectively with others and prioritizes collective success.' },
  innovative:    { name: 'Innovative',    definition: 'Challenges existing approaches and creates better ways of working.' },
  accountable:   { name: 'Accountable',   definition: 'Takes ownership of commitments, responsibilities and outcomes.' },
}

/**
 * The Core Values for the sign-in brand panel: one value in the spotlight at
 * a time, with a strip of five segments beneath it.
 *
 * The active segment's bar fills over a few seconds and, when it finishes,
 * moves the spotlight on. Driving the rotation from `animationend` keeps it
 * in step with the CSS for free: hovering or focusing the strip pauses the
 * animation (so the rotation), and under prefers-reduced-motion there is no
 * animation, so nothing moves unless someone picks a value.
 */
export function CoreValueSpotlight() {
  const [active, setActive] = useState(0)
  const slug = CORE_VALUE_SLUGS[active]
  const value = VALUES[slug]
  const count = CORE_VALUE_SLUGS.length

  return (
    <div className="au-spot" style={{ '--tone': CORE_VALUE_COLORS[slug] } as React.CSSProperties}>
      <div className="au-spot-head">
        <p className="vs-kicker" style={{ color: 'var(--color-accent-400)' }}>Core Values</p>
        <p className="au-spot-count" aria-hidden="true">
          <span>{String(active + 1).padStart(2, '0')}</span> / {String(count).padStart(2, '0')}
        </p>
      </div>

      {/* Keyed so each change replays the entrance. */}
      <div key={slug} className="au-spot-feature">
        <span className="au-spot-glow" aria-hidden="true" />
        <p className="font-condensed au-spot-name">{value.name}</p>
        <p className="au-spot-def">{value.definition}</p>
      </div>

      <div className="au-spot-strip" role="group" aria-label="Choose a Core Value">
        {CORE_VALUE_SLUGS.map((s, i) => (
          <button
            key={s}
            type="button"
            className="au-spot-seg"
            aria-pressed={i === active}
            onClick={() => setActive(i)}
            style={{ '--seg-tone': CORE_VALUE_COLORS[s] } as React.CSSProperties}
          >
            <span className="au-spot-bar" aria-hidden="true">
              {i === active && (
                <span
                  className="au-spot-fill"
                  onAnimationEnd={() => setActive((i + 1) % count)}
                />
              )}
            </span>
            <span className="font-condensed au-spot-label">{VALUES[s].name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
