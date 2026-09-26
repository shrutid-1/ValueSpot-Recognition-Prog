import { useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Mail } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { VerifyEmailStep } from '@/components/auth/VerifyEmailStep'
import { CoreValueSpotlight } from '@/components/auth/CoreValueSpotlight'
import { ROUTES } from '@/lib/constants'
import { type Portal } from '@/lib/portals'
import { getRememberMe, setRememberMe } from '@/lib/auth-storage'
import {
  AuthShell, FieldError, FieldLabel, FormAlert, IconInput,
  PortalSelector, PasswordField,
} from '@/components/auth/AuthShell'

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Company email address is required')
    .email('Enter a valid company email address'),
  password: z.string().min(1, 'Password is required'),
})
type LoginForm = z.infer<typeof loginSchema>

/** Remembering the last portal saves the common case a click. */
const PORTAL_STORAGE_KEY = 'valuespot.portal'

function loadPortal(): Portal['id'] {
  try {
    const stored = localStorage.getItem(PORTAL_STORAGE_KEY)
    if (stored === 'employee' || stored === 'manager' || stored === 'hr_admin') return stored
  } catch {
    // Private windows and blocked site data both throw here; the default is fine.
  }
  return 'employee'
}

/**
 * Copy for each entry point. A fixed `portal` means the page states which
 * system you are entering rather than asking; it never grants anything.
 *
 * Employee is the only role with a public way in, so it is the only entry
 * point that offers a create-account link. Manager and HR accounts exist
 * because HR invited someone; advertising a signup route on those pages would
 * promise a door that is not there.
 */
const ENTRY: Record<Portal['id'], { kicker?: string; title: string; signupPath?: string }> = {
  employee: { title: 'Sign in', signupPath: ROUTES.SIGNUP },
  manager:  { kicker: 'Manager', title: 'Manager Login' },
  hr_admin: { kicker: 'HR',      title: 'HR Login' },
}

export default function LoginPage({ portal: fixedPortal }: { portal?: Portal['id'] }) {
  const { signIn, completeSignIn, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // /manager/login and /hr/login pin the portal. /login keeps the selector as
  // a convenience for people who share one door. Either way the value is only
  // ever CHECKED against the role on the employee record, in completeSignIn():
  // a portal you are not entitled to is refused, never granted.
  const [chosenPortal, setPortal] = useState<Portal['id']>(loadPortal)
  const portal = fixedPortal ?? chosenPortal
  const entry = ENTRY[portal]
  const [formError, setFormError] = useState<React.ReactNode>(null)

  // Starts from the last choice; ticked unless someone unticked it before.
  const [remember, setRemember] = useState(getRememberMe)

  // Set by SignUpPage after a Manager/HR invitation setup completes, so the
  // hand-off explains itself instead of looking like an unexplained logout.
  const accountReady = (location.state as { accountReady?: string } | null)?.accountReady
  // Password accepted; waiting on the emailed code. Also covers someone who
  // registered but never finished the first verification.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } =
    useForm<LoginForm>({ resolver: zodResolver(loginSchema) })

  const onSubmit = async (data: LoginForm) => {
    setFormError(null)

    // Before signIn(), because that is when the session is first written:
    // the choice decides which storage it lands in (see lib/supabase.ts).
    setRememberMe(remember)

    // Step one: the password only. A correct password never completes a
    // sign-in on its own — it moves to the emailed code.
    const { error, needsVerification } = await signIn(data.email, data.password)

    if (error) {
      setFormError(error)
      return
    }
    if (needsVerification) {
      setPendingEmail(data.email.trim().toLowerCase())
      return
    }

    setFormError('Something went wrong. Please try again.')
  }

  /** Step two succeeded: check the profile and the chosen portal, then enter. */
  const onVerified = async () => {
    // The chosen portal is checked against the role on the employee record. It
    // can only narrow where someone lands — it never grants access, and a
    // mismatch is refused rather than silently downgraded.
    const { error, redirectTo } = await completeSignIn(portal)

    if (error) {
      setPendingEmail(null)
      setFormError(error)
      return
    }

    try {
      localStorage.setItem(PORTAL_STORAGE_KEY, portal)
    } catch {
      // Not being able to remember the choice is not worth failing sign-in over.
    }

    const from = (location.state as { from?: { pathname: string } })?.from?.pathname
    navigate(from ?? redirectTo ?? '/', { replace: true })
  }

  if (pendingEmail) {
    return (
      <VerifyEmailStep
        email={pendingEmail}
        purpose="login"
        onVerified={onVerified}
        onBack={async () => {
          // Leave no half-authenticated session behind.
          await signOut()
          setPendingEmail(null)
        }}
      />
    )
  }

  return (
    <AuthShell
      headline={<>Recognize the behaviour.<br />Reinforce the value.<br />Strengthen the culture.</>}
      intro="Celebrate your colleagues for living Touchcore's Core Values every day."
      aside={<CoreValueSpotlight />}
    >
      <div className="au-head">
        {entry.kicker && <p className="au-kicker">{entry.kicker}</p>}
        <h2 className="au-title">{entry.title}</h2>
        <p className="au-subtitle">Use your Touchcore credentials to continue.</p>
      </div>

      {/* Arrived here from a completed invitation setup. */}
      {accountReady && (
        <div role="status" className="au-success">
          Your {entry.title.replace(' Login', '')} account is ready. Sign in with
          the email address and password you just set.
        </div>
      )}

      <form className="au-form" onSubmit={handleSubmit(onSubmit)} noValidate>
        {!fixedPortal && (
          <PortalSelector label="Sign in as" value={portal} onChange={setPortal} />
        )}

        <div className="au-field">
          <FieldLabel htmlFor="email">Email Address</FieldLabel>
          <IconInput
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@touchcoresystems.com"
            icon={<Mail size={16} strokeWidth={1.8} />}
            aria-invalid={errors.email ? 'true' : undefined}
            aria-describedby={errors.email ? 'email-error' : undefined}
            {...register('email')}
          />
          {errors.email && <FieldError id="email-error">{errors.email.message}</FieldError>}
        </div>

        <PasswordField
          id="password"
          label="Password"
          autoComplete="current-password"
          error={errors.password?.message}
          registration={register('password')}
        />

        <label className="au-check">
          <input
            type="checkbox"
            checked={remember}
            onChange={e => setRemember(e.target.checked)}
            aria-describedby="remember-hint"
          />
          Remember me
          <span id="remember-hint" className="sr-only">
            Unticked, you are signed out when the browser closes.
          </span>
        </label>

        {formError && <FormAlert>{formError}</FormAlert>}

        <button
          type="submit"
          className="au-btn"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div className="au-links">
        {entry.signupPath && (
          <p>
            Don&rsquo;t have an account?{' '}
            <Link to={entry.signupPath} className="au-link">Sign up</Link>
          </p>
        )}
        <p>
          <Link to={ROUTES.RESET_PASSWORD} className="au-link">Forgot Password</Link>
        </p>
      </div>

      <p className="au-foot">Touchcore ValueSpot &middot; Employee Recognition Platform</p>
    </AuthShell>
  )
}
