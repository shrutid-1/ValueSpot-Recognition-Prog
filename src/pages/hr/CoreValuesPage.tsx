import React, { useEffect, useState } from 'react'
import { Plus, Edit2, Trash2, Star, Search, X } from 'lucide-react'
import { useCoreValues, useCreateCoreValue, useUpdateCoreValue, useSetCoreValueActive } from '@/hooks/queries'
import { errorMessage } from '@/lib/query'
import type { CoreValue } from '@/types'
import { toast } from '@/hooks/use-toast'
import { PageHeader } from '@/components/shared/PageHeader'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { TableSkeleton } from '@/components/shared/SkeletonLoader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmModal } from '@/components/shared/ConfirmModal'
import { SEARCH_DEBOUNCE_MS } from '@/lib/constants'
import { useDebounce } from '@/hooks/useDebounce'
import { dismissOnBackdrop } from '@/lib/backdrop'

interface CoreValueForm {
  name: string; slug: string; definition: string
  icon: string; accent_color: string; display_order: string
}
const EMPTY_FORM: CoreValueForm = { name: '', slug: '', definition: '', icon: 'star', accent_color: '#c42a20', display_order: '0' }

function toSlug(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
}
interface FormErrors { name?: string; slug?: string; definition?: string; display_order?: string }
/**
 * `existing` is every Core Value, deleted ones included. A deleted value keeps
 * its row, and so its slug, for the recognitions that used it, so a new value
 * cannot reuse that slug — and the database's own refusal would only say
 * "That record already exists" about a row this screen no longer shows.
 */
function validate(form: CoreValueForm, isNew: boolean, existing: CoreValue[]): FormErrors {
  const errors: FormErrors = {}
  if (!form.name.trim()) errors.name = 'Name is required.'
  else if (form.name.trim().length > 100) errors.name = 'Name must be 100 characters or fewer.'
  if (isNew) {
    const slug = form.slug.trim()
    const taken = existing.find(cv => cv.slug === slug)
    if (!slug) errors.slug = 'Slug is required.'
    else if (!/^[a-z0-9-]+$/.test(slug)) errors.slug = 'Lowercase letters, numbers and hyphens only.'
    else if (slug.length > 60) errors.slug = 'Slug must be 60 characters or fewer.'
    else if (taken) {
      errors.slug = taken.is_active
        ? `${taken.name} already uses this slug.`
        : 'A deleted Core Value used this slug. Please choose a different one.'
    }
  }
  if (!form.definition.trim()) errors.definition = 'Definition is required.'
  const order = Number(form.display_order)
  if (form.display_order !== '' && (!Number.isInteger(order) || order < 0)) errors.display_order = 'Must be a whole number (0 or above).'
  return errors
}

function FormDialog({ open, onClose, title, children, onSubmit, saving, submitLabel }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; onSubmit: () => void; saving: boolean; submitLabel: string }) {
  if (!open) return null
  return (
    <div className="vs-dialog-backdrop" {...dismissOnBackdrop(() => onClose())}>
      <div className="vs-dialog animate-fade-in" style={{ minWidth: 440 }} onClick={e => e.stopPropagation()}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div className="flex items-center justify-between" style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--color-divider)' }}>
          <h2 className="font-condensed" style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text)' }}>{title}</h2>
          <button className="vs-btn-icon" style={{ width: 28, height: 28 }} onClick={onClose}><X size={13} /></button>
        </div>
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
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

function FL({ label, required, children, hint, error }: { label: string; required?: boolean; children: React.ReactNode; hint?: string; error?: string }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-text)', marginBottom: 5 }}>
        {label}{required && <span aria-hidden="true" style={{ color: 'var(--color-accent-700)', marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {error && <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-800)', marginTop: 4 }}>{error}</p>}
      {hint && !error && <p style={{ fontSize: 11, color: 'var(--color-neutral-600)', marginTop: 4 }}>{hint}</p>}
    </div>
  )
}

export default function CoreValuesPage() {
  const [query, setQuery]             = useState('')
  const [showForm, setShowForm]       = useState(false)
  const [editing, setEditing]         = useState<CoreValue | null>(null)
  const [form, setForm]               = useState<CoreValueForm>(EMPTY_FORM)
  const [formErrors, setFormErrors]   = useState<FormErrors>({})
  const [saving, setSaving]           = useState(false)
  const [saveError, setSaveError]     = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<CoreValue | null>(null)

  const createCoreValue = useCreateCoreValue()
  const updateCoreValue = useUpdateCoreValue()
  const setCoreValueActive = useSetCoreValueActive()
  const debouncedQuery = useDebounce(query, SEARCH_DEBOUNCE_MS)

  /*
    Deleting a value archives it rather than removing the row: recognitions,
    badges, behaviours and scenarios all point at it, and the database refuses
    to delete what they reference. So "deleted" means gone from this screen
    and from the wizard, and still there for history and reports.

    activeOnly=false all the same, because the form needs the deleted values'
    slugs (see validate). Separate cache key from the wizard's active-only
    list, both served by referenceApi.listCoreValues.
  */
  const coreValuesQuery = useCoreValues(false)
  const allValues = coreValuesQuery.data ?? []
  const coreValues = allValues.filter(cv => cv.is_active)
  const loading = coreValuesQuery.isPending

  useEffect(() => {
    if (coreValuesQuery.error) {
      toast({ title: 'Failed to load Core Values', description: 'Please refresh the page.', variant: 'destructive' })
    }
  }, [coreValuesQuery.error])

  const displayed = coreValues.filter(cv => {
    const q = debouncedQuery.toLowerCase()
    const matchesQ = debouncedQuery.length < 2 || cv.name.toLowerCase().includes(q) || cv.definition.toLowerCase().includes(q) || cv.slug.toLowerCase().includes(q)
    return matchesQ
  })

  // After the last value listed, so a new one lands at the end.
  const nextOrder = coreValues.reduce((max, cv) => Math.max(max, cv.display_order + 1), 0)

  const openAdd = () => { setEditing(null); setForm({ ...EMPTY_FORM, display_order: String(nextOrder) }); setFormErrors({}); setSaveError(null); setShowForm(true) }
  const openEdit = (cv: CoreValue) => { setEditing(cv); setForm({ name: cv.name, slug: cv.slug, definition: cv.definition, icon: cv.icon, accent_color: cv.accent_color, display_order: String(cv.display_order) }); setFormErrors({}); setSaveError(null); setShowForm(true) }
  const closeForm = () => { setShowForm(false); setTimeout(() => { setEditing(null); setForm(EMPTY_FORM); setFormErrors({}); setSaveError(null) }, 200) }

  const handleNameChange = (value: string) => setForm(f => ({ ...f, name: value, slug: editing ? f.slug : toSlug(value) }))

  const save = async () => {
    const isNew = editing === null
    const errors = validate(form, isNew, allValues)
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return }
    setFormErrors({}); setSaveError(null); setSaving(true)
    if (editing) {
      try {
        await updateCoreValue.mutateAsync({ id: editing.id, name: form.name, definition: form.definition.trim(), icon: form.icon.trim() || 'star', accentColor: form.accent_color, displayOrder: Number(form.display_order) || 0 })
      } catch (err) {
        setSaveError(errorMessage(err, "Couldn't update this Core Value. Please try again.")); setSaving(false); return
      }
      toast({ title: `"${form.name.trim()}" updated`, variant: 'success' })
    } else {
      try {
        await createCoreValue.mutateAsync({ name: form.name, slug: form.slug.trim(), definition: form.definition.trim(), icon: form.icon.trim() || 'star', accentColor: form.accent_color, displayOrder: Number(form.display_order) || nextOrder })
      } catch (err) {
        setSaveError(errorMessage(err, "Couldn't save the Core Value. Please try again.")); setSaving(false); return
      }
      toast({ title: `"${form.name.trim()}" added`, variant: 'success' })
    }
    // The mutations invalidate the core-value lists themselves.
    setSaving(false); closeForm()
  }

  const deleteValue = async () => {
    if (!confirmTarget) return
    try {
      await setCoreValueActive.mutateAsync({ id: confirmTarget.id, isActive: false })
      toast({ title: `"${confirmTarget.name}" deleted`, variant: 'success' })
    } catch (err) {
      toast({ title: 'Could not delete', description: errorMessage(err, 'Please try again.'), variant: 'destructive' })
    }
    setConfirmTarget(null)
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        kicker="HR Manage"
        title="Core Values"
        subtitle="Manage the values that define how we work and recognize great behaviour at Touchcore."
        actions={
          <button className="vs-btn vs-btn-primary relative" onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <Plus size={13} aria-hidden="true" /> Add Core Value
          </button>
        }
      />

      {/* Search. No status filter: a deleted value is not listed, so every row here is active. */}
      {!loading && coreValues.length > 0 && (
        <div className="relative" style={{ maxWidth: 280 }}>
          <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-neutral-500)', pointerEvents: 'none' }} aria-hidden="true" />
          <input type="search" className="vs-input w-full" style={{ paddingLeft: 28, height: 32, fontSize: 13 }} placeholder="Search core values…" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search core values" />
        </div>
      )}

      {loading ? <TableSkeleton rows={5} /> : coreValues.length === 0 ? (
        <EmptyState icon={<Star size={36} />} title="No core values configured yet." description="Add your first Core Value to start building the recognition framework." action={{ label: 'Add Core Value', onClick: openAdd }} />
      ) : displayed.length === 0 ? (
        <EmptyState icon={<Search size={36} />} title="No results" description={`No core values match "${query}".`} className="py-10" />
      ) : (
        <div className="vs-card" style={{ overflow: 'hidden' }}>
          <table className="vs-table w-full">
            <thead>
              <tr style={{ background: 'color-mix(in srgb, var(--color-neutral-300) 30%, transparent)' }}>
                <th>Core Value</th>
                <th className="hidden md:table-cell">Slug</th>
                <th className="hidden lg:table-cell">Icon</th>
                <th className="hidden lg:table-cell">Order</th>
                <th style={{ width: 72 }} />
              </tr>
            </thead>
            <tbody>
              {displayed.map(cv => (
                <tr key={cv.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: cv.accent_color, flexShrink: 0, border: '1px solid var(--color-divider)' }} aria-hidden="true" />
                      <div>
                        <p style={{ fontWeight: 500, color: 'var(--color-text)', fontSize: 13 }}>{cv.name}</p>
                        <p className="hidden sm:block line-clamp-1" style={{ fontSize: 12, color: 'var(--color-neutral-600)', maxWidth: 280 }}>{cv.definition}</p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden md:table-cell"><code style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--color-neutral-600)', background: 'color-mix(in srgb, var(--color-neutral-300) 30%, transparent)', padding: '2px 6px' }}>{cv.slug}</code></td>
                  <td className="hidden lg:table-cell"><code style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--color-neutral-600)' }}>{cv.icon}</code></td>
                  <td className="hidden lg:table-cell" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-700)', fontSize: 13 }}>{cv.display_order}</td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      <button className="vs-btn-icon" style={{ width: 28, height: 28 }} onClick={() => openEdit(cv)} aria-label={`Edit ${cv.name}`} title="Edit"><Edit2 size={12} /></button>
                      <button className="vs-btn-icon" style={{ width: 28, height: 28 }} onClick={() => setConfirmTarget(cv)} aria-label={`Delete ${cv.name}`} title="Delete"><Trash2 size={12} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FormDialog open={showForm} onClose={closeForm} title={editing ? `Edit "${editing.name}"` : 'Add Core Value'} onSubmit={save} saving={saving} submitLabel={editing ? 'Save changes' : 'Add Core Value'}>
        <FL label="Name" required error={formErrors.name}><Input id="cv-name" placeholder="e.g. Collaborative" value={form.name} onChange={e => handleNameChange(e.target.value)} autoFocus /></FL>
        {!editing && <FL label="Slug" required error={formErrors.slug} hint="Lowercase letters, numbers and hyphens only. Cannot be changed after saving."><Input id="cv-slug" placeholder="e.g. collaborative" value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} /></FL>}
        <FL label="Definition" required error={formErrors.definition}><Textarea id="cv-definition" placeholder="Describe what this Core Value means…" value={form.definition} onChange={e => setForm(f => ({ ...f, definition: e.target.value }))} /></FL>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FL label="Icon name" hint="Lucide icon name"><Input id="cv-icon" placeholder="e.g. users" value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} /></FL>
          <FL label="Accent colour">
            <div className="flex items-center gap-2">
              <input type="color" value={form.accent_color} onChange={e => setForm(f => ({ ...f, accent_color: e.target.value }))} style={{ height: 36, width: 42, border: '1px solid var(--color-divider)', cursor: 'pointer', background: 'var(--color-surface)', padding: 2 }} aria-label="Accent colour picker" />
              <Input value={form.accent_color} onChange={e => setForm(f => ({ ...f, accent_color: e.target.value }))} placeholder="#c42a20" style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 }} aria-label="Accent colour hex" />
            </div>
          </FL>
        </div>
        <FL label="Display order" error={formErrors.display_order} hint="Lower numbers appear first."><Input id="cv-order" type="number" min={0} placeholder="0" value={form.display_order} onChange={e => setForm(f => ({ ...f, display_order: e.target.value }))} style={{ width: 100 }} /></FL>
        {saveError && <div role="alert" style={{ padding: '10px 12px', border: '1px solid var(--color-accent-400)', background: 'color-mix(in srgb, var(--color-accent) 6%, var(--color-bg))', fontSize: 13, color: 'var(--color-accent-800)' }}>{saveError}</div>}
      </FormDialog>

      <ConfirmModal
        open={confirmTarget !== null}
        onOpenChange={open => { if (!open) setConfirmTarget(null) }}
        title={`Delete "${confirmTarget?.name}"?`}
        description="It will be removed from this list and from the recognition wizard. Recognitions already given for it are kept, so history and reports stay accurate."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={deleteValue}
      />
    </div>
  )
}
