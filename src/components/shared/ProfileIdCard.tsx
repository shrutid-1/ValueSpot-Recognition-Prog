import { HangingIdCard } from '@/components/lightswind/hanging-id-card'
import { roleLabel } from '@/lib/portals'
import { getInitials } from '@/lib/utils'
import type { Employee, UserRole } from '@/types'

/**
 * The signed-in person's badge, on a lanyard.
 *
 * WHY ONE COMPONENT AND NOT FOUR
 * ------------------------------
 * Employee, Manager, HR and Super Admin all reach Profile through the same
 * unguarded route, so the four portals differ here only in what `role` says.
 * Branching on that inside the card is the whole of the role handling; a card
 * per portal would be the same markup four times, drifting apart on the first
 * edit that only reached three of them.
 *
 * WHAT IT IS NOT
 * --------------
 * Not a credential. It renders `employees` columns the page already shows in
 * its detail list — nothing here is checked, granted, or trusted by anything.
 * Somebody who edited `role` in memory would recolour a picture of a badge.
 *
 * COLOUR
 * ------
 * The band is keyed to the role, off the Blueprint accent ramp and darkening
 * with seniority, so the four portals are told apart at a glance without
 * introducing a hue the design system does not already use. The badge number
 * takes `--color-accent` instead: that token is re-pointed at lime inside
 * [data-vs-theme='dark'], which is how the same card reads correctly on the
 * Employee portal's dark canvas and the administrative light one.
 */

/** Blueprint accent ramp, darkening with seniority. No new hues. */
const ROLE_ACCENT: Record<UserRole, string> = {
  employee:    '#de584d',  // accent-500
  manager:     '#c42a20',  // accent-600
  hr_admin:    '#a2211a',  // accent-700
  super_admin: '#7c1913',  // accent-800
}

/**
 * The photo window on the band.
 *
 * Deliberately NOT <EmployeeAvatar>. That tile colours itself from the theme
 * tokens for the page surface — in the light portal it resolves to a 16%-alpha
 * fill with #7c1913 initials, which is very nearly the colour of the band it
 * would be sitting on, so the initials disappeared entirely behind the Super
 * Admin gradient. The band is a dark accent in BOTH portals, so this one is
 * fixed to light-on-dark rather than tracking a token that knows nothing about
 * what is behind it.
 */
function BandPhoto({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  return (
    <div
      style={{
        width: 68,
        height: 68,
        borderRadius: 999,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(255,255,255,0.18)',
        border: '1px solid rgba(255,255,255,0.38)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.28)',
        color: '#ffffff',
        fontSize: 20,
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}
      title={name}
      aria-hidden="true"
    >
      {avatarUrl
        ? <img
            src={avatarUrl}
            alt=""
            style={{ width: 68, height: 68, objectFit: 'cover', display: 'block' }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        : getInitials(name)}
    </div>
  )
}

/** Company wordmark, served from `public/`. */
const TOUCHCORE_LOGO = '/touchcore-logo-2-on-dark.png'

/** Deterministic bar heights — a barcode that re-renders identically. */
const BARS = Array.from({ length: 26 }, (_, i) => ({
  width: i % 3 === 0 ? 3.5 : 2,
  height: 50 + Math.sin(i * 1.3) * 35,
}))

export function ProfileIdCard({ employee }: { employee: Employee }) {
  const accent = ROLE_ACCENT[employee.role] ?? ROLE_ACCENT.employee
  // What the person does, when they have said; otherwise their access level.
  // The band colour stays keyed to the access level either way.
  const title = employee.designation ?? roleLabel(employee.role)

  return (
    <HangingIdCard
      ropeLength={140}
      accentColor={accent}
      name={employee.full_name}
      role={title}
      badgeId={employee.employee_id}
    >
      <div className="flex flex-col">
        {/* Band — avatar over the role's accent */}
        <div
          className="px-4 pt-5 pb-7 flex flex-col items-center gap-2 relative"
          style={{ background: `linear-gradient(135deg, ${accent} 0%, #2a100d 100%)` }}
        >
          {/* Contact chip. Pure decoration: it is what makes the thing read as
              a pass rather than a rounded rectangle with a name on it. */}
          <div
            className="absolute top-2.5 left-3 w-6 h-5 rounded shadow-sm flex items-center justify-center"
            style={{
              // Gold, like a real contact chip: highlight, body, highlight.
              background: 'linear-gradient(135deg, #f8e39a 0%, #d4a53c 55%, #f1cf72 100%)',
              border: '1px solid rgba(255,236,170,0.55)',
            }}
            aria-hidden="true"
          >
            <div
              className="w-4 h-3 rounded-[1px] grid grid-cols-2 gap-[1px] p-[1px]"
              style={{ border: '1px solid rgba(110,72,8,0.45)' }}
            >
              {[0, 1, 2, 3].map(i => (
                <div key={i} style={{ background: 'rgba(110,72,8,0.32)' }} />
              ))}
            </div>
          </div>

          {/* The issuing company, in its white-on-dark cut. Straight on the
              band, the red TOUCH all but vanished into the red — worst on the
              lightest (employee) band — so it gets its own black plate. */}
          <div
            style={{
              marginTop: 2,
              marginBottom: 4,
              padding: '6px 12px',
              borderRadius: 999,
              background: '#0B0B0B',
              border: '1px solid rgba(255,255,255,0.14)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
            }}
          >
            <img
              src={TOUCHCORE_LOGO}
              alt="Touchcore"
              width={132}
              style={{ display: 'block', height: 'auto' }}
              draggable={false}
            />
          </div>

          <div className="mt-1">
            <BandPhoto name={employee.full_name} avatarUrl={employee.avatar_url} />
          </div>
        </div>

        {/* Face */}
        <div className="px-3 py-5 flex flex-col items-center gap-1.5 flex-1">
          <p
            className="font-condensed text-center leading-tight"
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: 'var(--color-text)',
              letterSpacing: '-0.01em',
            }}
          >
            {employee.full_name}
          </p>
          <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-neutral-600)' }}>
            {title}
          </p>

          <div
            className="my-1.5 w-full"
            style={{ borderTop: '1px solid var(--color-divider)' }}
          />

          <div className="flex gap-[2px] items-end h-9 px-1" aria-hidden="true">
            {BARS.map((bar, i) => (
              <div
                key={i}
                className="rounded-[1px]"
                style={{
                  width: bar.width,
                  height: `${bar.height}%`,
                  background: 'var(--color-text)',
                }}
              />
            ))}
          </div>

          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.12em',
              marginTop: 2,
              color: 'var(--color-accent)',
              fontFamily: '"IBM Plex Mono", monospace',
            }}
          >
            {employee.employee_id}
          </p>

          <span
            style={{
              marginTop: 5,
              padding: '3px 12px',
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: '#ffffff',
              background: employee.is_active ? accent : 'var(--color-neutral-500)',
            }}
          >
            {employee.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>
    </HangingIdCard>
  )
}
