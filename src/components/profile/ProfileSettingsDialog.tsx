import { useEffect, useState } from 'react'
import { Eye, EyeOff, LogOut } from 'lucide-react'
import type { Employee } from '@/types'
import { useAuth } from '@/context/AuthContext'
import { roleLabel } from '@/lib/portals'
import { formatIST } from '@/lib/date-utils'
import { toast } from '@/hooks/use-toast'
import { ProfileDialog } from './ProfileDialog'

/** The same rule the reset-password screen applies. */
function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.'
  if (!/[A-Za-z]/.test(password)) return 'Password must contain a letter.'
  if (!/[0-9]/.test(password)) return 'Password must contain a number.'
  return null
}

interface ProfileSettingsDialogProps {
  open: boolean
  onClose: () => void
  employee: Employee
}

/**
 * Account settings: the facts only HR can change, a password change, and a
 * way out. The facts are listed so a person can see what their record says
 * — access level and company ID are not theirs to edit, and saying so here
 * saves a support request.
 */
export function ProfileSettingsDialog({ open, onClose, employee }: ProfileSettingsDialogProps) {
  const { updatePassword, signOut } = useAuth()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [show, setShow]         = useState(false)
  const [saving, setSaving]     = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [done, setDone]         = useState(false)

  useEffect(() => {
    if (!open) return
    setPassword('')
    setConfirm('')
    setShow(false)
    setError(null)
    setDone(false)
  }, [open])

  const busy = saving || signingOut

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    setDone(false)

    const problem = passwordProblem(password)
    if (problem) { setError(problem); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }

    setSaving(true)
    const result = await updatePassword(password)
    setSaving(false)

    if (result.error) {
      // updatePassword() words its session error for the emailed reset link;
      // here the person is signed in, so say what actually helps.
      setError(
        /reset link/i.test(result.error)
          ? 'Your session is too old to change the password. Sign out, sign back in, and try again.'
          : result.error,
      )
      return
    }

    setPassword('')
    setConfirm('')
    setDone(true)
    toast({ title: 'Password changed', variant: 'success' })
  }

  const leave = async () => {
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <ProfileDialog
      open={open}
      onClose={onClose}
      title="Settings"
      description="Your account details and sign-in."
      busy={busy}
      width={500}
      footer={
        <>
          <button type="button" className="vs-btn" onClick={leave} disabled={busy} style={{ marginRight: 'auto' }}>
            <LogOut size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
          <button type="button" className="vs-btn" onClick={onClose} disabled={busy}>Close</button>
        </>
      }
    >
      <section aria-labelledby="vp-account-heading" className="flex flex-col gap-2">
        <span id="vp-account-heading" className="vp-section-title">Account</span>
        <dl className="vp-detail-list">
          <div><dt>Email</dt><dd>{employee.email}</dd></div>
          <div><dt>Company ID</dt><dd style={{ fontFamily: '"IBM Plex Mono", monospace' }}>{employee.employee_id}</dd></div>
          <div><dt>Access level</dt><dd>{roleLabel(employee.role)}</dd></div>
          {employee.joined_at && <div><dt>Joined</dt><dd>{formatIST(employee.joined_at, 'MMMM yyyy')}</dd></div>}
        </dl>
        <p className="vp-field-hint">Email, company ID and access level are managed by HR.</p>
      </section>

      <form onSubmit={changePassword} className="flex flex-col gap-3" noValidate aria-labelledby="vp-password-heading">
        <span id="vp-password-heading" className="vp-section-title">Change password</span>

        {error && <p role="alert" className="vp-form-error">{error}</p>}
        {done && !error && <p role="status" className="vp-form-notice">Your password has been changed.</p>}

        <div className="vp-field">
          <label htmlFor="vp-new-password" className="vp-field-label">New password</label>
          <div className="vp-password-row">
            <input
              id="vp-new-password"
              className="vs-input"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(null); setDone(false) }}
              disabled={busy}
            />
            <button
              type="button"
              className="vp-password-toggle"
              onClick={() => setShow(s => !s)}
              aria-label={show ? 'Hide password' : 'Show password'}
            >
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <p className="vp-field-hint">At least 8 characters, with a letter and a number.</p>
        </div>

        <div className="vp-field">
          <label htmlFor="vp-confirm-password" className="vp-field-label">Confirm new password</label>
          <input
            id="vp-confirm-password"
            className="vs-input"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={e => { setConfirm(e.target.value); setError(null); setDone(false) }}
            disabled={busy}
          />
        </div>

        <div>
          <button
            type="submit"
            className="vs-btn vs-btn-primary"
            disabled={busy || !password || !confirm}
            aria-busy={saving}
          >
            {saving ? 'Updating…' : 'Update password'}
          </button>
        </div>
      </form>
    </ProfileDialog>
  )
}
