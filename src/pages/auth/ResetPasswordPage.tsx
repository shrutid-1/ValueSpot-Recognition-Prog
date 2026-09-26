import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { ROUTES } from '@/lib/constants'
import {
  AuthBrand, FieldError, FieldLabel, FormAlert, IconInput,
} from '@/components/auth/AuthShell'

const schema = z.object({
  email: z.string().email('Please enter a valid email address'),
})
type Form = z.infer<typeof schema>

const newPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Za-z]/, 'Password must contain a letter')
      .regex(/[0-9]/, 'Password must contain a number'),
    confirm: z.string().min(1, 'Please confirm your password'),
  })
  .refine(v => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  })
type NewPasswordForm = z.infer<typeof newPasswordSchema>

export default function ResetPasswordPage() {
  const { resetPassword, updatePassword } = useAuth()
  const navigate = useNavigate()
  const [submitted, setSubmitted]     = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  // True once Supabase has exchanged the emailed link for a recovery session,
  // which is when the user can actually choose a new password.
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [updated, setUpdated]           = useState(false)
  const [showPw, setShowPw]             = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting } } =
    useForm<Form>({ resolver: zodResolver(schema) })

  const {
    register: registerPw,
    handleSubmit: handleSubmitPw,
    formState: { errors: pwErrors, isSubmitting: pwSubmitting },
  } = useForm<NewPasswordForm>({ resolver: zodResolver(newPasswordSchema) })

  useEffect(() => {
    // The recovery link lands here as #access_token=...&type=recovery (implicit)
    // or ?code=... (PKCE). supabase-js consumes it and emits PASSWORD_RECOVERY.
    const hash = window.location.hash
    const search = window.location.search
    if (hash.includes('type=recovery') || search.includes('code=')) {
      setRecoveryMode(true)
    }
    if (hash.includes('error_description=')) {
      const description = new URLSearchParams(hash.replace(/^#/, '')).get('error_description')
      setServerError(description ?? 'This reset link is no longer valid. Please request a new one.')
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  const onSubmit = async (data: Form) => {
    setServerError(null)
    const { error } = await resetPassword(data.email)
    if (error) { setServerError(error); return }
    setSubmitted(true)
  }

  const onSubmitNewPassword = async (data: NewPasswordForm) => {
    setServerError(null)
    const { error } = await updatePassword(data.password)
    if (error) { setServerError(error); return }
    setUpdated(true)
    // Give the confirmation a beat to register, then send them to sign in.
    setTimeout(() => navigate(ROUTES.LOGIN, { replace: true }), 2000)
  }

  const title = recoveryMode
    ? (updated ? 'Password updated' : 'Choose a new password')
    : submitted ? 'Check your inbox' : 'Forgot password'

  const subtitle = recoveryMode
    ? (updated
        ? 'Signing you back in…'
        : 'Pick a password you have not used on ValueSpot before.')
    : submitted
      ? 'A reset link has been sent if an account exists for that email.'
      : "Enter your work email and we'll send you a reset link."

  return (
    // Single column, in the same grey panel as sign in: the recovery link can
    // arrive with a session, so this page stands apart from the auth frame.
    <main className="au-scope au-form-panel">
      <div className="au-column">
        <AuthBrand />

        <div className="au-head">
          <p className="au-kicker">Account Security</p>
          <h1 className="au-title">{title}</h1>
          <p className="au-subtitle">{subtitle}</p>
        </div>

        {recoveryMode ? (
          updated ? (
            /* Password changed */
            <div className="au-success" role="status">
              <CheckCircle2 size={16} style={{ marginTop: 1, flexShrink: 0 }} aria-hidden="true" />
              <span>Your password has been changed. You can now sign in with your new password.</span>
            </div>
          ) : (
            /* Set new password */
            <form className="au-form" onSubmit={handleSubmitPw(onSubmitNewPassword)} noValidate>
              <div className="au-field">
                <FieldLabel htmlFor="new-password">New Password</FieldLabel>
                <div className="au-input-wrap">
                  <span className="au-input-icon" aria-hidden="true"><Lock size={16} strokeWidth={1.8} /></span>
                  <input
                    id="new-password"
                    type={showPw ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="vs-input w-full au-input au-has-icon au-has-toggle"
                    aria-invalid={pwErrors.password ? 'true' : undefined}
                    aria-describedby={pwErrors.password ? 'new-password-error' : undefined}
                    {...registerPw('password')}
                  />
                  <button
                    type="button"
                    className="au-toggle"
                    onClick={() => setShowPw(v => !v)}
                    aria-label={showPw ? 'Hide passwords' : 'Show passwords'}
                    aria-pressed={showPw}
                  >
                    {showPw ? <EyeOff size={16} strokeWidth={1.8} /> : <Eye size={16} strokeWidth={1.8} />}
                  </button>
                </div>
                {pwErrors.password && (
                  <FieldError id="new-password-error">{pwErrors.password.message}</FieldError>
                )}
              </div>

              <div className="au-field">
                <FieldLabel htmlFor="confirm-password">Confirm New Password</FieldLabel>
                <div className="au-input-wrap">
                  <span className="au-input-icon" aria-hidden="true"><Lock size={16} strokeWidth={1.8} /></span>
                  <input
                    id="confirm-password"
                    type={showPw ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="vs-input w-full au-input au-has-icon"
                    aria-invalid={pwErrors.confirm ? 'true' : undefined}
                    aria-describedby={pwErrors.confirm ? 'confirm-password-error' : undefined}
                    {...registerPw('confirm')}
                  />
                </div>
                {pwErrors.confirm && (
                  <FieldError id="confirm-password-error">{pwErrors.confirm.message}</FieldError>
                )}
              </div>

              {serverError && <FormAlert>{serverError}</FormAlert>}

              <button
                type="submit"
                className="au-btn"
                disabled={pwSubmitting}
                aria-busy={pwSubmitting}
              >
                {pwSubmitting ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )
        ) : submitted ? (
          /* Success state */
          <div className="au-success" role="status">
            <CheckCircle2 size={16} style={{ marginTop: 1, flexShrink: 0 }} aria-hidden="true" />
            <span>
              If an account exists for that email address, you&rsquo;ll receive a password
              reset link shortly.
            </span>
          </div>
        ) : (
          /* Reset form */
          <form className="au-form" onSubmit={handleSubmit(onSubmit)} noValidate>
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

            {serverError && <FormAlert>{serverError}</FormAlert>}

            <button
              type="submit"
              className="au-btn"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <div className="au-links">
          <p>
            <Link to={ROUTES.LOGIN} className="au-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ArrowLeft size={14} aria-hidden="true" />
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
