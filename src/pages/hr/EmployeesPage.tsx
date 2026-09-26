import React, { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Search, UserCheck, UserX, Edit2, Users, X, Mail, Copy, Check, Trash2, AlertTriangle } from 'lucide-react'
import { employeesApi, ApiError, type EmployeeListItem } from '@/lib/api'
import {
  useEmployeeDirectory, useDepartments,
  useCreateEmployee, useUpdateEmployeeProfile, useSetEmployeeRole,
  useSetEmployeeActive, useSendInvitation, useDeleteEmployee,
  useProjects, useEmployeeProject, useSetEmployeeProject,
} from '@/hooks/queries'
import { useDebounce } from '@/hooks/useDebounce'
import type { Employee, Department } from '@/types'
import { PageHeader } from '@/components/shared/PageHeader'
import { TableSkeleton } from '@/components/shared/SkeletonLoader'
import { EmptyState } from '@/components/shared/EmptyState'
import { EmployeeAvatar } from '@/components/shared/EmployeeAvatar'
import { ConfirmModal } from '@/components/shared/ConfirmModal'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { SEARCH_DEBOUNCE_MS, ROUTES } from '@/lib/constants'
import { useAuth } from '@/context/AuthContext'
import { roleLabel } from '@/lib/portals'
import type { UserRole } from '@/types'
import { dismissOnBackdrop } from '@/lib/backdrop'

const employeeSchema = z.object({
  full_name:     z.string().min(2, 'Name is required'),
  email:         z.string().email('Valid email required'),
  /*
    Company ID. Assigned automatically by the assign_employee_id trigger when
    someone is invited, so the invite form has no such field; HR and a Super
    Admin can correct it when editing. Blank is only valid on the invite form
    (onSave requires it when editing).
  */
  employee_code: z.string().trim()
    .max(20, 'Employee ID can be at most 20 characters')
    .regex(/^$|^[A-Za-z0-9][A-Za-z0-9_/-]*$/, 'Letters, numbers, hyphens, underscores and slashes only')
    .optional(),
  role:          z.enum(['employee', 'manager', 'hr_admin', 'super_admin']),
  // Job title (054). Descriptive only — access is `role`. Blank clears it.
  designation:   z.string().trim().max(60, 'Designation can be at most 60 characters').optional(),
  department_id: z.string().optional(),
  /*
    The employee's ONE active project (MVP rule). Not a column on `employees`
    — it lives in project_members — so it is saved separately below. It decides
    who approves recognitions this person receives.
  */
  project_id:    z.string().optional(),
})
type EmployeeForm = z.infer<typeof employeeSchema>

// EmployeeRow used to be declared here, identical to the API's
// EmployeeListItem. Two names for one shape meant an `as unknown as` cast on
// every read; there is now one type and no cast.
type EmployeeRow = EmployeeListItem

const SEL = 'vs-input w-full'

function FormDialog({
  open, onClose, title, description, children, onSubmit, saving, submitLabel,
}: {
  open: boolean; onClose: () => void; title: string; description?: string
  children: React.ReactNode; onSubmit: () => void; saving: boolean; submitLabel: string
}) {
  // Escape closes it, as it does every other dialog — unless a save is running.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, saving, onClose])

  if (!open) return null
  /*
    Portalled to <body>, like ConfirmModal: rendered in place, the fixed
    backdrop could be re-anchored or stacked under the shell by an ancestor.
    And laid out as a column — header and buttons fixed, only the fields
    between them scroll — because the edit form is taller than a laptop
    screen, and centring a taller-than-the-window box pushed its title and
    close button off the top.
  */
  return createPortal(
    <div
      className="vs-dialog-backdrop"
      {...dismissOnBackdrop(() => { if (!saving) onClose() })}
    >
      <div
        className="vs-dialog animate-fade-in"
        style={{ minWidth: 420, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="employee-form-title"
      >
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div className="flex items-start justify-between" style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--color-divider)', flexShrink: 0 }}>
          <div>
            <h2 id="employee-form-title" className="font-condensed" style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text)' }}>{title}</h2>
            {description && <p style={{ fontSize: 13, color: 'var(--color-neutral-600)', marginTop: 3 }}>{description}</p>}
          </div>
          <button className="vs-btn-icon" style={{ width: 28, height: 28 }} onClick={onClose} disabled={saving} aria-label="Close"><X size={13} /></button>
        </div>
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', minHeight: 0, flex: 1 }}>{children}</div>
        <div className="flex justify-end gap-2" style={{ padding: '12px 18px', borderTop: '1px solid var(--color-divider)', flexShrink: 0 }}>
          <button className="vs-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="vs-btn vs-btn-primary relative"
            onClick={onSubmit}
            disabled={saving}
            aria-busy={saving}
          >
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            {saving ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Permanent erasure, behind a typed confirmation.
 *
 * Its own dialog rather than the shared ConfirmModal, for one reason: this is
 * the only action in the product that cannot be undone, and a single
 * destructive-looking button is not enough of a pause. Typing the address is
 * what makes it deliberate — and the address is the thing being freed, so it
 * is also the right thing to have read before confirming.
 *
 * The consequences are spelled out rather than summarised as "this cannot be
 * undone". An administrator can reasonably guess that deleting someone removes
 * the recognitions they RECEIVED; almost nobody guesses that it also removes
 * the ones they GAVE, out of other people's profiles.
 */
function DeleteEmployeeDialog({
  employee, onClose, onConfirm, deleting, error,
}: {
  employee: EmployeeRow
  onClose: () => void
  onConfirm: () => void
  deleting: boolean
  error: string | null
}) {
  const [typed, setTyped] = useState('')

  // Case and stray whitespace are not the point of the exercise.
  const confirmed = typed.trim().toLowerCase() === employee.email.trim().toLowerCase()

  // Portalled to <body>, like the form dialog above and ConfirmModal.
  return createPortal(
    <div
      className="vs-dialog-backdrop"
      {...dismissOnBackdrop(() => { if (!deleting) onClose() })}
    >
      <div
        className="vs-dialog animate-fade-in"
        style={{ minWidth: 420, maxWidth: 520 }}
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-employee-title"
      >
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />

        <div className="flex items-start justify-between" style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--color-divider)' }}>
          <div className="flex items-start gap-2">
            <AlertTriangle size={17} style={{ color: 'var(--color-accent-800)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
            <div>
              <h2 id="delete-employee-title" className="font-condensed" style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text)' }}>
                Delete {employee.full_name}?
              </h2>
              <p style={{ fontSize: 13, color: 'var(--color-neutral-600)', marginTop: 3 }}>
                {employee.email} ({employee.employee_id})
              </p>
            </div>
          </div>
          <button className="vs-btn-icon" style={{ width: 28, height: 28 }} onClick={onClose} disabled={deleting} aria-label="Close"><X size={13} /></button>
        </div>

        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.5 }}>
            This permanently erases this person and everything that refers to
            them. It cannot be undone.
          </p>

          <ul style={{ fontSize: 12.5, color: 'var(--color-neutral-700)', lineHeight: 1.6, paddingLeft: 18, listStyle: 'disc' }}>
            <li>Every recognition they <strong>received</strong>, and every one they <strong>gave</strong> — the ones they gave disappear from those colleagues&apos; profiles, and their badge counts are recalculated.</li>
            <li>Their badges, notifications, appreciations, support requests and project membership.</li>
            <li>Their sign-in account, so <strong>{employee.email}</strong> can be used again by a new employee.</li>
          </ul>

          <p style={{ fontSize: 12.5, color: 'var(--color-neutral-700)', lineHeight: 1.5 }}>
            Audit log entries are kept, without naming them as the actor.
            {' '}If this person has merely left the company,
            {' '}<strong>deactivate them instead</strong> — that keeps their history intact.
          </p>

          <FormField label={`Type ${employee.email} to confirm`} required>
            <input
              className="vs-input w-full"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder={employee.email}
              autoComplete="off"
              autoFocus
              disabled={deleting}
              aria-describedby="delete-employee-hint"
            />
          </FormField>
          <p id="delete-employee-hint" style={{ fontSize: 11, color: 'var(--color-neutral-600)', marginTop: -6 }}>
            The delete button stays disabled until the address matches.
          </p>

          {error && (
            <p role="alert" style={{ fontSize: 12.5, color: 'var(--color-accent-800)', lineHeight: 1.45 }}>
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2" style={{ padding: '12px 18px', borderTop: '1px solid var(--color-divider)' }}>
          <button className="vs-btn" onClick={onClose} disabled={deleting}>Cancel</button>
          <button
            className="vs-btn relative"
            style={{
              background: 'var(--color-accent-800)',
              color: 'var(--color-on-accent, var(--color-bg))',
              borderColor: 'var(--color-accent-800)',
            }}
            onClick={onConfirm}
            disabled={!confirmed || deleting}
            aria-busy={deleting}
          >
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            {deleting ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * The project column.
 *
 * Names, never ids, and the two relationships are labelled rather than merged:
 * a Manager RUNS a project (projects.manager_id) while everyone else BELONGS
 * to one (project_members). Showing "Project Alpha" for both would hide the
 * difference that decides who approves recognitions and whose Team Recognition
 * a person appears in.
 *
 * Both come from the directory query, so this costs no request of its own.
 */
function ProjectCell({ employee }: { employee: EmployeeRow }) {
  const { member, manager } = employee.projects

  if (member.length === 0 && manager.length === 0) {
    return <span style={{ color: 'var(--color-neutral-400)' }}>—</span>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {member.map(p => <span key={p.id}>{p.name}</span>)}
      {manager.map(p => (
        <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {p.name}
          <span
            className="vs-tag vs-tag-outline"
            style={{ fontSize: 10, padding: '0 5px' }}
            title="Project Manager for this project"
          >
            manages
          </span>
        </span>
      ))}
    </div>
  )
}

function FormField({ label, required, children, hint }: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-text)', marginBottom: 5 }}>
        {label}{required && <span aria-hidden="true" style={{ color: 'var(--color-accent-700)', marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {hint && <p style={{ fontSize: 11, color: 'var(--color-neutral-600)', marginTop: 4 }}>{hint}</p>}
    </div>
  )
}

/** What the send button is doing right now. */
type SendState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'queued' }              // Brevo accepted the request; not yet confirmed
  | { phase: 'sent' }                // provider returned 2xx
  | { phase: 'error'; message: string }

/**
 * Turn a status from send_employee_invitation() or
 * invitation_delivery_status() into something an HR user can act on.
 *
 * Never surfaces the provider's own text: migration 027 returns a category,
 * and Brevo's error bodies can name the account owner's address.
 */
function sendFailureMessage(status?: string, reason?: string): string {
  switch (status ?? reason) {
    case 'app_url_not_configured':
      return 'Automated email is not set up yet — the application address is missing. ' +
             'Copy the link below and send it yourself, and ask IT to finish the setup.'
    case 'email_not_configured':
      return 'Automated email is not configured on this workspace. Copy the link ' +
             'below and send it yourself.'
    case 'cooldown':
      return 'An invitation was just sent to this person. Wait a minute before resending.'
    case 'rate_limited':
      return 'This person has been sent a lot of invitations today. Try again tomorrow, ' +
             'or copy the link below and send it yourself.'
    case 'already_registered':
      return 'This person has already set up their account — no invitation is needed.'
    case 'inactive':
      return 'This employee record is not active, so no invitation was sent.'
    case 'forbidden':
      return 'You do not have permission to send invitations.'
    case 'not_found':
      return 'That employee record no longer exists. Refresh the page.'
    case 'provider_auth':
    case 'invalid_sender':
      return 'Automated email is misconfigured on this workspace. Copy the link below ' +
             'and send it yourself, and let IT know.'
    case 'recipient_not_allowed':
      return 'The email provider refused this recipient. Copy the link below and send ' +
             'it yourself.'
    case 'provider_rate_limited':
      return 'The email provider is rate limiting us. Try again shortly, or copy the ' +
             'link below.'
    case 'unreachable':
    case 'provider_error':
    default:
      return 'The invitation could not be emailed. Copy the link below and send it ' +
             'yourself — the link itself works.'
  }
}

/** How long to wait before asking whether the provider accepted the request. */
const DELIVERY_CHECK_DELAY_MS = 2500

/**
 * Invitation hand-off for a newly created employee record.
 *
 * The link points at the setup page for the role HR chose, pre-filled with
 * their address. It carries no secret and grants nothing: the stored employee
 * record is what authorises setup, and claim_employee_account() reads the role
 * from that record rather than from the URL.
 *
 * "Send invitation email" now really sends one, through
 * send_employee_invitation() (migration 027) -> Brevo. Copy link and the
 * mailto draft are kept as fallbacks, because they keep working when
 * automated delivery is unconfigured or the provider refuses.
 */
function InvitationDialog({
  invite,
  onClose,
}: {
  invite: { id: string; email: string; fullName: string; role: UserRole }
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [send, setSend] = useState<SendState>({ phase: 'idle' })

  // A mutation, so a successful send invalidates THIS person's delivery status
  // and nothing else — the directory has not changed.
  const sendMutation = useSendInvitation()

  // The dialog can be closed while a delivery check is in flight.
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const sendInvitation = async () => {
    setSend({ phase: 'sending' })

    try {
      await sendMutation.mutateAsync(invite.id)
    } catch (err) {
      // The API layer already maps every refusal to an actionable message.
      setSend({
        phase: 'error',
        message: err instanceof ApiError ? err.message : sendFailureMessage(),
      })
      return
    }

    // Accepted for delivery. pg_net is asynchronous, so this is honestly
    // "queued" and not "delivered" until the provider answers.
    setSend({ phase: 'queued' })

    setTimeout(async () => {
      if (!alive.current) return

      /*
        Deliberately NOT a useQuery. This is a one-shot check on a fixed delay,
        guarded by `alive` because the dialog can close first. Expressing it as
        a query with a refetch interval would turn a single deliberate probe
        into polling, which is a behaviour change, not a refactor.
      */
      const result = await employeesApi
        .invitationDeliveryStatus(invite.id)
        .catch(() => null)
      if (!alive.current) return

      if (result?.status === 'sent') setSend({ phase: 'sent' })
      else if (result?.status === 'failed') {
        setSend({ phase: 'error', message: sendFailureMessage(undefined, result.reason) })
      }
      // 'pending' or anything else: leave it at queued rather than guess.
    }, DELIVERY_CHECK_DELAY_MS)
  }

  // Send them to the entry experience for the role HR chose. The role travels
  // as the DESTINATION, never as a value in the URL — /manager/setup grants
  // nothing, and claim_employee_account() reads the role off their employee
  // record. Someone who edits this link to /hr/setup still gets whatever HR
  // stored, because the database never looks at the address bar.
  const setupPath =
    invite.role === 'hr_admin' ? ROUTES.HR_SETUP
    : invite.role === 'manager' ? ROUTES.MANAGER_SETUP
    : ROUTES.SIGNUP

  const link = `${window.location.origin}${setupPath}?email=${encodeURIComponent(invite.email)}`

  const subject = 'Your Touchcore ValueSpot account'
  const body =
    `Hi ${invite.fullName},\n\n` +
    `You've been added to Touchcore ValueSpot, our employee recognition platform ` +
    `— as ${roleLabel(invite.role)}.\n\n` +
    `Set up your account here:\n${link}\n\n` +
    `Sign up with this email address (${invite.email}) and your full name as it appears ` +
    `on your employee record, then choose your own password.\n\n` +
    `— Touchcore HR`

  const mailto = `mailto:${encodeURIComponent(invite.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  // Portalled to <body>, like the form dialog above and ConfirmModal.
  return createPortal(
    <div
      className="vs-dialog-backdrop"
      {...dismissOnBackdrop(() => onClose())}
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-title"
    >
      <div className="vs-dialog animate-fade-in" style={{ minWidth: 420, maxWidth: 520 }}>
        <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--color-divider)' }}>
          <h2 id="invite-title" className="font-condensed" style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text)' }}>
            Invite {invite.fullName}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--color-neutral-600)', marginTop: 4, lineHeight: 1.5 }}>
            Their record is ready as <strong>{roleLabel(invite.role)}</strong>. Send
            them this link to set up their account — that role applies from their
            first sign-in.
          </p>
        </div>

        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <p className="vs-kicker" style={{ marginBottom: 6 }}>Invitation link</p>
            <div className="flex gap-2">
              <input
                className="vs-input"
                style={{ flex: 1, fontSize: 12, fontFamily: 'IBM Plex Mono, monospace' }}
                value={link}
                readOnly
                onFocus={e => e.currentTarget.select()}
                aria-label="Invitation link"
              />
              <button
                className="vs-btn"
                onClick={copyLink}
                style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
              >
                {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', lineHeight: 1.55 }}>
            Only someone whose email matches an active employee record can complete
            sign-up, and they must confirm the address from their inbox.
          </p>
        </div>

        {(send.phase === 'queued' || send.phase === 'sent' || send.phase === 'error') && (
          <div
            role="status"
            style={{
              margin: '0 18px 4px',
              padding: '9px 11px',
              fontSize: 13,
              lineHeight: 1.5,
              border: '1px solid var(--color-divider)',
              color: send.phase === 'error' ? 'var(--color-accent-800)' : 'var(--color-text)',
              background: send.phase === 'error'
                ? 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg))'
                : 'var(--color-surface-2, var(--color-bg))',
            }}
          >
            {/*
              "queued" and "sent" are different claims and are worded as such.
              pg_net hands the request off asynchronously, so until the provider
              answers, the honest word is queued — never "delivered", which this
              system cannot verify at all.
            */}
            {send.phase === 'sent'   && <>Invitation email sent to {invite.email}.</>}
            {send.phase === 'queued' && <>Invitation email queued for {invite.email}.</>}
            {send.phase === 'error'  && send.message}
          </div>
        )}

        <div className="flex justify-end gap-2" style={{ padding: '12px 18px', borderTop: '1px solid var(--color-divider)' }}>
          <button className="vs-btn" onClick={onClose}>Done</button>

          {/* Fallback, kept deliberately: it works when automated delivery does not. */}
          <a
            className="vs-btn"
            href={mailto}
            style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
          >
            <Mail size={13} aria-hidden="true" /> Send it myself
          </a>

          <button
            className="vs-btn vs-btn-primary relative"
            onClick={sendInvitation}
            disabled={send.phase === 'sending'}
            aria-busy={send.phase === 'sending'}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <Mail size={13} aria-hidden="true" />
            {send.phase === 'sending' ? 'Sending…'
              : send.phase === 'sent' || send.phase === 'queued' ? 'Send again'
              : 'Send invitation email'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default function EmployeesPage() {
  const [query, setQuery]             = useState('')
  const [editTarget, setEditTarget]   = useState<Employee | null>(null)
  const [showForm, setShowForm]       = useState(false)
  const [confirmToggle, setConfirmToggle] = useState<Employee | null>(null)
  // Deactivation can legitimately be refused — guard_last_admin_active
  // (migration 016) will not let the last Super Admin be switched off — so the
  // outcome has to be shown rather than assumed.
  const [toggleError, setToggleError] = useState<string | null>(null)

  // Permanent erasure. Separate from confirmToggle because the two are
  // different acts with different consequences, and sharing state between them
  // is how a mis-click becomes an irreversible one.
  const [confirmDelete, setConfirmDelete] = useState<EmployeeRow | null>(null)
  const [deleteError, setDeleteError]     = useState<string | null>(null)
  // Survives the dialog closing: the outcome is worth reading afterwards, and
  // an auth warning means somebody has manual work to do.
  const [deleteNotice, setDeleteNotice]   = useState<string | null>(null)

  /*
    The directory is debounced locally and then cached by search term, so
    backspacing to a term you already typed is served from memory instead of
    refetching. `placeholderData` keeps the previous rows visible while the
    next query resolves, which removes the blank-table flicker.

    Departments and managers are reference data on a five-minute stale time and
    share their keys with every other consumer, so opening the dialog twice is
    one request, not two.
  */
  const debouncedQuery = useDebounce(query, SEARCH_DEBOUNCE_MS)
  const directory = useEmployeeDirectory({ search: debouncedQuery, pageSize: 50 })

  const employees: EmployeeRow[] = directory.data?.rows ?? []
  const loading = directory.isPending

  const departments = (useDepartments().data ?? []) as Department[]
  // Active projects only: an archived one cannot receive recognitions.
  const projects = useProjects().data ?? []

  const createEmployee = useCreateEmployee()
  const updateProfile = useUpdateEmployeeProfile()
  const setRole = useSetEmployeeRole()
  const setActive = useSetEmployeeActive()
  const setEmployeeProject = useSetEmployeeProject()
  const deleteMutation = useDeleteEmployee()

  // One flag for the dialog, whichever mutation is in flight.
  const saving = createEmployee.isPending || updateProfile.isPending
    || setRole.isPending || setEmployeeProject.isPending
  const toggling = setActive.isPending

  const [formError, setFormError]     = useState<string | null>(null)
  // Set after an employee record is created (or when HR re-sends), so the
  // invitation panel can offer the link for that person.
  const [invite, setInvite]           = useState<{ id: string; email: string; fullName: string; role: UserRole } | null>(null)

  // Super Admin is deliberately absent from the dropdown below. Granting full
  // control of the system is a different kind of act from correcting someone's
  // department, and it should not be one mis-click away from it — it lives in
  // Administration -> Administrators instead. Since migration 026 the database
  // refuses it here either way, for HR Admins and over the REST API alike;
  // this only decides what to offer.
  const { role: myRole, employee: me } = useAuth()
  const isSuperAdmin = myRole === 'super_admin'

  /**
   * Whether to offer permanent deletion for this row.
   *
   * The UI half of the boundary purge_employee() enforces (035). The database
   * is the authority — this only decides what to put on screen, so that the
   * button is absent where it could only ever be refused.
   */
  const canDelete = (emp: EmployeeRow): boolean => {
    if (me && emp.id === me.id) return false
    if (isSuperAdmin) return true
    return emp.role !== 'hr_admin' && emp.role !== 'super_admin'
  }

  const { register, handleSubmit, reset, setValue, setError, formState: { errors } } = useForm<EmployeeForm>({
    resolver: zodResolver(employeeSchema),
    defaultValues: { role: 'employee' },
  })

  const openAdd = () => {
    setEditTarget(null)
    setFormError(null)
    reset({ role: 'employee' })
    setShowForm(true)
  }
  /*
    The employee's current project is not on the employee row — it lives in
    project_members — so it arrives after the dialog opens and is written into
    the form when it does. `currentProjectId` is also what tells onSave whether
    the assignment actually changed.
  */
  const currentProjectQuery = useEmployeeProject(editTarget?.id)
  const currentProjectId = currentProjectQuery.data?.project_id ?? null

  useEffect(() => {
    if (editTarget) setValue('project_id', currentProjectId ?? '')
  }, [editTarget, currentProjectId, setValue])

  const openEdit = (e: Employee) => {
    setEditTarget(e)
    setFormError(null)
    reset({
      full_name: e.full_name,
      email: e.email,
      employee_code: e.employee_id,
      // Kept as-is for a super admin, so saving an unrelated field (department,
      // manager) never quietly strips their administrator access.
      role: e.role,
      designation: e.designation ?? '',
      department_id: e.department_id ?? undefined,
    })
    setShowForm(true)
  }

  const onSave = async (data: EmployeeForm) => {
    setFormError(null)

    if (editTarget) {
      const code = (data.employee_code ?? '').trim().toUpperCase()
      if (!code) {
        setError('employee_code', { message: 'Employee ID is required' })
        return
      }

      // Everything except the role is an ordinary update. The role goes through
      // set_employee_role(), which is the only path a trigger will accept — a
      // direct write of `role` is rejected by the database.
      try {
        await updateProfile.mutateAsync({
          id: editTarget.id,
          fullName: data.full_name,
          designation: data.designation ?? '',
          departmentId: data.department_id || null,
          // Only sent when changed, so an untouched ID is never rewritten.
          ...(code !== editTarget.employee_id ? { employeeCode: code } : {}),
        })
      } catch (err) {
        if (err instanceof ApiError && err.code === 'duplicate') {
          setError('employee_code', { message: err.message })
        } else {
          setFormError('Could not save those changes. Please try again.')
        }
        return
      }

      /*
        The project assignment is a separate write, because it lives in
        project_members rather than on the employee row. Only sent when it
        actually changed — reassigning to the same project would stand the
        current membership down and start a new one for no reason.
      */
      const nextProjectId = data.project_id || null
      if (nextProjectId !== currentProjectId) {
        try {
          await setEmployeeProject.mutateAsync({
            employeeId: editTarget.id,
            projectId: nextProjectId,
          })
        } catch (err) {
          setFormError(
            err instanceof ApiError
              ? err.message
              : 'Saved the profile, but could not update the project assignment.',
          )
          return
        }
      }

      if (data.role !== editTarget.role) {
        // setRole maps every refusal the database can return — forbidden,
        // last_admin, not_found — to a message, so there is nothing to
        // re-interpret here.
        try {
          await setRole.mutateAsync({ employeeId: editTarget.id, role: data.role as UserRole })
        } catch (err) {
          setFormError(
            err instanceof ApiError && err.code === 'last_admin'
              ? 'This is the only Super Admin. Make someone else a Super Admin first, ' +
                'then change this one — otherwise nobody could administer the system.'
              : err instanceof ApiError
                ? err.message
                : 'Could not change the role. Please try again.',
          )
          return
        }
      }
    } else {
      const email = data.email.trim().toLowerCase()
      // The id comes back so the invitation dialog can send the email straight
      // away — send_employee_invitation() takes the employee id and nothing else.
      let created: { id: string }
      try {
        created = await createEmployee.mutateAsync({
          fullName: data.full_name,
          email,
          role: data.role as UserRole,
          designation: data.designation || null,
          departmentId: data.department_id || null,
        })
      } catch (err) {
        // 'forbidden' carries migration 026's own wording — an HR Admin
        // reaching for Super Admin, or an unverified session — which says more
        // than anything generic could.
        setFormError(
          err instanceof ApiError && err.code === 'duplicate'
            ? 'An employee with that email address already exists.'
            : err instanceof ApiError && err.code === 'forbidden'
              ? err.message
              : 'Could not create that employee. Please try again.',
        )
        return
      }

      /*
        Assign the project if one was chosen. Deliberately after creation and
        non-fatal: the employee record exists and the invitation should still
        go out, so a failure here is reported rather than discarding the
        account that was just created.
      */
      if (data.project_id) {
        try {
          await setEmployeeProject.mutateAsync({
            employeeId: created.id,
            projectId: data.project_id,
          })
        } catch {
          setFormError(
            'The employee was created, but their project could not be assigned. ' +
            'Set it from the Edit dialog.',
          )
        }
      }

      // The record now exists at the role chosen above, so this person is
      // eligible to register and will hold that role from their first sign-in.
      setInvite({
        id: created.id,
        email,
        fullName: data.full_name.trim(),
        role: data.role as UserRole,
      })
    }

    setShowForm(false)
  }

  const deleteEmployee = async () => {
    if (!confirmDelete) return

    setDeleteError(null)

    try {
      const result = await deleteMutation.mutateAsync(confirmDelete.id)

      setConfirmDelete(null)

      /*
        The warning matters more than the success. If the employee record went
        but the sign-in account did not, the address is still occupied — and an
        administrator who is not told that will try to re-invite the person and
        be refused with no visible reason.
      */
      setDeleteNotice(
        result.auth_warning
          ?? `${result.full_name} was deleted. ${result.email} is free to use again.`,
      )
    } catch (err) {
      // Same reasoning as toggleActive: the dialog stays open and says why.
      // The refusals worth reading — the last administrator, an HR Admin
      // reaching for a Super Admin — arrive as ApiError with the server's text.
      setDeleteError(
        err instanceof ApiError
          ? err.message
          : 'Could not delete that employee. Please try again.',
      )
    }
  }

  const toggleActive = async () => {
    if (!confirmToggle) return

    setToggleError(null)

    try {
      await setActive.mutateAsync({ id: confirmToggle.id, isActive: !confirmToggle.is_active })
    } catch (err) {
      /*
        Leave the dialog open and say what happened. Closing it and refreshing
        would show the employee unchanged with no explanation, which reads as
        the click having done nothing rather than having been refused.

        ApiError carries the database's own message for 42501, and for this
        operation that is guard_last_admin_active explaining that the system
        will not leave itself without an administrator — far more useful than
        anything generic.
      */
      setToggleError(
        err instanceof ApiError
          ? err.message
          : 'Could not update that employee. Please try again.',
      )
      return
    }

    setConfirmToggle(null)
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        kicker="HR Manage"
        title="Employees"
        subtitle="Manage team members, roles, departments and managers."
        actions={
          <button className="vs-btn vs-btn-primary relative" onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <Plus size={13} aria-hidden="true" /> Invite Employee
          </button>
        }
      />

      {/*
        The outcome of an erasure, kept until dismissed. A deletion removes the
        row from the table, so without this the only evidence that anything
        happened is an absence — and an auth warning would go unread.
      */}
      {deleteNotice && (
        <div
          role="status"
          className="vs-card flex items-start justify-between gap-3"
          style={{ padding: '10px 12px', borderColor: 'var(--color-accent-800)' }}
        >
          <p style={{ fontSize: 12.5, color: 'var(--color-text)', lineHeight: 1.45 }}>{deleteNotice}</p>
          <button className="vs-btn-icon" style={{ width: 24, height: 24, flexShrink: 0 }} onClick={() => setDeleteNotice(null)} aria-label="Dismiss">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Search */}
      <div className="relative" style={{ maxWidth: 320 }}>
        <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-neutral-500)', pointerEvents: 'none' }} aria-hidden="true" />
        <input
          type="search"
          className="vs-input w-full"
          style={{ paddingLeft: 28, height: 32, fontSize: 13 }}
          placeholder="Search by name, email or ID…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="Search employees"
        />
      </div>

      {loading ? <TableSkeleton /> : employees.length === 0 ? (
        <EmptyState
          icon={<Users size={36} />}
          title={query.length >= 2 ? 'No employees found' : 'No employees yet'}
          description={query.length >= 2 ? `No results for "${query}".` : 'Invite your first team member to get started.'}
          action={query.length < 2 ? { label: 'Invite Employee', onClick: openAdd } : undefined}
        />
      ) : (
        <div className="vs-card" style={{ overflow: 'hidden' }}>
          <div className="overflow-x-auto">
            <table className="vs-table w-full" style={{ minWidth: 600 }}>
              <thead>
                <tr style={{ background: 'color-mix(in srgb, var(--color-neutral-300) 30%, transparent)' }}>
                  <th>Employee</th>
                  <th className="hidden md:table-cell">Designation</th>
                  <th className="hidden md:table-cell">ID</th>
                  <th className="hidden lg:table-cell">Department</th>
                  <th className="hidden lg:table-cell">Project</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Account</th>
                  <th style={{ width: 60 }} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => (
                  <tr key={emp.id}>
                    <td>
                      <EmployeeAvatar
                        name={emp.full_name}
                        avatarUrl={emp.avatar_url}
                        size="sm"
                        showName
                        /* Two people can share a name — the address is what tells them apart. */
                        subtitle={emp.email}
                      />
                    </td>
                    <td className="hidden md:table-cell" style={{ color: 'var(--color-neutral-700)' }}>
                      {emp.designation ?? <span style={{ color: 'var(--color-neutral-400)' }}>—</span>}
                    </td>
                    <td className="hidden md:table-cell"><code style={{ fontSize: 11, color: 'var(--color-neutral-600)', fontFamily: 'IBM Plex Mono, monospace' }}>{emp.employee_id}</code></td>
                    <td className="hidden lg:table-cell" style={{ color: 'var(--color-neutral-700)' }}>
                      {(emp.department as { name: string } | null)?.name ?? <span style={{ color: 'var(--color-neutral-400)' }}>—</span>}
                    </td>
                    <td className="hidden lg:table-cell" style={{ color: 'var(--color-neutral-700)' }}>
                      <ProjectCell employee={emp} />
                    </td>
                    <td><span className="vs-tag vs-tag-neutral" style={{ textTransform: 'capitalize' }}>{emp.role.replace('_', ' ')}</span></td>
                    <td><span className={`vs-tag ${emp.is_active ? 'vs-tag-accent' : 'vs-tag-neutral'}`}>{emp.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td>
                      <span className={`vs-tag ${emp.auth_user_id ? 'vs-tag-accent' : 'vs-tag-outline'}`}>
                        {emp.auth_user_id ? 'Registered' : 'Invited'}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        {!emp.auth_user_id && emp.is_active && (
                          <button
                            className="vs-btn-icon"
                            style={{ width: 28, height: 28 }}
                            onClick={() => setInvite({ id: emp.id, email: emp.email, fullName: emp.full_name, role: emp.role })}
                            aria-label={`Resend invitation to ${emp.full_name}`}
                            title="Resend invitation"
                          >
                            <Mail size={12} />
                          </button>
                        )}
                        <button className="vs-btn-icon" style={{ width: 28, height: 28 }} onClick={() => openEdit(emp)} aria-label={`Edit ${emp.full_name}`}><Edit2 size={12} /></button>
                        <button className="vs-btn-icon" style={{ width: 28, height: 28 }} onClick={() => { setToggleError(null); setConfirmToggle(emp) }} aria-label={emp.is_active ? `Deactivate ${emp.full_name}` : `Activate ${emp.full_name}`}>
                          {emp.is_active ? <UserX size={12} /> : <UserCheck size={12} />}
                        </button>
                        {/*
                          Hidden rather than disabled where it would be refused
                          anyway: nobody may erase themselves, and an HR Admin
                          may not erase an administrator (migration 035 mirrors
                          set_employee_role's boundary). A button that always
                          fails is worse than no button.
                        */}
                        {canDelete(emp) && (
                          <button
                            className="vs-btn-icon"
                            style={{ width: 28, height: 28, color: 'var(--color-accent-800)' }}
                            onClick={() => { setDeleteError(null); setDeleteNotice(null); setConfirmDelete(emp) }}
                            aria-label={`Delete ${emp.full_name} permanently`}
                            title="Delete permanently"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <FormDialog
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editTarget ? 'Edit Employee' : 'Invite Employee'}
        description={editTarget
          // The address is named here because the email field itself is hidden
          // when editing, and a name alone does not identify the record.
          ? `Update the profile details for ${editTarget.email} (${editTarget.employee_id}).`
          : 'Create their record at the role they should hold, then send them an ' +
            'invitation to set up their account.'}
        onSubmit={handleSubmit(onSave)}
        saving={saving}
        submitLabel={editTarget ? 'Save changes' : 'Create & invite'}
      >
        {formError && (
          <p role="alert" style={{ fontSize: 13, color: 'var(--color-accent-800)', marginBottom: 4 }}>
            {formError}
          </p>
        )}
        <FormField label="Full Name" required>
          <input id="emp-name" className="vs-input w-full" placeholder="e.g. Priya Patel" {...register('full_name')} />
          {errors.full_name && <p style={{ fontSize: 12, color: 'var(--color-accent-800)', marginTop: 4 }}>{errors.full_name.message}</p>}
        </FormField>
        {editTarget && (
          <FormField label="Employee ID" required>
            <input
              id="emp-code"
              className="vs-input w-full"
              placeholder="e.g. TC004"
              autoComplete="off"
              style={{ fontFamily: 'IBM Plex Mono, ui-monospace, monospace', textTransform: 'uppercase' }}
              {...register('employee_code')}
            />
            {errors.employee_code
              ? <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-800)', marginTop: 4 }}>{errors.employee_code.message}</p>
              : <p style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginTop: 4 }}>
                  Must be unique. Saved in capitals.
                </p>}
          </FormField>
        )}
        {!editTarget && (
          <FormField label="Company email address" required>
            <input id="emp-email" type="email" className="vs-input w-full" placeholder="priya@touchcoresystems.com" {...register('email')} />
            {errors.email
              ? <p style={{ fontSize: 12, color: 'var(--color-accent-800)', marginTop: 4 }}>{errors.email.message}</p>
              : <p style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginTop: 4 }}>
                  They&rsquo;ll be invited to register with this address. A Company ID is assigned automatically.
                </p>}
          </FormField>
        )}
        <FormField label="Role" required>
          <select id="emp-role" className={SEL} {...register('role')}>
            <option value="employee">Employee</option>
            <option value="manager">Manager</option>
            {/*
              Offered when creating, because 026 lets an HR Admin create an
              HR Admin outright — that is the intended workflow and needs no
              Super Admin. Withheld when editing, because raising an EXISTING
              record to HR Admin still goes through set_employee_role(), which
              only a Super Admin may do. Offering it there produced a dropdown
              that saved with a permission error.
            */}
            {(!editTarget || isSuperAdmin) && <option value="hr_admin">HR</option>}
            {/*
              Never offered — only kept so editing a Super Admin's department
              round-trips their role instead of silently reading as Employee.
              Super Admin is granted in Administration, never from this form.
            */}
            {editTarget?.role === 'super_admin' && <option value="super_admin">Super Admin</option>}
          </select>
          {editTarget?.role === 'super_admin' ? (
            <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 4, lineHeight: 1.5 }}>
              This person is a Super Admin. Administrator access is managed in
              Administration &rarr; Administrators, not here.
            </p>
          ) : editTarget ? (
            <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 4, lineHeight: 1.5 }}>
              {isSuperAdmin
                ? 'Super Admin is granted in Administration → Administrators.'
                : 'HR Admin and Super Admin access is granted by a Super Admin in Administration.'}
            </p>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 4, lineHeight: 1.5 }}>
              Select the role this person will have when they complete their
              account setup. It is stored on their record now and applies from
              their first sign-in &mdash; nothing further is needed.
            </p>
          )}
        </FormField>
        <FormField label="Designation">
          <input
            id="emp-designation"
            className="vs-input w-full"
            placeholder="e.g. Software Engineer, QA Engineer"
            maxLength={80}
            {...register('designation')}
          />
          {errors.designation
            ? <p style={{ fontSize: 12, color: 'var(--color-accent-800)', marginTop: 4 }}>{errors.designation.message}</p>
            : <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 4, lineHeight: 1.45 }}>
                Their job title. It grants no access — that is the Role above. Employees can also set it on their own profile.
              </p>}
        </FormField>
        <FormField label="Department">
          <select id="emp-dept" className={SEL} {...register('department_id')}>
            <option value="">No department</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </FormField>
        <FormField label="Active project">
          <select id="emp-project" className={SEL} {...register('project_id')}>
            <option value="">No project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 5, lineHeight: 1.45 }}>
            One project at a time. Its Project Manager approves the recognitions
            this person receives — without one, colleagues cannot recognise them.
          </p>
        </FormField>
      </FormDialog>

      {invite && (
        <InvitationDialog invite={invite} onClose={() => setInvite(null)} />
      )}

      {confirmDelete && (
        <DeleteEmployeeDialog
          employee={confirmDelete}
          onClose={() => { setConfirmDelete(null); setDeleteError(null) }}
          onConfirm={deleteEmployee}
          deleting={deleteMutation.isPending}
          error={deleteError}
        />
      )}

      <ConfirmModal
        open={!!confirmToggle}
        onOpenChange={() => { setConfirmToggle(null); setToggleError(null) }}
        title={confirmToggle?.is_active ? `Deactivate ${confirmToggle?.full_name}?` : `Activate ${confirmToggle?.full_name}?`}
        description={
          toggleError
            ?? (confirmToggle
              ? `${confirmToggle.email} (${confirmToggle.employee_id}) — ` +
                (confirmToggle.is_active
                  ? 'this employee will no longer be able to log in or receive nominations.'
                  : 'this employee will be able to log in and receive nominations again.')
              : undefined)
        }
        confirmLabel={confirmToggle?.is_active ? 'Deactivate' : 'Activate'}
        variant={confirmToggle?.is_active ? 'destructive' : 'default'}
        onConfirm={toggleActive}
        loading={toggling}
      />
    </div>
  )
}
