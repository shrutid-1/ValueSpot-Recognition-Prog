import { useCallback, useEffect, useRef, useState } from 'react'
import { MailCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AuthShell, FieldLabel, FormAlert } from '@/components/auth/AuthShell'

/**
 * Step two of signing in: the six-digit code sent to the person's inbox.
 *
 * Deliberately NOT Supabase's signInWithOtp(). That endpoint is passwordless
 * *primary* authentication — its verify call carries no Authorization header,
 * so Supabase always mints a fresh session and the password becomes optional.
 * Anyone able to read a colleague's inbox could then sign in without ever
 * knowing their password.
 *
 * Instead this calls request_login_code() / verify_login_code() from migration
 * 021, which issue a code only to the session the password already created and
 * bind it to that session's id. The database will not serve an unverified
 * session, so closing this screen and navigating elsewhere achieves nothing.
 */

const CODE_LENGTH = 6

/**
 * Show enough of the address to recognise it, not enough to read it over a
 * shoulder: `priya.nair@example.com` becomes `p*********@example.com`.
 *
 * The person signing in already knows which mailbox is theirs, so the first
 * letter and the domain are all the confirmation they need. Printing the whole
 * address on a screen that is often open in an office — or in a screenshot
 * pasted into a support chat — gives it away for no benefit.
 *
 * Presentation only. The address the code is actually sent to comes from
 * auth.users inside request_login_code(); nothing here influences delivery.
 */
function maskEmail(address: string): string {
  const at = address.lastIndexOf('@')
  if (at < 1) return address           // not an address shape — show unchanged

  const local = address.slice(0, at)
  const domain = address.slice(at)

  // A single-character local part has nothing to hide behind; keep it stable
  // rather than emitting a bare run of asterisks.
  if (local.length <= 1) return `${local}${'*'.repeat(3)}${domain}`

  return `${local[0]}${'*'.repeat(Math.min(local.length - 1, 9))}${domain}`
}

type Purpose = 'signup' | 'login'

interface VerifyEmailStepProps {
  email: string
  /** Wording only — both paths use the same session-bound mechanism. */
  purpose: Purpose
  /** Called once the code is accepted and the session is verified. */
  onVerified: () => void | Promise<void>
  onBack: () => void
}

interface CodeResult {
  status: string
  retry_after?: number
  attempts_remaining?: number
}

interface DeliveryResult {
  status: 'none' | 'pending' | 'sent' | 'failed' | 'not_authenticated'
  reason?: string
  provider_status?: number
}

/**
 * How long to wait before asking whether the provider accepted the message.
 *
 * pg_net posts asynchronously, so the answer does not exist the instant
 * request_login_code() returns. Two and a half seconds is comfortably longer
 * than a normal round trip to the mail provider while still landing before
 * anyone has given up on the inbox.
 */
const DELIVERY_CHECK_DELAY_MS = 2500

/**
 * What to tell someone whose code was refused by the mail provider.
 *
 * Deliberately non-technical: no provider name, no status code, no mention of
 * senders or domains. Someone signing in cannot act on any of that, and the
 * raw text would disclose the mail account owner's address. The detail belongs
 * in the operator's logs, not on a login screen.
 */
function deliveryFailureMessage(reason: string | undefined): string {
  switch (reason) {
    case 'recipient_not_allowed':
      // Development: the test sender only delivers to the account owner.
      return 'We could not deliver a code to this address. Please contact IT ' +
             'so they can enable email for your account.'
    case 'provider_rate_limited':
      return 'Too many emails are being sent right now. Please try again in a ' +
             'few minutes.'
    default:
      return 'We could not send the code because of a problem with our email ' +
             'service. Please try again shortly, or contact IT if it continues.'
  }
}

export function VerifyEmailStep({ email, purpose, onVerified, onBack }: VerifyEmailStepProps) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [sending, setSending] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const requested = useRef(false)
  // Guards the delayed delivery check: the screen is often gone by the time it
  // answers, and setting state on an unmounted component is a leak.
  const alive = useRef(true)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => () => { alive.current = false }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  /**
   * Ask whether the provider accepted the message, and say so if it did not.
   *
   * Runs a couple of seconds after a send. Any failure to answer — the RPC
   * missing because migration 024 has not been applied, a network blip, a
   * response pg_net has already cleared — is treated as "unknown" and leaves
   * the ordinary wording in place. A delivery check must never be able to
   * block a sign-in that is otherwise fine.
   */
  const checkDelivery = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('login_code_delivery_status')
    if (!alive.current || rpcError) return

    const result = data as unknown as DeliveryResult | null
    if (result?.status !== 'failed') return

    setNotice(null)
    setError(deliveryFailureMessage(result.reason))
  }, [])

  const send = useCallback(async (isResend: boolean) => {
    setSending(true)
    setError(null)
    if (isResend) setNotice(null)

    const { data, error: rpcError } = await supabase.rpc('request_login_code')
    setSending(false)

    if (rpcError) {
      setError('We could not send a code right now. Please try again shortly.')
      return
    }

    const r = (data as unknown as CodeResult) ?? { status: 'unknown' }

    switch (r.status) {
      case 'ok':
        // pg_net queues the send asynchronously, so this confirms the request
        // was accepted — not that the message has landed. Worded accordingly,
        // and followed up shortly by the real answer from the provider.
        setCooldown(r.retry_after ?? 60)
        if (isResend) setNotice('Another code is on its way.')
        window.setTimeout(() => { void checkDelivery() }, DELIVERY_CHECK_DELAY_MS)
        return
      case 'already_verified':
        void onVerified()
        return
      case 'cooldown':
        setCooldown(r.retry_after ?? 60)
        return
      case 'rate_limited':
        setError('Too many codes requested. Please wait an hour and try again.')
        return
      case 'password_required':
        setError('Please sign in with your password first.')
        return
      case 'email_not_configured':
        setError('Email delivery is not set up for this workspace. Please contact IT.')
        return
      default:
        setError('We could not send a code right now. Please try again shortly.')
    }
    // checkDelivery is stable (useCallback with no dependencies), so listing it
    // does not cause send() to be recreated or the initial-request effect below
    // to fire twice.
  }, [onVerified, checkDelivery])

  // Ask for the first code on arrival. The ref guards against React's
  // development double-invoke spending two sends against the hourly limit.
  useEffect(() => {
    if (requested.current) return
    requested.current = true
    void send(false)
  }, [send])

  const verify = async (value: string) => {
    setVerifying(true)
    setError(null)
    setNotice(null)

    const { data, error: rpcError } = await supabase.rpc('verify_login_code', { p_code: value })

    if (rpcError) {
      setVerifying(false)
      setError('We could not check that code. Please try again.')
      return
    }

    const r = (data as unknown as CodeResult) ?? { status: 'unknown' }

    if (r.status === 'ok') {
      await onVerified()
      return
    }

    setVerifying(false)
    setCode('')
    inputRef.current?.focus()

    switch (r.status) {
      case 'invalid':
        setError(
          r.attempts_remaining && r.attempts_remaining > 0
            ? `That code is not right. ${r.attempts_remaining} ${
                r.attempts_remaining === 1 ? 'try' : 'tries'} left.`
            : 'That code is not right.',
        )
        return
      case 'expired':
        setError('That code has expired. Send a new one and try again.')
        return
      case 'locked':
        setError('Too many incorrect codes. Request a new one to try again.')
        return
      case 'no_code':
        setError('That code is no longer valid. Send a new one.')
        return
      default:
        setError('We could not check that code. Please try again.')
    }
  }

  const handleChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, CODE_LENGTH)
    setCode(digits)
    setError(null)
    // Submit as soon as the code is complete: nobody wants to type six digits
    // and then hunt for a button.
    if (digits.length === CODE_LENGTH && !verifying) void verify(digits)
  }

  return (
    <AuthShell
      headline={<>Check your<br />inbox.</>}
      intro={purpose === 'signup'
        ? 'One quick check that this mailbox is yours.'
        : 'Second step: the code we just emailed you.'}
      aside={
        <>
          <p className="vs-kicker" style={{ color: 'var(--color-accent-400)', marginBottom: 12 }}>
            Why this step?
          </p>
          <p className="au-aside-note" style={{ marginTop: 0 }}>
            {purpose === 'signup'
              ? 'It confirms the address belongs to you, so nobody can register in your name.'
              : 'Your password alone is not enough to get in. Even if someone learns it, they would also need your email inbox.'}
          </p>
        </>
      }
    >
      <div className="au-head">
        <h2 className="au-title">Enter your code</h2>
        <p className="au-subtitle">
          We sent a {CODE_LENGTH}-digit code to{' '}
          <strong
            style={{ color: 'var(--au-ink)', fontWeight: 600, wordBreak: 'break-all' }}
            // The unmasked address is never rendered, so assistive technology is
            // given the same masked string rather than a more revealing label.
            title="Partly hidden for your privacy"
          >
            {maskEmail(email)}
          </strong>
        </p>
      </div>

      <div className="au-field">
        <FieldLabel htmlFor="otp">Verification Code</FieldLabel>
        <div className="au-input-wrap">
          <span className="au-input-icon" aria-hidden="true"><MailCheck size={16} strokeWidth={1.8} /></span>
          <input
            id="otp"
            ref={inputRef}
            type="text"
            inputMode="numeric"
            // Lets browsers and phones offer the code straight from the message.
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={CODE_LENGTH}
            value={code}
            disabled={verifying}
            onChange={e => handleChange(e.target.value)}
            aria-describedby="otp-hint"
            className="vs-input w-full au-input au-has-icon au-code"
          />
        </div>
        <p id="otp-hint" className="au-hint" style={{ marginTop: 6, fontSize: 12, color: 'var(--au-muted)' }}>
          It expires in 10 minutes. Check your spam folder if it does not arrive.
        </p>
      </div>

      {error && <FormAlert>{error}</FormAlert>}
      {notice && (
        <p role="status" className="au-success">{notice}</p>
      )}

      <button
        type="button"
        className="au-btn"
        disabled={verifying || code.length !== CODE_LENGTH}
        aria-busy={verifying}
        onClick={() => void verify(code)}
      >
        {verifying ? 'Verifying…' : 'Verify and continue'}
      </button>

      <div className="au-links">
        <p>
          Didn&rsquo;t get it?{' '}
          <button
            type="button"
            className="au-link-btn"
            onClick={() => void send(true)}
            disabled={sending || cooldown > 0}
          >
            {sending ? 'Sending…' : cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </button>
        </p>
        <p>
          <button type="button" className="au-link-btn" onClick={onBack}>
            {purpose === 'signup' ? 'Use a different email' : 'Cancel and sign in again'}
          </button>
        </p>
      </div>
    </AuthShell>
  )
}
