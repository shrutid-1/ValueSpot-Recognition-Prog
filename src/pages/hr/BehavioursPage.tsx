import React, { useState } from 'react'
import { Plus, Edit2, ClipboardList, X } from 'lucide-react'
import {
  useCoreValues, useBehavioursWithValues, useCreateBehaviour, useUpdateBehaviour,
} from '@/hooks/queries'
import { errorMessage } from '@/lib/query'
import type { BehaviourWithValue } from '@/lib/api'
import { PageHeader } from '@/components/shared/PageHeader'
import { Input } from '@/components/ui/input'
import { TableSkeleton } from '@/components/shared/SkeletonLoader'
import { EmptyState } from '@/components/shared/EmptyState'
import { CoreValueBadge } from '@/components/shared/CoreValueBadge'
import type { CoreValueSlug } from '@/lib/constants'
import { dismissOnBackdrop } from '@/lib/backdrop'

/** The row shape is the API's — see BehaviourWithValue in lib/api/reference. */
type BehaviourRow = BehaviourWithValue

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

function FL({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-text)', marginBottom: 5 }}>
        {label}{required && <span aria-hidden="true" style={{ color: 'var(--color-accent-700)', marginLeft: 3 }}>*</span>}
      </label>
      {children}
    </div>
  )
}

export default function BehavioursPage() {
  // Shared with the recognition wizard and the Core Values screen — one
  // cached copy of five rows instead of a fetch per screen.
  const { data: coreValues = [] } = useCoreValues()

  const behavioursQuery = useBehavioursWithValues()
  const createBehaviour = useCreateBehaviour()
  const updateBehaviour = useUpdateBehaviour()

  const behaviours = behavioursQuery.data ?? []
  const loading = behavioursQuery.isPending

  const [filter, setFilter]         = useState('')
  const [showForm, setShowForm]     = useState(false)
  const [editing, setEditing]       = useState<BehaviourRow | null>(null)
  const [form, setForm]             = useState({ name: '', description: '', core_value_id: '' })
  const [saving, setSaving]         = useState(false)
  const [saveError, setSaveError]   = useState<string | null>(null)

  const filtered = filter ? behaviours.filter(b => b.core_value_id === filter) : behaviours
  const openEdit = (b: BehaviourRow) => { setEditing(b); setForm({ name: b.name, description: b.description ?? '', core_value_id: b.core_value_id }); setSaveError(null); setShowForm(true) }
  const openAdd  = () => { setEditing(null); setForm({ name: '', description: '', core_value_id: coreValues[0]?.id ?? '' }); setSaveError(null); setShowForm(true) }
  const closeForm = () => { setShowForm(false); setSaveError(null) }

  const save = async () => {
    if (!form.name.trim()) { setSaveError('A name is required.'); return }

    setSaving(true); setSaveError(null)

    try {
      if (editing) {
        // Editing deliberately does not move a behaviour to another core
        // value — the form offers no way to, and it never did.
        await updateBehaviour.mutateAsync({
          id: editing.id,
          name: form.name,
          description: form.description || null,
        })
      } else {
        await createBehaviour.mutateAsync({
          name: form.name,
          coreValueId: form.core_value_id,
          description: form.description || null,
          displayOrder: behaviours.length,
        })
      }
    } catch (err) {
      // Refused by the database. Keep the dialog open with the work in it;
      // nothing is invalidated, because onSuccess never ran.
      setSaveError(errorMessage(err, 'Could not save that behaviour. Please try again.'))
      setSaving(false)
      return
    }

    setSaving(false); closeForm()
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        kicker="HR Manage"
        title="Behaviours"
        subtitle="Define observable behaviours associated with each Core Value."
        actions={
          <button className="vs-btn vs-btn-primary relative" onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <Plus size={13} aria-hidden="true" /> Add Behaviour
          </button>
        }
      />

      {/* Core Value filter — segmented */}
      <div className="vs-seg" style={{ width: 'fit-content', flexWrap: 'wrap' }} role="group" aria-label="Filter by Core Value">
        <button onClick={() => setFilter('')} style={{ padding: '5px 12px', fontSize: 12, fontFamily: 'inherit', fontWeight: 600, border: 'none', borderRight: '1px solid var(--color-divider)', background: !filter ? 'var(--color-accent)' : 'transparent', color: !filter ? 'var(--color-bg)' : 'var(--color-neutral-600)', cursor: 'pointer', transition: 'background 120ms, color 120ms' }} aria-pressed={!filter}>All</button>
        {coreValues.map(cv => (
          <button key={cv.id} onClick={() => setFilter(cv.id)} style={{ padding: '5px 12px', fontSize: 12, fontFamily: 'inherit', fontWeight: 600, border: 'none', borderRight: '1px solid var(--color-divider)', background: filter === cv.id ? 'var(--color-accent)' : 'transparent', color: filter === cv.id ? 'var(--color-bg)' : 'var(--color-neutral-600)', cursor: 'pointer', transition: 'background 120ms, color 120ms' }} aria-pressed={filter === cv.id}>{cv.name}</button>
        ))}
      </div>

      {loading ? <TableSkeleton /> : filtered.length === 0 ? (
        <EmptyState icon={<ClipboardList size={36} />} title={filter ? 'No behaviours for this Core Value' : 'No behaviours yet'} description={filter ? 'Try a different filter, or add a new behaviour.' : 'Add behaviours to guide recognition for each Core Value.'} action={!filter ? { label: 'Add Behaviour', onClick: openAdd } : undefined} />
      ) : (
        <div className="vs-card" style={{ overflow: 'hidden' }}>
          <div className="overflow-x-auto">
            <table className="vs-table w-full" style={{ minWidth: 480 }}>
              <thead>
                <tr style={{ background: 'color-mix(in srgb, var(--color-neutral-300) 30%, transparent)' }}>
                  <th>Behaviour</th>
                  <th className="hidden sm:table-cell">Core Value</th>
                  <th>Status</th>
                  <th style={{ width: 48 }} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(b => (
                  <tr key={b.id}>
                    <td>
                      <p style={{ fontWeight: 500, color: 'var(--color-text)', fontSize: 13 }}>{b.name}</p>
                      {b.description && <p className="line-clamp-1" style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 2 }}>{b.description}</p>}
                    </td>
                    <td className="hidden sm:table-cell">
                      {b.core_values ? <CoreValueBadge name={b.core_values.name} slug={b.core_values.slug as CoreValueSlug} /> : <span style={{ color: 'var(--color-neutral-400)' }}>—</span>}
                    </td>
                    <td><span className={`vs-tag ${b.is_active ? 'vs-tag-accent' : 'vs-tag-neutral'}`}>{b.is_active ? 'Active' : 'Archived'}</span></td>
                    <td><button className="vs-btn-icon" style={{ width: 28, height: 28 }} onClick={() => openEdit(b)} aria-label={`Edit ${b.name}`}><Edit2 size={12} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <FormDialog open={showForm} onClose={closeForm} title={editing ? 'Edit Behaviour' : 'Add Behaviour'} onSubmit={save} saving={saving} submitLabel={editing ? 'Save changes' : 'Add Behaviour'} error={saveError}>
        {!editing && (
          <FL label="Core Value" required>
            <select className="vs-input w-full" value={form.core_value_id} onChange={e => setForm(f => ({ ...f, core_value_id: e.target.value }))}>
              {coreValues.map(cv => <option key={cv.id} value={cv.id}>{cv.name}</option>)}
            </select>
          </FL>
        )}
        <FL label="Behaviour Name" required><Input placeholder="e.g. Supports colleagues" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus /></FL>
        <FL label="Description">
          <input className="vs-input w-full" placeholder="Brief description of when this behaviour applies" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </FL>
      </FormDialog>
    </div>
  )
}
