import React, { useMemo, useState } from 'react'
import { Plus, Edit2, MessageSquare, X } from 'lucide-react'
import {
  useCoreValues, useBehaviours, useScenariosWithContext,
  useCreateScenario, useUpdateScenario,
} from '@/hooks/queries'
import { errorMessage } from '@/lib/query'
import type { ScenarioWithContext } from '@/lib/api'
import { PageHeader } from '@/components/shared/PageHeader'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { TableSkeleton } from '@/components/shared/SkeletonLoader'
import { EmptyState } from '@/components/shared/EmptyState'
import { dismissOnBackdrop } from '@/lib/backdrop'

/** The row shape is the API's — see ScenarioWithContext in lib/api/reference. */
type ScenarioRow = ScenarioWithContext

function FormDialog({ open, onClose, title, children, onSubmit, saving, submitLabel, error }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; onSubmit: () => void; saving: boolean; submitLabel: string; error?: string | null }) {
  if (!open) return null
  return (
    <div className="vs-dialog-backdrop" {...dismissOnBackdrop(() => onClose())}>
      <div className="vs-dialog animate-fade-in" style={{ minWidth: 420 }} onClick={e => e.stopPropagation()}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div className="flex items-center justify-between" style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--color-divider)' }}>
          <h2 className="font-condensed" style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text)' }}>{title}</h2>
          <button className="vs-btn-icon" style={{ width: 28, height: 28 }} onClick={onClose}><X size={13} /></button>
        </div>
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {children}
          {/* A refused write keeps the dialog open and says why. */}
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        </div>
        <div className="flex justify-end gap-2" style={{ padding: '12px 18px', borderTop: '1px solid var(--color-divider)' }}>
          <button className="vs-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="vs-btn vs-btn-primary relative" onClick={onSubmit} disabled={saving} aria-busy={saving}>
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            {saving ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function FL({ label, required, optional, children }: { label: string; required?: boolean; optional?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-text)', marginBottom: 5 }}>
        {label}
        {required && <span aria-hidden="true" style={{ color: 'var(--color-accent-700)', marginLeft: 3 }}>*</span>}
        {optional && <span style={{ fontSize: 11, color: 'var(--color-neutral-600)', marginLeft: 6 }}>(optional)</span>}
      </label>
      {children}
    </div>
  )
}

export default function ScenariosPage() {
  // Shared cached lists; see useReference.ts.
  const { data: coreValues = [] } = useCoreValues()
  const { data: allBehaviours = [] } = useBehaviours()

  const scenariosQuery = useScenariosWithContext()
  const createScenario = useCreateScenario()
  const updateScenario = useUpdateScenario()

  const scenarios = scenariosQuery.data ?? []
  const loading = scenariosQuery.isPending

  const [showForm, setShowForm]                 = useState(false)
  const [editing, setEditing]                   = useState<ScenarioRow | null>(null)
  const [form, setForm]                         = useState({ name: '', description: '', core_value_id: '', behaviour_id: '' })
  const [saving, setSaving]                     = useState(false)
  const [saveError, setSaveError]               = useState<string | null>(null)

  /*
    The shared behaviours list is ordered by display_order, but this dropdown
    has always listed them alphabetically. Sorting a cached copy here keeps the
    order the user is used to without a second request just to change ORDER BY.
  */
  const behaviours = useMemo(
    () => [...allBehaviours].sort((a, b) => a.name.localeCompare(b.name)),
    [allBehaviours],
  )

  const filteredBehaviours = useMemo(
    () => form.core_value_id
      ? behaviours.filter(b => b.core_value_id === form.core_value_id)
      : behaviours,
    [form.core_value_id, behaviours],
  )

  const openAdd  = () => { setEditing(null); setForm({ name: '', description: '', core_value_id: coreValues[0]?.id ?? '', behaviour_id: '' }); setSaveError(null); setShowForm(true) }
  const openEdit = (s: ScenarioRow) => { setEditing(s); setForm({ name: s.name, description: s.description ?? '', core_value_id: s.core_value_id, behaviour_id: s.behaviour_id }); setSaveError(null); setShowForm(true) }
  const closeForm = () => { setShowForm(false); setSaveError(null) }

  const save = async () => {
    if (!form.name.trim()) { setSaveError('A name is required.'); return }

    setSaving(true); setSaveError(null)

    try {
      if (editing) {
        // As before, editing changes the wording only — the form offers no way
        // to move a scenario to a different behaviour or value.
        await updateScenario.mutateAsync({
          id: editing.id,
          name: form.name,
          description: form.description || null,
        })
      } else {
        await createScenario.mutateAsync({
          name: form.name,
          coreValueId: form.core_value_id,
          behaviourId: form.behaviour_id,
          description: form.description || null,
          displayOrder: scenarios.length,
        })
      }
    } catch (err) {
      // Refused by the database. Keep the dialog open with the work in it;
      // nothing is invalidated, because onSuccess never ran.
      setSaveError(errorMessage(err, 'Could not save that scenario. Please try again.'))
      setSaving(false)
      return
    }

    setSaving(false); closeForm()
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        kicker="HR Manage"
        title="Scenarios"
        subtitle="Contextual scenarios that guide employees in the recognition wizard."
        actions={
          <button className="vs-btn vs-btn-primary relative" onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <Plus size={13} aria-hidden="true" /> Add Scenario
          </button>
        }
      />

      {loading ? <TableSkeleton /> : scenarios.length === 0 ? (
        <EmptyState icon={<MessageSquare size={36} />} title="No scenarios yet" description="Add scenarios to help employees select the right context for their recognition." action={{ label: 'Add Scenario', onClick: openAdd }} />
      ) : (
        <div className="vs-card" style={{ overflow: 'hidden' }}>
          <div className="overflow-x-auto">
            <table className="vs-table w-full" style={{ minWidth: 520 }}>
              <thead>
                <tr style={{ background: 'color-mix(in srgb, var(--color-neutral-300) 30%, transparent)' }}>
                  <th>Scenario</th>
                  <th className="hidden md:table-cell">Core Value</th>
                  <th className="hidden lg:table-cell">Behaviour</th>
                  <th>Status</th>
                  <th style={{ width: 48 }} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {scenarios.map(s => (
                  <tr key={s.id}>
                    <td>
                      <p style={{ fontWeight: 500, color: 'var(--color-text)', fontSize: 13 }}>{s.name}</p>
                      {s.description && <p className="line-clamp-1" style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 2 }}>{s.description}</p>}
                    </td>
                    <td className="hidden md:table-cell" style={{ color: 'var(--color-neutral-700)', fontSize: 13 }}>
                      {(s.core_values as { name: string } | null)?.name ?? <span style={{ color: 'var(--color-neutral-400)' }}>—</span>}
                    </td>
                    <td className="hidden lg:table-cell" style={{ color: 'var(--color-neutral-700)', fontSize: 13 }}>
                      {(s.behaviours as { name: string } | null)?.name ?? <span style={{ color: 'var(--color-neutral-400)' }}>—</span>}
                    </td>
                    <td><span className={`vs-tag ${s.is_active ? 'vs-tag-accent' : 'vs-tag-neutral'}`}>{s.is_active ? 'Active' : 'Archived'}</span></td>
                    <td><button className="vs-btn-icon" style={{ width: 28, height: 28 }} onClick={() => openEdit(s)} aria-label={`Edit ${s.name}`}><Edit2 size={12} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <FormDialog open={showForm} onClose={closeForm} title={editing ? 'Edit Scenario' : 'Add Scenario'} onSubmit={save} saving={saving} submitLabel={editing ? 'Save changes' : 'Add Scenario'} error={saveError}>
        {!editing && (
          <>
            <FL label="Core Value" required>
              <select className="vs-input w-full" value={form.core_value_id} onChange={e => setForm(f => ({ ...f, core_value_id: e.target.value, behaviour_id: '' }))}>
                {coreValues.map(cv => <option key={cv.id} value={cv.id}>{cv.name}</option>)}
              </select>
            </FL>
            <FL label="Behaviour" required>
              <select className="vs-input w-full" value={form.behaviour_id} onChange={e => setForm(f => ({ ...f, behaviour_id: e.target.value }))}>
                <option value="">Select behaviour</option>
                {filteredBehaviours.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </FL>
          </>
        )}
        <FL label="Scenario Name" required><Input placeholder="e.g. Resolved a cross-team technical blocker" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus /></FL>
        <FL label="Description" optional><Textarea placeholder="Additional context about when this scenario applies" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></FL>
      </FormDialog>
    </div>
  )
}
