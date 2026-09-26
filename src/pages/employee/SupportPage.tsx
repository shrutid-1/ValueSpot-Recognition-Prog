import { useState } from 'react'
import { LifeBuoy, Plus, X } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { TableSkeleton } from '@/components/shared/SkeletonLoader'
import { useAuth } from '@/context/AuthContext'
import {
  useMyRecognitions, useMySupportRequests, useCreateSupportRequest,
  useCoreValues, useBehaviours, useScenarios,
} from '@/hooks/queries'
import { ApiError, type SupportIssueType, type SupportRequestStatus } from '@/lib/api'
import { formatIST } from '@/lib/date-utils'
import { ProposalSummary } from '@/components/support/ProposalSummary'

/**
 * Support — where an employee reports a mistake in a recognition.
 *
 * WHY A REQUEST AND NOT AN EDIT
 * -----------------------------
 * A published recognition is a record of something a colleague said about
 * someone's work, and it has been through an approval. Letting either party
 * rewrite it afterwards would make it worth less, and would route around the
 * approver entirely. So the employee describes what is wrong and what it
 * should say; HR or a Super Admin makes the change.
 *
 * That is not enforced here. `nominations` has no update policy that would let
 * a nominator edit an approved row, and moderate_recognition() refuses anyone
 * who is not HR or a Super Admin. This screen is the polite front of a rule
 * the database keeps.
 *
 * THE WHOLE CHAIN, NOT ONE FIELD
 * ------------------------------
 * Behaviours belong to a Core Value and scenarios to a Behaviour, so "wrong
 * Core Value" is never a one-field fix: the Behaviour and Scenario have to
 * move with it. The employee therefore picks the Core Value, Behaviour and
 * Scenario the recognition SHOULD have, starting from what it has now, and
 * the reviewer receives that exact choice (migration 060) instead of
 * guessing from a sentence.
 */

/** The Scenario select's value for "none of these" — the wizard's "A different situation". */
const NO_SCENARIO = 'none'

const ISSUE_LABELS: Record<SupportIssueType, string> = {
  core_value: 'Wrong Core Value',
  behaviour:  'Wrong Behaviour',
  scenario:   'Wrong Scenario',
  story:      'Mistake in what happened',
  impact:     'Mistake in the impact',
  project:    'Wrong project',
  other:      'Something else',
}

const STATUS_STYLE: Record<SupportRequestStatus, { label: string; tag: string }> = {
  open:        { label: 'Open',        tag: 'vs-tag-outline' },
  in_progress: { label: 'In Progress', tag: 'vs-tag-outline' },
  resolved:    { label: 'Resolved',    tag: 'vs-tag-accent'  },
  rejected:    { label: 'Not applied', tag: 'vs-tag-neutral' },
}

/** "HR — Priya", from the role snapshot taken when they acted. */
function resolverLabel(role: string | null, name: string | undefined): string {
  const roleName = role === 'super_admin' ? 'Super Admin' : role === 'hr_admin' ? 'HR' : null
  if (!roleName) return name ?? 'an administrator'
  return name ? `${roleName} — ${name}` : roleName
}

export default function SupportPage() {
  const { employee } = useAuth()
  const requests = useMySupportRequests()
  const createRequest = useCreateSupportRequest()

  const [composing, setComposing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    nominationId: '',
    coreValueId: '',
    behaviourId: '',
    scenarioId: '',
    description: '',
    requestedChange: '',
  })

  /*
    The picker's contents.

    Both tabs, because a mistake is just as likely in a recognition you
    RECEIVED as one you gave — and both are things create_support_request()
    will accept, since it checks nominator OR nominee. Nobody types a UUID.
  */
  const given = useMyRecognitions(employee?.id, 'given')
  const received = useMyRecognitions(employee?.id, 'received')

  const selectable = [
    ...(given.data ?? []).map(r => ({ r, direction: 'You recognised' as const })),
    ...(received.data ?? []).map(r => ({ r, direction: 'You were recognised by' as const })),
  ].filter(({ r }) => r.status !== 'removed')

  const chosen = selectable.find(({ r }) => r.id === form.nominationId)?.r

  // What the chosen recognition says today — the starting point of the form.
  const current = chosen
    ? {
        coreValueId: chosen.core_value_id,
        behaviourId: chosen.behaviour_id ?? '',
        scenarioId: chosen.scenario_id ?? NO_SCENARIO,
      }
    : null

  const coreValues = useCoreValues(true)
  const behaviours = useBehaviours(form.coreValueId || undefined, true)
  const scenarios = useScenarios({
    behaviourId: form.behaviourId || undefined,
    enabled: Boolean(form.behaviourId),
  })

  const chainChanged = !!current && (
    form.coreValueId !== current.coreValueId
    || form.behaviourId !== current.behaviourId
    || form.scenarioId !== current.scenarioId
  )

  const reset = () => {
    setForm({
      nominationId: '', coreValueId: '', behaviourId: '', scenarioId: '',
      description: '', requestedChange: '',
    })
    setError(null)
  }

  const chooseRecognition = (id: string) => {
    const r = selectable.find(s => s.r.id === id)?.r
    setForm(f => ({
      ...f,
      nominationId: id,
      coreValueId: r?.core_value_id ?? '',
      behaviourId: r?.behaviour_id ?? '',
      scenarioId: r ? (r.scenario_id ?? NO_SCENARIO) : '',
    }))
    setError(null)
  }

  const submit = async () => {
    if (!form.nominationId) { setError('Choose the recognition this is about.'); return }
    if (chainChanged && !form.behaviourId) { setError('Choose the Behaviour it should have.'); return }
    if (chainChanged && !form.scenarioId) {
      setError('Choose the Scenario it should have, or "A different situation".'); return
    }
    if (!form.description.trim()) { setError('Describe what is wrong.'); return }
    if (!chainChanged && !form.requestedChange.trim()) {
      setError('Choose the correct Core Value, Behaviour and Scenario, or describe the change you want.')
      return
    }

    setError(null)

    try {
      await createRequest.mutateAsync({
        nominationId: form.nominationId,
        description: form.description.trim(),
        requestedChange: form.requestedChange.trim() || undefined,
        proposal: chainChanged
          ? {
              coreValueId: form.coreValueId,
              behaviourId: form.behaviourId,
              scenarioId: form.scenarioId === NO_SCENARIO ? null : form.scenarioId,
            }
          : undefined,
      })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that request.')
      return
    }

    reset()
    setComposing(false)
  }

  const rows = requests.data ?? []

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        kicker="Support"
        title="Recognition corrections"
        subtitle="Spotted a mistake in a recognition you gave or received? Ask HR to put it right."
        actions={
          !composing && (
            <button
              className="vs-btn vs-btn-primary relative"
              onClick={() => { reset(); setComposing(true) }}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
              <Plus size={13} aria-hidden="true" /> New request
            </button>
          )
        }
      />

      {composing && (
        <section className="vs-card relative" style={{ padding: 18 }}>
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />

          <div className="flex items-start justify-between" style={{ marginBottom: 14 }}>
            <div>
              <p className="vs-kicker" style={{ marginBottom: 4 }}>New request</p>
              <h2 className="font-condensed" style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text)' }}>
                What needs correcting?
              </h2>
            </div>
            <button
              className="vs-btn-icon"
              style={{ width: 28, height: 28 }}
              onClick={() => { setComposing(false); reset() }}
              aria-label="Cancel"
            >
              <X size={13} />
            </button>
          </div>

          <div className="space-y-3.5">
            <div>
              <label htmlFor="sr-recognition" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
                Which recognition?
              </label>
              <select
                id="sr-recognition"
                className="vs-input w-full"
                value={form.nominationId}
                onChange={e => chooseRecognition(e.target.value)}
              >
                <option value="">Select a recognition…</option>
                {selectable.map(({ r, direction }) => (
                  <option key={r.id} value={r.id}>
                    {direction === 'You recognised'
                      ? `You recognised ${r.nominee?.full_name ?? 'a colleague'}`
                      : `${r.nominator?.full_name ?? 'A colleague'} recognised you`}
                    {' — '}{r.core_value?.name ?? 'Core Value'}
                    {' · '}{formatIST(r.created_at)}
                  </option>
                ))}
              </select>
              {selectable.length === 0 && !given.isPending && !received.isPending && (
                <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 4 }}>
                  You have no recognitions to correct yet.
                </p>
              )}
            </div>

            {chosen && current && (
              <fieldset style={{ border: '1px solid var(--color-divider)', padding: 12, margin: 0 }}>
                <legend className="vs-kicker" style={{ padding: '0 4px' }}>What it should say</legend>
                <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginBottom: 10, lineHeight: 1.5 }}>
                  Currently: {chosen.core_value?.name ?? chosen.snapshot_core_value_name ?? '—'}
                  {' · '}{chosen.behaviour?.name ?? chosen.snapshot_behaviour_name ?? 'No behaviour'}
                  {' · '}{chosen.snapshot_scenario_name ?? 'No scenario'}.
                  {' '}Change what is wrong; a new Core Value needs a Behaviour and Scenario from it.
                </p>

                <div className="space-y-3">
                  <div>
                    <label htmlFor="sr-core-value" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
                      Core Value
                    </label>
                    <select
                      id="sr-core-value"
                      className="vs-input w-full"
                      value={form.coreValueId}
                      onChange={e => {
                        const v = e.target.value
                        // Back to the current value restores its behaviour and
                        // scenario; any other value starts them empty, since
                        // the old ones belong to the old value.
                        setForm(f => v === current.coreValueId
                          ? { ...f, coreValueId: v, behaviourId: current.behaviourId, scenarioId: current.scenarioId }
                          : { ...f, coreValueId: v, behaviourId: '', scenarioId: '' })
                        setError(null)
                      }}
                    >
                      {coreValues.data?.map(v => (
                        <option key={v.id} value={v.id}>
                          {v.name}{v.id === current.coreValueId ? ' (current)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="sr-behaviour" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
                      Behaviour
                    </label>
                    <select
                      id="sr-behaviour"
                      className="vs-input w-full"
                      value={form.behaviourId}
                      onChange={e => {
                        const b = e.target.value
                        setForm(f => ({
                          ...f,
                          behaviourId: b,
                          scenarioId: b === current.behaviourId ? current.scenarioId : '',
                        }))
                        setError(null)
                      }}
                    >
                      <option value="" disabled>Select a behaviour…</option>
                      {behaviours.data?.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.name}{b.id === current.behaviourId ? ' (current)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="sr-scenario" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
                      Scenario
                    </label>
                    <select
                      id="sr-scenario"
                      className="vs-input w-full"
                      value={form.scenarioId}
                      onChange={e => { setForm(f => ({ ...f, scenarioId: e.target.value })); setError(null) }}
                      disabled={!form.behaviourId}
                    >
                      <option value="" disabled>
                        {form.behaviourId ? 'Select a scenario…' : 'Choose a behaviour first'}
                      </option>
                      {form.behaviourId && scenarios.data?.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name}{s.id === current.scenarioId ? ' (current)' : ''}
                        </option>
                      ))}
                      {form.behaviourId && (
                        <option value={NO_SCENARIO}>
                          A different situation{current.scenarioId === NO_SCENARIO
                            && form.behaviourId === current.behaviourId ? ' (current)' : ''}
                        </option>
                      )}
                    </select>
                  </div>
                </div>
              </fieldset>
            )}

            <div>
              <label htmlFor="sr-description" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
                Describe the problem
              </label>
              <textarea
                id="sr-description"
                className="vs-input w-full"
                style={{ minHeight: 70 }}
                placeholder="e.g. I picked Accountability by mistake."
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            <div>
              <label htmlFor="sr-change" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5 }}>
                {chainChanged ? 'Anything else HR should know? (optional)' : 'What else should be changed?'}
              </label>
              <textarea
                id="sr-change"
                className="vs-input w-full"
                style={{ minHeight: 70 }}
                placeholder={chainChanged
                  ? 'e.g. The story is fine; only the Core Value was wrong.'
                  : 'e.g. The impact should mention the release date, not the demo.'}
                value={form.requestedChange}
                onChange={e => setForm(f => ({ ...f, requestedChange: e.target.value }))}
              />
            </div>

            {error && (
              <p role="alert" style={{ fontSize: 13, color: 'var(--color-accent-800)' }}>{error}</p>
            )}

            <div className="flex justify-end gap-2">
              <button className="vs-btn" onClick={() => { setComposing(false); reset() }} disabled={createRequest.isPending}>
                Cancel
              </button>
              <button
                className="vs-btn vs-btn-primary relative"
                onClick={submit}
                disabled={createRequest.isPending}
                aria-busy={createRequest.isPending}
              >
                <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
                {createRequest.isPending ? 'Sending…' : 'Send request'}
              </button>
            </div>
          </div>
        </section>
      )}

      {requests.isPending ? <TableSkeleton /> : rows.length === 0 ? (
        <EmptyState
          icon={<LifeBuoy size={36} />}
          title="No requests yet"
          description="If a recognition you gave or received has a mistake in it, ask here and HR will correct it."
          action={composing ? undefined : { label: 'New request', onClick: () => { reset(); setComposing(true) } }}
        />
      ) : (
        <div className="space-y-3">
          {rows.map(req => {
            const style = STATUS_STYLE[req.status]
            const nom = req.nomination

            return (
              <article key={req.id} className="vs-card relative" style={{ padding: 16 }}>
                <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />

                <div className="flex items-start justify-between gap-3" style={{ marginBottom: 8 }}>
                  <div className="min-w-0">
                    <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)' }}>
                      {ISSUE_LABELS[req.issue_type]}
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 2 }}>
                      {nom?.nominator?.full_name ?? 'Someone'} → {nom?.nominee?.full_name ?? 'someone'}
                      {' · '}{formatIST(req.created_at)}
                    </p>
                  </div>
                  <span className={`vs-tag ${style.tag}`} style={{ flexShrink: 0 }}>{style.label}</span>
                </div>

                <dl style={{ fontSize: 13, color: 'var(--color-neutral-700)', lineHeight: 1.55 }}>
                  <dt style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>Problem</dt>
                  <dd style={{ marginBottom: 6 }}>{req.description}</dd>
                  {req.proposed_core_value_id && (
                    <>
                      <dt style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>Requested</dt>
                      <dd style={{ marginBottom: 6 }}><ProposalSummary request={req} /></dd>
                    </>
                  )}
                  {req.requested_change && (
                    <>
                      <dt style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>
                        {req.proposed_core_value_id ? 'Also' : 'Requested change'}
                      </dt>
                      <dd>{req.requested_change}</dd>
                    </>
                  )}
                </dl>

                {(req.status === 'resolved' || req.status === 'rejected') && (
                  <div
                    style={{
                      marginTop: 12, paddingTop: 10,
                      borderTop: '1px solid var(--color-divider)',
                      fontSize: 13, color: 'var(--color-neutral-700)', lineHeight: 1.55,
                    }}
                  >
                    <p>
                      <span style={{ fontWeight: 500 }}>
                        {req.status === 'resolved' ? 'Resolved by ' : 'Reviewed by '}
                      </span>
                      {resolverLabel(req.resolved_by_role, undefined)}
                      {req.resolved_at && ` · ${formatIST(req.resolved_at)}`}
                    </p>
                    {req.resolution_note && (
                      <p style={{ marginTop: 4 }}>{req.resolution_note}</p>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
