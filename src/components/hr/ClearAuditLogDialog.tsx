import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Check, Copy, X } from 'lucide-react'
import { dismissOnBackdrop } from '@/lib/backdrop'

/** A fresh eight-digit code, from the browser's cryptographic generator. */
function newCode(): string {
  const [n] = crypto.getRandomValues(new Uint32Array(1))
  return String(n % 100_000_000).padStart(8, '0')
}

/**
 * Clearing the audit log, behind a typed code.
 *
 * Modelled on the delete-employee dialog: one destructive button is not
 * enough of a pause for something that cannot be undone, so the button stays
 * disabled until the code shown here is typed or pasted back. The code is new
 * each time the dialog opens, so it cannot be learned and typed on reflex.
 *
 * It guards against a misclick, not against a person: the authority is the
 * Super Admin role, which clear_audit_log() (055) checks for itself.
 */
export function ClearAuditLogDialog({
  onClose, onConfirm, clearing, error,
}: {
  onClose: () => void
  onConfirm: () => void
  clearing: boolean
  error: string | null
}) {
  // Created once per opening — the dialog is unmounted when it closes.
  const [code] = useState(newCode)
  const [typed, setTyped] = useState('')
  const [copied, setCopied] = useState(false)

  // Only the digits count, so a pasted code with a stray space still matches.
  const confirmed = typed.replace(/\D/g, '') === code

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard refused (permissions, insecure context): typing still works.
    }
  }

  // Portalled to <body>, like ConfirmModal, so no ancestor can re-anchor it.
  return createPortal(
    <div
      className="vs-dialog-backdrop"
      {...dismissOnBackdrop(() => { if (!clearing) onClose() })}
    >
      <div
        className="vs-dialog animate-fade-in"
        style={{ minWidth: 420, maxWidth: 520 }}
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="clear-audit-title"
      >
        <div className="flex items-start justify-between" style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--color-divider)' }}>
          <div className="flex items-start gap-2">
            <AlertTriangle size={17} style={{ color: 'var(--color-accent-800)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
            <h2 id="clear-audit-title" className="font-condensed" style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text)' }}>
              Clear the audit log?
            </h2>
          </div>
          <button className="vs-btn-icon" style={{ width: 28, height: 28 }} onClick={onClose} disabled={clearing} aria-label="Close"><X size={13} /></button>
        </div>

        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.5 }}>
            This permanently deletes <strong>every entry</strong> in the audit log — sign-ins,
            approvals, role changes, everything. It cannot be undone.
          </p>
          <p style={{ fontSize: 12.5, color: 'var(--color-neutral-700)', lineHeight: 1.5 }}>
            One new entry will record that you cleared it, and how many entries were removed.
          </p>

          <div>
            <p id="clear-audit-code-label" style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', marginBottom: 6 }}>
              Type or paste this code to confirm
            </p>
            <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
              <code
                aria-label={`Confirmation code ${code.split('').join(' ')}`}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: 'color-mix(in srgb, var(--color-neutral-300) 30%, transparent)',
                  fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
                  fontSize: 22,
                  fontWeight: 600,
                  letterSpacing: '0.28em',
                  color: 'var(--color-text)',
                  textAlign: 'center',
                  userSelect: 'all',
                }}
              >
                {code}
              </code>
              <button
                type="button"
                className="vs-btn"
                onClick={copy}
                disabled={clearing}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
              >
                {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <input
              className="vs-input w-full"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder="8-digit code"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              disabled={clearing}
              aria-labelledby="clear-audit-code-label"
              aria-describedby="clear-audit-hint"
              style={{ fontFamily: 'IBM Plex Mono, ui-monospace, monospace', letterSpacing: '0.12em' }}
            />
            <p id="clear-audit-hint" style={{ fontSize: 11, color: 'var(--color-neutral-600)', marginTop: 5 }}>
              The clear button stays disabled until the code matches.
            </p>
          </div>

          {error && (
            <p role="alert" style={{ fontSize: 12.5, color: 'var(--color-accent-800)', lineHeight: 1.45 }}>
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2" style={{ padding: '12px 18px', borderTop: '1px solid var(--color-divider)' }}>
          <button className="vs-btn" onClick={onClose} disabled={clearing}>Cancel</button>
          <button
            className="vs-btn"
            style={{
              background: 'var(--color-accent-800)',
              color: 'var(--color-on-accent, var(--color-bg))',
              borderColor: 'var(--color-accent-800)',
            }}
            onClick={onConfirm}
            disabled={!confirmed || clearing}
            aria-busy={clearing}
          >
            {clearing ? 'Clearing…' : 'Clear audit log'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
