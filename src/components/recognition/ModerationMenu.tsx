import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import { ConfirmModal } from '@/components/shared/ConfirmModal'
import { useAuth } from '@/context/AuthContext'
import { useCoreValues, useBehaviours, useEditRecognition, useRemoveRecognition } from '@/hooks/queries'
import { ApiError, type RecognitionCorrection } from '@/lib/api'
import type { RecognitionFeedItem } from '@/types'
import { dismissOnBackdrop } from '@/lib/backdrop'

/**
 * Moderation actions on a recognition card, for HR and Super Admin.
 *
 * The role test below decides whether to RENDER this, nothing more. Both
 * actions call SECURITY DEFINER functions that re-read the caller's role from
 * `employees` and refuse anyone who is not HR or a Super Admin — so an
 * employee who calls the RPC directly is refused by PostgreSQL, and hiding the
 * menu is only about not offering what someone cannot do.
 *
 * Kept visually quiet on purpose: an overflow button, not a toolbar. Reading
 * the feed is the point of the feed; moderating it is the exception.
 */
export function ModerationMenu({ item }: { item: RecognitionFeedItem }) {
  const { role } = useAuth()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const wrap = useRef<HTMLDivElement>(null)

  const removeRecognition = useRemoveRecognition()

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  if (role !== 'hr_admin' && role !== 'super_admin') return null

  const remove = async () => {
    setRemoveError(null)
    try {
      await removeRecognition.mutateAsync({
        nominationId: item.id!,
        reason: reason.trim() || undefined,
      })
    } catch (err) {
      setRemoveError(err instanceof ApiError ? err.message : 'Could not remove that recognition.')
      return
    }
    setConfirmRemove(false)
    setReason('')
  }

  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        className="vs-btn-icon"
        style={{ width: 26, height: 26 }}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Moderate this recognition"
        title="Moderate"
      >
        <MoreHorizontal size={14} />
      </button>

      {open && (
        <div
          role="menu"
          className="vs-card"
          style={{
            position: 'absolute', right: 0, top: 30, zIndex: 30, minWidth: 190,
            background: 'var(--color-surface)', padding: 4,
          }}
        >
          <button
            role="menuitem"
            className="flex items-center gap-2 w-full"
            style={{
              padding: '7px 10px', fontSize: 13, background: 'none', border: 'none',
              cursor: 'pointer', color: 'var(--color-text)', textAlign: 'left',
            }}
            onClick={() => { setOpen(false); setEditing(true) }}
          >
            <Pencil size={13} aria-hidden="true" /> Edit recognition
          </button>
          <button
            role="menuitem"
            className="flex items-center gap-2 w-full"
            style={{
              padding: '7px 10px', fontSize: 13, background: 'none', border: 'none',
              cursor: 'pointer', color: 'var(--color-accent-800)', textAlign: 'left',
            }}
            onClick={() => { setOpen(false); setRemoveError(null); setConfirmRemove(true) }}
          >
            <Trash2 size={13} aria-hidden="true" /> Delete recognition
          </button>
        </div>
      )}

      {editing && <EditRecognitionDialog item={item} onClose={() => setEditing(false)} />}

      <ConfirmModal
        open={confirmRemove}
        onOpenChange={() => { setConfirmRemove(false); setRemoveError(null) }}
        title="Delete Recognition?"
        description={
          removeError
            ?? 'This recognition will be removed from the Recognition Feed and will stop counting ' +
               'towards analytics and badges. The record is kept for audit and can be traced to you.'
        }
        confirmLabel="Delete Recognition"
        variant="destructive"
        onConfirm={remove}
        loading={removeRecognition.isPending}
      />
    </div>
  )
}

/**
 * Correct a recognition.
 *
 * Shows the CURRENT value against the new one for the two fields most often
 * got wrong, because "Accountability → Collaboration" is the sentence the
 * moderator is trying to write and they should be able to read it back before
 * saving.
 *
 * The participants, timestamps and approval are not on this form and are not
 * parameters of the RPC behind it. Content is editable; who did what is not.
 */
function EditRecognitionDialog({
  item,
  onClose,
}: {
  item: RecognitionFeedItem
  onClose: () => void
}) {
  const edit = useEditRecognition()

  const [coreValueId, setCoreValueId] = useState(item.core_value_id ?? '')
  const [behaviourId, setBehaviourId] = useState('')
  const [whatHappened, setWhatHappened] = useState(item.what_happened ?? '')
  const [whatImpact, setWhatImpact] = useState(item.what_impact ?? '')
  const [error, setError] = useState<string | null>(null)
  const [touchedBehaviour, setTouchedBehaviour] = useState(false)

  const coreValues = useCoreValues(true)
  const behaviours = useBehaviours(coreValueId || undefined, true)

  const coreValueChanged = coreValueId !== (item.core_value_id ?? '')
  const storyChanged = whatHappened !== (item.what_happened ?? '')
  const impactChanged = whatImpact !== (item.what_impact ?? '')
  const anyChange = coreValueChanged || touchedBehaviour || storyChanged || impactChanged

  const save = async () => {
    setError(null)

    const correction: RecognitionCorrection = {}
    if (coreValueChanged) correction.coreValueId = coreValueId
    if (touchedBehaviour) correction.behaviourId = behaviourId || null
    if (storyChanged) correction.whatHappened = whatHappened
    if (impactChanged) correction.whatImpact = whatImpact

    try {
      await edit.mutateAsync({ nominationId: item.id!, correction })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that correction.')
      return
    }
    onClose()
  }

  return createPortal(
    <div
      className="vs-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-rec-title"
      {...dismissOnBackdrop(() => { if (!edit.isPending) onClose() })}
    >
      <div className="vs-dialog animate-fade-in" style={{ minWidth: 440, maxWidth: 580, maxHeight: '90vh', overflowY: 'auto' }}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />

        <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--color-divider)' }}>
          <p className="vs-kicker" style={{ marginBottom: 4 }}>Moderation</p>
          <h2 id="edit-rec-title" className="font-condensed" style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text)' }}>
            Edit Recognition
          </h2>
          <p style={{ fontSize: 13, color: 'var(--color-neutral-600)', marginTop: 3 }}>
            {item.nominator_name} recognised {item.nominee_name}. The people and the approval are
            unchanged by an edit.
          </p>
        </div>

        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label htmlFor="er-core-value" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
              Core Value
            </label>
            <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginBottom: 5 }}>
              Current: {item.core_value_name}
            </p>
            <select
              id="er-core-value"
              className="vs-input w-full"
              value={coreValueId}
              onChange={e => { setCoreValueId(e.target.value); setBehaviourId(''); setTouchedBehaviour(true) }}
            >
              {coreValues.data?.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="er-behaviour" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
              Behaviour
            </label>
            <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginBottom: 5 }}>
              Current: {item.behaviour_name ?? 'None'}
            </p>
            <select
              id="er-behaviour"
              className="vs-input w-full"
              value={behaviourId}
              onChange={e => { setBehaviourId(e.target.value); setTouchedBehaviour(true) }}
            >
              <option value="">No behaviour</option>
              {behaviours.data?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="er-story" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
              What happened
            </label>
            <textarea
              id="er-story"
              className="vs-input w-full"
              style={{ minHeight: 80 }}
              value={whatHappened}
              onChange={e => setWhatHappened(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="er-impact" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
              Impact
            </label>
            <textarea
              id="er-impact"
              className="vs-input w-full"
              style={{ minHeight: 64 }}
              value={whatImpact}
              onChange={e => setWhatImpact(e.target.value)}
            />
          </div>

          {error && <p role="alert" style={{ fontSize: 13, color: 'var(--color-accent-800)' }}>{error}</p>}
        </div>

        <div className="flex justify-end gap-2" style={{ padding: '12px 18px', borderTop: '1px solid var(--color-divider)' }}>
          <button className="vs-btn" onClick={onClose} disabled={edit.isPending}>Cancel</button>
          <button
            className="vs-btn vs-btn-primary relative"
            onClick={save}
            disabled={edit.isPending || !anyChange}
            aria-busy={edit.isPending}
          >
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            {edit.isPending ? 'Saving…' : 'Save correction'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
