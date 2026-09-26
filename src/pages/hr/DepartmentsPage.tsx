import React, { useState } from 'react'
import { Plus, Trash2, Edit2, Building2, X, RotateCcw } from 'lucide-react'
import {
  useDepartments, useCreateDepartment, useUpdateDepartment, useSetDepartmentActive,
  useDeleteDepartment, useDepartmentMemberCount,
} from '@/hooks/queries'
import { errorMessage } from '@/lib/query'
import type { Department } from '@/types'
import { PageHeader } from '@/components/shared/PageHeader'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { TableSkeleton } from '@/components/shared/SkeletonLoader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmModal } from '@/components/shared/ConfirmModal'
import { dismissOnBackdrop } from '@/lib/backdrop'

function FormDialog({
  open,
  onClose,
  title,
  children,
  onSubmit,
  saving,
  submitLabel,
  error,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  onSubmit: () => void
  saving: boolean
  submitLabel: string
  error?: string | null
}) {
  if (!open) return null

  return (
    <div
      className="vs-dialog-backdrop"
      {...dismissOnBackdrop(() => onClose())}
    >
      <div
        className="vs-dialog animate-fade-in"
        style={{ minWidth: 420 }}
        onClick={e => e.stopPropagation()}
      >
        <i className="corner tl" />
        <i className="corner tr" />
        <i className="corner bl" />
        <i className="corner br" />
        <div
          className="flex items-center justify-between"
          style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--color-divider)' }}
        >
          <h2
            className="font-condensed"
            style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text)' }}
          >
            {title}
          </h2>
          <button
            className="vs-btn-icon"
            style={{ width: 28, height: 28 }}
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={13} />
          </button>
        </div>
        <div
          style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          {children}
          {/* A refused write keeps the dialog open and says why. */}
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        </div>
        <div
          className="flex justify-end gap-2"
          style={{ padding: '12px 18px', borderTop: '1px solid var(--color-divider)' }}
        >
          <button className="vs-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="vs-btn vs-btn-primary relative"
            onClick={onSubmit}
            disabled={saving}
            aria-busy={saving}
          >
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            {saving ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function FL({
  label,
  required,
  optional,
  children,
}: {
  label: string
  required?: boolean
  optional?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--color-text)',
          marginBottom: 5,
        }}
      >
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: 'var(--color-accent-700)', marginLeft: 3 }}>
            *
          </span>
        )}
        {optional && (
          <span style={{ fontSize: 11, color: 'var(--color-neutral-600)', marginLeft: 6 }}>
            (optional)
          </span>
        )}
      </label>
      {children}
    </div>
  )
}

/**
 * What removing this department will actually do.
 *
 * Three cases, because "removes it permanently" is only the whole truth when
 * nobody is in it. Anyone who is gets left with no department — recoverable
 * only by reassigning them one at a time, which is worth saying plainly while
 * the button can still not be clicked.
 */
function removalDescription(members: number | undefined, loading: boolean): string {
  const permanent = 'This cannot be undone.'

  if (loading || members === undefined) {
    return `This department will be removed permanently, and anyone in it will be left without a department. ${permanent}`
  }

  if (members === 0) {
    return `This department will be removed permanently. Nobody is assigned to it. ${permanent}`
  }

  return members === 1
    ? `This department will be removed permanently. 1 employee is in it and will be left without a department. ${permanent}`
    : `This department will be removed permanently. ${members} employees are in it and will be left without a department. ${permanent}`
}

export default function DepartmentsPage() {
  /*
    Every department, archived ones included: this is the screen that restores
    them. The dropdowns elsewhere use the default active-only list, and the two
    are separate cache entries.
  */
  const departmentsQuery = useDepartments(false)
  const createDepartment = useCreateDepartment()
  const updateDepartment = useUpdateDepartment()
  const setActive        = useSetDepartmentActive()
  const removeDepartment = useDeleteDepartment()

  const departments = departmentsQuery.data ?? []
  const loading = departmentsQuery.isPending

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Department | null>(null)
  const [form, setForm] = useState({ name: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Restoring an archived department — kept so any department archived before
  // removal existed is not stranded on this screen with no way back.
  const [confirmRestore, setConfirmRestore] = useState<Department | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)

  /*
    Removal. Separate state from the restore confirmation because the two ask
    genuinely different questions: one is reversible and one is not.
  */
  const [confirmRemove, setConfirmRemove] = useState<Department | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  // Only fetched once something is actually up for removal.
  const memberCount = useDepartmentMemberCount(confirmRemove?.id ?? null)

  const openAdd = () => {
    setEditing(null)
    setForm({ name: '', description: '' })
    setSaveError(null)
    setShowForm(true)
  }

  const openEdit = (d: Department) => {
    setEditing(d)
    setForm({ name: d.name, description: d.description ?? '' })
    setSaveError(null)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setSaveError(null)
  }

  const save = async () => {
    if (!form.name.trim()) {
      setSaveError('A name is required.')
      return
    }

    setSaving(true)
    setSaveError(null)

    const fields = { name: form.name, description: form.description || null }

    try {
      if (editing) await updateDepartment.mutateAsync({ id: editing.id, ...fields })
      else await createDepartment.mutateAsync(fields)
    } catch (err) {
      /*
        Refused by the database — RLS, the 2FA gate, or the UNIQUE constraint
        on the name. Keep the dialog open with the typed values still in it.
        Nothing is invalidated: the mutation's onSuccess never ran.
      */
      setSaveError(errorMessage(err, 'Could not save that department. Please try again.'))
      setSaving(false)
      return
    }

    setSaving(false)
    closeForm()
  }

  const restore = async () => {
    if (!confirmRestore) return

    setToggleError(null)

    try {
      await setActive.mutateAsync({ id: confirmRestore.id, isActive: true })
    } catch (err) {
      // Leave the confirmation open and explain, rather than closing on a
      // refusal — which reads as the click having done nothing at all.
      setToggleError(errorMessage(err, 'Could not update that department. Please try again.'))
      return
    }

    setConfirmRestore(null)
  }

  const remove = async () => {
    if (!confirmRemove) return

    setRemoveError(null)

    try {
      await removeDepartment.mutateAsync({ id: confirmRemove.id })
    } catch (err) {
      setRemoveError(errorMessage(err, 'Could not remove that department. Please try again.'))
      return
    }

    setConfirmRemove(null)
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        kicker="HR Manage"
        title="Departments"
        subtitle="Manage company departments and organizational units."
        actions={
          <button
            className="vs-btn vs-btn-primary relative"
            onClick={openAdd}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <Plus size={13} aria-hidden="true" /> Add Department
          </button>
        }
      />

      {loading ? (
        <TableSkeleton />
      ) : departments.length === 0 ? (
        <EmptyState
          icon={<Building2 size={36} />}
          title="No departments yet"
          description="Add your first department to organize your team."
          action={{ label: 'Add Department', onClick: openAdd }}
        />
      ) : (
        <div className="vs-card" style={{ overflow: 'hidden' }}>
          <div className="overflow-x-auto">
            <table className="vs-table w-full" style={{ minWidth: 480 }}>
              <thead>
                <tr style={{ background: 'color-mix(in srgb, var(--color-neutral-300) 30%, transparent)' }}>
                  <th>Department</th>
                  <th className="hidden md:table-cell">Description</th>
                  <th>Status</th>
                  <th style={{ width: 72 }} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {departments.map(d => (
                  <tr key={d.id}>
                    <td>
                      <p style={{ fontWeight: 500, color: 'var(--color-text)', fontSize: 13 }}>
                        {d.name}
                      </p>
                    </td>
                    <td className="hidden md:table-cell">
                      {d.description ? (
                        <p className="line-clamp-1" style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>
                          {d.description}
                        </p>
                      ) : (
                        <span style={{ color: 'var(--color-neutral-400)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <span className={`vs-tag ${d.is_active ? 'vs-tag-accent' : 'vs-tag-neutral'}`}>
                        {d.is_active ? 'Active' : 'Archived'}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          className="vs-btn-icon"
                          style={{ width: 28, height: 28 }}
                          onClick={() => openEdit(d)}
                          aria-label={`Edit ${d.name}`}
                        >
                          <Edit2 size={12} />
                        </button>
                        {/*
                          Restore is offered only for a department that is
                          already archived. Nothing on this screen can archive
                          one any more — removal replaced it — but rows
                          archived before that change still need a way back.
                        */}
                        {!d.is_active && (
                          <button
                            className="vs-btn-icon"
                            style={{ width: 28, height: 28 }}
                            onClick={() => setConfirmRestore(d)}
                            aria-label={`Restore ${d.name}`}
                            title="Restore"
                          >
                            <RotateCcw size={12} />
                          </button>
                        )}
                        <button
                          className="vs-btn-icon"
                          style={{ width: 28, height: 28 }}
                          onClick={() => { setRemoveError(null); setConfirmRemove(d) }}
                          aria-label={`Remove ${d.name}`}
                          title="Remove"
                        >
                          <Trash2 size={12} />
                        </button>
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
        onClose={closeForm}
        title={editing ? 'Edit Department' : 'Add Department'}
        onSubmit={save}
        saving={saving}
        submitLabel={editing ? 'Save changes' : 'Add Department'}
        error={saveError}
      >
        <FL label="Department Name" required>
          <Input
            placeholder="e.g. Engineering, Sales, Marketing"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            autoFocus
          />
        </FL>
        <FL label="Description" optional>
          <Textarea
            placeholder="Brief description of the department's role or focus"
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            style={{ minHeight: 80 }}
          />
        </FL>
      </FormDialog>

      <ConfirmModal
        open={!!confirmRestore}
        onOpenChange={() => { setConfirmRestore(null); setToggleError(null) }}
        title={`Restore ${confirmRestore?.name}?`}
        description={
          toggleError
            ?? 'This department will be available again for new employees and recognitions.'
        }
        confirmLabel="Restore"
        onConfirm={restore}
        loading={setActive.isPending}
      />

      {/*
        Removal names the headcount before the click, because detaching people
        is the part that is not obvious from the word "remove". The count is
        still loading on the first frame, so the copy is written to read
        correctly either way rather than flashing a wrong number.
      */}
      <ConfirmModal
        open={!!confirmRemove}
        onOpenChange={() => { setConfirmRemove(null); setRemoveError(null) }}
        title={`Remove ${confirmRemove?.name}?`}
        description={removeError ?? removalDescription(memberCount.data, memberCount.isPending)}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={remove}
        loading={removeDepartment.isPending}
      />
    </div>
  )
}
