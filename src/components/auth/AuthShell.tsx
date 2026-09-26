import React, { useId, useState } from 'react'
import { Eye, EyeOff, AlertCircle, Check, Lock } from 'lucide-react'
import { PORTALS, type Portal } from '@/lib/portals'
import { ValueSpotLogo, ValueSpotMark } from '@/components/brand/ValueSpotLogo'

/*
  The sign-in family — sign in, create account, the emailed code, and reset
  password — all wear one look, defined in src/styles/auth.css under
  `.au-scope`: a quiet grey panel, the logo above a large plain title, white
  fields with an icon at the left, and one solid black button.

  Nothing here decides anything. Validation, the two-step sign-in, portal
  checks and routing all live where they did; this file is presentation.
*/

/**
 * Blueprint corner marks. Kept as an export for the pages that still render
 * them; inside `.au-scope` they are hidden, since the auth screens no longer
 * frame their forms in a card.
 */
export function Corners() {
  return (
    <>
      <i className="corner tl" /><i className="corner tr" />
      <i className="corner bl" /><i className="corner br" />
    </>
  )
}

/** The ValueSpot mark and wordmark, above the title on every auth screen. */
export function AuthBrand() {
  return (
    <div className="au-brand">
      <ValueSpotMark size={34} radius={10} />
      <div>
        <ValueSpotLogo size={15} tone="onLight" />
        <p className="au-brand-sub">Touchcore Systems</p>
      </div>
    </div>
  )
}

/**
 * Two-panel frame shared by sign-in and sign-up, so the pair reads as one
 * product. The form sits on the right in the grey panel; the brand panel is
 * on the left from `lg` up and hidden below it, where the form takes the
 * full width. The form still comes first in the DOM (see auth.css).
 */
export function AuthShell({
  headline,
  intro,
  aside,
  children,
}: {
  headline: React.ReactNode
  intro: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="au-shell">
      {/* Form panel */}
      <main className="au-scope au-form-panel">
        <div className="au-column">
          <AuthBrand />
          {children}
        </div>
      </main>

      {/* Brand panel */}
      <aside className="au-brand-panel" data-vs-brand-panel>
        <div aria-hidden="true" className="au-brand-grid" />

        {/* Pinned to the viewport, so a form taller than the screen (sign-up)
            does not stretch this apart and push the aside out of sight. */}
        <div className="au-brand-inner">
          <div>
            <img
              src="/touchcore-logo-2-on-dark.png"
              alt="Touchcore"
              width={2461}
              height={405}
              className="au-brand-company"
              draggable={false}
            />
            <h1 className="font-condensed au-brand-headline">{headline}</h1>
            <p className="au-brand-intro">{intro}</p>
          </div>

          {aside && <div>{aside}</div>}
        </div>
      </aside>
    </div>
  )
}

/** Inline validation message tied to a field via aria-describedby. */
export function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="au-error" style={{ marginTop: 6, fontSize: 12, color: 'var(--color-accent-800)' }}>
      {children}
    </p>
  )
}

/** Neutral hint text under a field. */
export function FieldHint({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="au-hint" style={{ marginTop: 6, fontSize: 12, color: 'var(--color-neutral-500)' }}>
      {children}
    </p>
  )
}

/** Prominent form-level message. */
export function FormAlert({ children }: { children: React.ReactNode }) {
  return (
    <div className="au-alert flex items-start gap-2" role="alert">
      <AlertCircle size={15} style={{ marginTop: 2, flexShrink: 0 }} aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

/** A field label, in the design's bold small type. */
export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="au-label">{children}</label>
}

/**
 * A text input with an icon at its left edge.
 *
 * The icon is decorative (the label names the field), and sits over the
 * input without taking clicks, so pressing it still focuses the field.
 *
 * forwardRef, because react-hook-form's register() hands over a ref: on
 * React 18 a plain function component would drop it, and the form would
 * never read the field's value.
 */
export const IconInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { icon: React.ReactNode }
>(function IconInput({ icon, className, ...props }, ref) {
  return (
    <div className="au-input-wrap">
      <span className="au-input-icon" aria-hidden="true">{icon}</span>
      <input
        ref={ref}
        {...props}
        className={['vs-input w-full au-input au-has-icon', className].filter(Boolean).join(' ')}
      />
    </div>
  )
})

/**
 * Role / portal picker: one row of three, with what the chosen one is for
 * written underneath.
 *
 * A radiogroup rather than a row of buttons — this is a single choice, not
 * three independent controls. Arrow keys move the choice, as in any radio
 * group, and only the chosen option is in the tab order, so Tab passes over
 * the group in one step.
 */
export function PortalSelector({
  value,
  onChange,
  label,
  disabled,
}: {
  value: Portal['id']
  onChange: (id: Portal['id']) => void
  label: string
  disabled?: boolean
}) {
  const groupId = useId()
  const descId = useId()
  const current = PORTALS.find(p => p.id === value) ?? PORTALS[0]

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    if (!step || disabled) return
    e.preventDefault()
    const i = PORTALS.findIndex(p => p.id === value)
    const next = PORTALS[(i + step + PORTALS.length) % PORTALS.length]
    onChange(next.id)
    // Focus follows the choice, as a native radio group's does.
    const target = e.currentTarget.querySelector<HTMLButtonElement>(`[data-portal="${next.id}"]`)
    target?.focus()
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <span id={groupId} className="au-label">{label}</span>

      <div
        role="radiogroup"
        aria-labelledby={groupId}
        aria-describedby={descId}
        className="au-seg"
        onKeyDown={onKeyDown}
      >
        {PORTALS.map(portal => {
          const selected = value === portal.id
          return (
            <button
              key={portal.id}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              data-portal={portal.id}
              onClick={() => onChange(portal.id)}
              className="au-seg-option"
            >
              {selected && <Check size={13} strokeWidth={2.6} aria-hidden="true" />}
              {portal.label}
            </button>
          )
        })}
      </div>
      <p id={descId} className="au-hint" style={{ marginTop: 8, fontSize: 12, color: 'var(--au-muted)' }}>
        {current.description}
      </p>
    </div>
  )
}

/** Password input with a lock icon and a visibility toggle. */
export function PasswordField({
  id,
  label,
  autoComplete,
  error,
  hint,
  registration,
}: {
  id: string
  label: React.ReactNode
  autoComplete: 'current-password' | 'new-password'
  error?: string
  hint?: string
  registration: Record<string, unknown>
}) {
  const [visible, setVisible] = useState(false)
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined

  return (
    <div className="au-field">
      <label htmlFor={id} className="au-label">{label}</label>
      <div className="au-input-wrap">
        <span className="au-input-icon" aria-hidden="true"><Lock size={16} strokeWidth={1.8} /></span>
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          placeholder="••••••••"
          className="vs-input w-full au-input au-has-icon au-has-toggle"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          {...registration}
        />
        <button
          type="button"
          className="au-toggle"
          onClick={() => setVisible(v => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={16} strokeWidth={1.8} /> : <Eye size={16} strokeWidth={1.8} />}
        </button>
      </div>
      {error
        ? <FieldError id={`${id}-error`}>{error}</FieldError>
        : hint ? <FieldHint id={`${id}-hint`}>{hint}</FieldHint> : null}
    </div>
  )
}

/** Four-step password strength meter. Advisory; the schema enforces the floor. */
export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null

  const checks = [
    password.length >= 8,
    password.length >= 12,
    /[A-Z]/.test(password) && /[a-z]/.test(password),
    /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password),
  ]
  const score = checks.filter(Boolean).length
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong']

  return (
    <div className="au-strength">
      <div className="au-strength-bars" aria-hidden="true">
        {[0, 1, 2, 3].map(i => (
          <span key={i} className={i < score ? 'is-on' : undefined} />
        ))}
      </div>
      <p aria-live="polite" style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>
        Password strength: {labels[score]}
      </p>
    </div>
  )
}
