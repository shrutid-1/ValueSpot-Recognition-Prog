import { useState } from 'react'
import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  useCoreValues, useBehaviours, useScenarios, useResolveSupportRequest, useRejectSupportRequest,
} from '@/hooks/queries'
import {
  ApiError, AlreadySettledError,
  type SupportRequest, type RecognitionCorrection,
} from '@/lib/api'
import { dismissOnBackdrop } from '@/lib/backdrop'
import { ProposalComparison } from '@/components/support/ProposalSummary'

/**
 * Work one correction request: see it, fix it, settle it.
 *
 * ONE CALL, NOT A SEQUENCE
 * ------------------------
 * "Resolve & apply" sends a single RPC that claims the request, applies the
 * correction, writes the audit row and notifies the requester inside one
 * transaction. The alternative — edit, then mark resolved, then notify — has a
 * failure mode this cannot have: a request marked resolved with nothing
 * corrected, or a correction applied to a request somebody else already
 * settled.
 *
 * LOSING THE RACE IS A NORMAL OUTCOME
 * -----------------------------------
 * HR and a Super Admin see the same queue and may both be looking at this
 * request. The database decides who wins; when this one loses it is told by
 * whom, and says so rather than failing vaguely. Nothing was written on the
 * losing path — the claim and the correction roll back together.
 */
export function ResolveRequestDialog({
  request,
  onClose,
}: {
  request: SupportRequest
  onClose: () => void
}) {
  const resolve = useResolveSupportRequest()
  const reject = useRejectSupportRequest()

  const nom = request.nomination

  /*
    Start from what the requester asked for (migration 060), so the common case
    is reading it and pressing Resolve. The "old → new" lines under each field
    still compare against the recognition as it is now, and the reviewer can
    change any of it before applying.
  */
  const proposed = request.proposed_core_value_id != null
  const [coreValueId, setCoreValueId] = useState(
    proposed ? request.proposed_core_value_id! : nom?.core_value_id ?? '')
  const [behaviourId, setBehaviourId] = useState(
    proposed ? request.proposed_behaviour_id ?? '' : nom?.behaviour_id ?? '')
  const [scenarioId, setScenarioId] = useState(
    proposed ? request.proposed_scenario_id ?? '' : nom?.scenario_id ?? '')
  const [whatHappened, setWhatHappened] = useState(nom?.what_happened ?? '')
  const [whatImpact, setWhatImpact] = useState(nom?.what_impact ?? '')
  const [note, setNote] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settled, setSettled] = useState<string | null>(null)

  const coreValues = useCoreValues(true)
  // Behaviours belong to a core value, so switching the value must re-scope
  // them — picking a behaviour from the OLD value would be a fresh mistake.
  const behaviours = useBehaviours(coreValueId || undefined, true)
  // Scenarios belong to a behaviour the same way; with no behaviour there are
  // none to offer.
  const scenarios = useScenarios({ behaviourId: behaviourId || undefined, enabled: Boolean(behaviourId) })

  const coreValueChanged = coreValueId !== (nom?.core_value_id ?? '')
  const behaviourChanged = behaviourId !== (nom?.behaviour_id ?? '')
  const scenarioChanged  = scenarioId !== (nom?.scenario_id ?? '')
  const storyChanged     = whatHappened !== (nom?.what_happened ?? '')
  const impactChanged    = whatImpact !== (nom?.what_impact ?? '')
  const anyChange =
    coreValueChanged || behaviourChanged || scenarioChanged || storyChanged || impactChanged

  const currentCoreValueName = nom?.snapshot_core_value_name ?? '—'
  const newCoreValueName =
    coreValues.data?.find(v => v.id === coreValueId)?.name ?? currentCoreValueName

  const handle = async (fn: () => Promise<unknown>) => {
    setError(null)
    setSettled(null)
    try {
      await fn()
      onClose()
    } catch (err) {
      if (err instanceof AlreadySettledError) {
        // Not an error the person caused. Say who won; the queue behind this
        // dialog has already been refetched by the mutation's onSettled.
        setSettled(err.message)
        return
      }
      setError(err instanceof ApiError ? err.message : 'That did not work. Please try again.')
    }
  }

  const submitResolve = () => {
    const correction: RecognitionCorrection = {}
    if (coreValueChanged) correction.coreValueId = coreValueId
    // '' from the select means "no behaviour", which is a real choice on a
    // nullable column — null tells the RPC to clear it rather than skip it.
    if (behaviourChanged) correction.behaviourId = behaviourId || null
    if (scenarioChanged)  correction.scenarioId = scenarioId || null
    if (storyChanged)    correction.whatHappened = whatHappened
    if (impactChanged)    correction.whatImpact = whatImpact

    return handle(() => resolve.mutateAsync({
      requestId: request.id,
      note: note.trim() || undefined,
      correction: anyChange ? correction : undefined,
    }))
  }

  const submitReject = () => {
    if (!note.trim()) { setError('Give the requester a reason.'); return }
    return handle(() => reject.mutateAsync({ requestId: request.id, reason: note.trim() }))
  }

  const busy = resolve.isPending || reject.isPending

  return createPortal(
    <div
      className="vs-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resolve-title"
      {...dismissOnBackdrop(() => { if (!busy) onClose() })}
    >
      <div
        className="vs-dialog animate-fade-in"
        style={{ minWidth: 460, maxWidth: 620, maxHeight: '90vh', overflowY: 'auto' }}
      >
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />

        <div
          className="flex items-start justify-between"
          style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--color-divider)' }}
        >
          <div>
            <p className="vs-kicker" style={{ marginBottom: 4 }}>Correction request</p>
            <h2 id="resolve-title" className="font-condensed" style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text)' }}>
              {nom?.nominator?.full_name ?? 'Someone'} → {nom?.nominee?.full_name ?? 'someone'}
            </h2>
          </div>
          <button className="vs-btn-icon" style={{ width: 28, height: 28 }} onClick={onClose} disabled={busy} aria-label="Close">
            <X size={13} />
          </button>
        </div>

        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* What was asked for */}
          <section style={{ border: '1px solid var(--color-divider)', padding: 12 }}>
            <p className="vs-kicker" style={{ marginBottom: 6 }}>Requested by {request.requester?.full_name ?? 'an employee'}</p>
            <p style={{ fontSize: 13, color: 'var(--color-neutral-700)', lineHeight: 1.55 }}>
              {request.description}
            </p>
            {request.requested_change && (
              <p style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.55, marginTop: 6, fontWeight: 500 }}>
                {request.requested_change}
              </p>
            )}
            <ProposalComparison request={request} />
            {proposed && (
              <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 8 }}>
                The fields below are filled in with this request. Adjust them if needed.
              </p>
            )}
          </section>

          <div>
            <label htmlFor="rr-core-value" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
              Core Value
            </label>
            <select
              id="rr-core-value"
              className="vs-input w-full"
              value={coreValueId}
              onChange={e => {
                setCoreValueId(e.target.value)
                // The old behaviour belongs to the old value, and the old
                // scenario to the old behaviour; drop both rather than leave
                // an inconsistent pair selected.
                setBehaviourId('')
                setScenarioId('')
              }}
            >
              {coreValues.data?.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            {coreValueChanged && (
              <p style={{ fontSize: 12, color: 'var(--color-accent-700)', marginTop: 4 }}>
                {currentCoreValueName} → {newCoreValueName}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="rr-behaviour" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
              Behaviour
            </label>
            <select
              id="rr-behaviour"
              className="vs-input w-full"
              value={behaviourId}
              onChange={e => { setBehaviourId(e.target.value); setScenarioId('') }}
            >
              <option value="">No behaviour</option>
              {behaviours.data?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {behaviourChanged && (
              <p style={{ fontSize: 12, color: 'var(--color-accent-700)', marginTop: 4 }}>
                {nom?.snapshot_behaviour_name ?? 'None'} →{' '}
                {behaviours.data?.find(b => b.id === behaviourId)?.name ?? 'None'}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="rr-scenario" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
              Scenario
            </label>
            <select
              id="rr-scenario"
              className="vs-input w-full"
              value={scenarioId}
              onChange={e => setScenarioId(e.target.value)}
              disabled={!behaviourId}
            >
              <option value="">{behaviourId ? 'No scenario' : 'Choose a behaviour first'}</option>
              {behaviourId && scenarios.data?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {scenarioChanged && (
              <p style={{ fontSize: 12, color: 'var(--color-accent-700)', marginTop: 4 }}>
                {nom?.snapshot_scenario_name ?? 'None'} →{' '}
                {scenarios.data?.find(s => s.id === scenarioId)?.name ?? 'None'}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="rr-story" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
              What happened
            </label>
            <textarea
              id="rr-story"
              className="vs-input w-full"
              style={{ minHeight: 70 }}
              value={whatHappened}
              onChange={e => setWhatHappened(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="rr-impact" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
              Impact
            </label>
            <textarea
              id="rr-impact"
              className="vs-input w-full"
              style={{ minHeight: 60 }}
              value={whatImpact}
              onChange={e => setWhatImpact(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="rr-note" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
              {rejecting ? 'Reason (sent to the requester)' : 'Note to the requester'}
            </label>
            <textarea
              id="rr-note"
              className="vs-input w-full"
              style={{ minHeight: 56 }}
              placeholder={rejecting
                ? 'e.g. The Core Value recorded is the one the recognition describes.'
                : 'Optional — e.g. Core Value changed from Accountability to Collaboration.'}
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </div>

          {settled && (
            <p role="status" style={{ fontSize: 13, color: 'var(--color-accent-800)', lineHeight: 1.5 }}>
              {settled} Nothing was changed by this attempt — close and reopen the queue to see the outcome.
            </p>
          )}
          {error && (
            <p role="alert" style={{ fontSize: 13, color: 'var(--color-accent-800)' }}>{error}</p>
          )}
        </div>

        <div
          className="flex items-center justify-between gap-2"
          style={{ padding: '12px 18px', borderTop: '1px solid var(--color-divider)' }}
        >
          <button
            type="button"
            onClick={() => { setRejecting(r => !r); setError(null) }}
            disabled={busy}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13, color: 'var(--color-neutral-600)', padding: '6px 2px',
            }}
          >
            {rejecting ? 'Back to correcting' : 'Reject instead'}
          </button>

          <div className="flex gap-2">
            <button className="vs-btn" onClick={onClose} disabled={busy}>Cancel</button>
            {rejecting ? (
              <button
                className="vs-btn vs-btn-primary relative"
                onClick={submitReject}
                disabled={busy}
                aria-busy={busy}
              >
                <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
                {reject.isPending ? 'Rejecting…' : 'Reject request'}
              </button>
            ) : (
              <button
                className="vs-btn vs-btn-primary relative"
                onClick={submitResolve}
                disabled={busy}
                aria-busy={busy}
              >
                <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
                {resolve.isPending
                  ? 'Resolving…'
                  : anyChange ? 'Resolve & apply changes' : 'Resolve without changes'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
