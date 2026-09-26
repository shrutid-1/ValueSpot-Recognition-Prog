import React, { useMemo, useState } from 'react'
import { Plus, Archive, Edit2, FolderKanban, X, RotateCcw, Trash2 } from 'lucide-react'
import {
  useProjectsWithManager, useCreateProject, useUpdateProject, useSetProjectActive,
  useDeleteProject, useEligibleProjectManagers,
} from '@/hooks/queries'
import { errorMessage } from '@/lib/query'
import { toast } from '@/hooks/use-toast'
import type { ProjectWithManager } from '@/lib/api'
import { PageHeader } from '@/components/shared/PageHeader'
import { Input } from '@/components/ui/input'
import { TableSkeleton } from '@/components/shared/SkeletonLoader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmModal } from '@/components/shared/ConfirmModal'
import { dismissOnBackdrop } from '@/lib/backdrop'

/** The row shape is the API's — see ProjectWithManager in lib/api/reference. */
type ProjectRow = ProjectWithManager

/**
 * Which projects the table shows.
 *
 * Defaults to 'active'. The list query returns archived projects too, because
 * this is the only screen that can restore one — but leaving them mixed into
 * the default view made archiving look like it had done nothing at all.
 */
type StatusFilter = 'active' | 'archived' | 'all'

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

function FL({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-text)', marginBottom: 5 }}>
        {label}{optional && <span style={{ fontSize: 11, color: 'var(--color-neutral-600)', marginLeft: 6 }}>(optional)</span>}
      </label>
      {children}
    </div>
  )
}

export default function ProjectsPage() {
  const projectsQuery = useProjectsWithManager()
  const createProject = useCreateProject()
  const updateProject = useUpdateProject()
  const setProjectActive = useSetProjectActive()
  const deleteProject = useDeleteProject()

  /*
    Managers eligible to RUN a project — role 'manager' only.

    The project's manager approves every recognition
    filed against it, and guard_project_manager() refuses anyone who is not a
    Manager, so a wider list would produce names the database rejects on save.
  */
  const managers = useEligibleProjectManagers().data ?? []

  // Memoised because the `?? []` fallback is a fresh array on every render,
  // which would re-run the filter memos below each time.
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
  const loading = projectsQuery.isPending

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing]   = useState<ProjectRow | null>(null)
  const [form, setForm]         = useState({ name: '', description: '', project_code: '', manager_id: '' })
  const [saving, setSaving]     = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [status, setStatus] = useState<StatusFilter>('active')

  /* Archive and restore are the same confirmation, read off the target's own state. */
  const [confirmToggle, setConfirmToggle] = useState<ProjectRow | null>(null)
  const [toggleError, setToggleError]     = useState<string | null>(null)

  /* Deletion is permanent and separate — never folded into the toggle. */
  const [confirmDelete, setConfirmDelete] = useState<ProjectRow | null>(null)
  const [deleteError, setDeleteError]     = useState<string | null>(null)

  const visible = useMemo(() => projects.filter(p =>
    status === 'all' || (status === 'active' ? p.is_active : !p.is_active),
  ), [projects, status])

  const archivedCount = useMemo(
    () => projects.filter(p => !p.is_active).length,
    [projects],
  )

  const openAdd  = () => { setEditing(null); setForm({ name: '', description: '', project_code: '', manager_id: '' }); setSaveError(null); setShowForm(true) }
  const openEdit = (p: ProjectRow) => { setEditing(p); setForm({ name: p.name, description: p.description ?? '', project_code: p.project_code ?? '', manager_id: p.manager_id ?? '' }); setSaveError(null); setShowForm(true) }
  const closeForm = () => { setShowForm(false); setSaveError(null) }

  const save = async () => {
    if (!form.name.trim()) { setSaveError('A name is required.'); return }

    /*
      Mandatory since 029: the Project Manager is who approves recognitions
      filed against this project, so a project without one cannot route.
      The database enforces this as well — this check exists to say so in
      plain words before the round trip.
    */
    if (!form.manager_id) { setSaveError('Project Manager is required.'); return }

    setSaving(true); setSaveError(null)

    const fields = {
      name: form.name,
      description: form.description || null,
      projectCode: form.project_code || null,
      managerId: form.manager_id,
    }

    try {
      if (editing) await updateProject.mutateAsync({ id: editing.id, ...fields })
      else await createProject.mutateAsync(fields)
    } catch (err) {
      /*
        Refused by the database — RLS, the 2FA gate, or the UNIQUE constraint
        on project_code. Keep the dialog open with the typed values in it;
        nothing is invalidated, because onSuccess never ran.
      */
      setSaveError(errorMessage(err, 'Could not save that project. Please try again.'))
      setSaving(false)
      return
    }

    setSaving(false); closeForm()
  }

  const toggleActive = async () => {
    if (!confirmToggle) return
    const nowActive = !confirmToggle.is_active

    setToggleError(null)

    try {
      await setProjectActive.mutateAsync({ id: confirmToggle.id, isActive: nowActive })
    } catch (err) {
      // Leave the confirmation open and explain. Closing on a refusal reads
      // as the click having done nothing, which is the complaint this screen
      // started with.
      setToggleError(errorMessage(err, 'Could not update that project. Please try again.'))
      return
    }

    toast({
      title: nowActive
        ? `"${confirmToggle.name}" restored`
        : `"${confirmToggle.name}" archived`,
      variant: 'success',
    })
    setConfirmToggle(null)
  }

  const remove = async () => {
    if (!confirmDelete) return

    setDeleteError(null)

    try {
      await deleteProject.mutateAsync({ id: confirmDelete.id })
    } catch (err) {
      /*
        Most often this is the foreign key: recognitions or team assignments
        reference the project, so the database refuses. The message says to
        archive instead, and the modal stays open next to the Archive action.
      */
      setDeleteError(errorMessage(err, 'Could not delete that project. Please try again.'))
      return
    }

    toast({ title: `"${confirmDelete.name}" deleted`, variant: 'success' })
    setConfirmDelete(null)
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        kicker="HR Manage"
        title="Projects"
        subtitle="Manage client and internal projects for recognition tagging."
        actions={
          <button className="vs-btn vs-btn-primary relative" onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <Plus size={13} aria-hidden="true" /> Add Project
          </button>
        }
      />

      {!loading && projects.length > 0 && (
        <div className="flex items-center gap-2">
          <label htmlFor="project-status" style={{ fontSize: 13, color: 'var(--color-neutral-700)' }}>Show</label>
          <select
            id="project-status"
            className="vs-input"
            style={{ width: 'auto', minWidth: 150 }}
            value={status}
            onChange={e => setStatus(e.target.value as StatusFilter)}
          >
            <option value="active">Active projects</option>
            <option value="archived">Archived ({archivedCount})</option>
            <option value="all">All projects</option>
          </select>
        </div>
      )}

      {loading ? <TableSkeleton /> : projects.length === 0 ? (
        <EmptyState icon={<FolderKanban size={36} />} title="No projects yet" description="Add projects so employees can tag their recognitions to client or internal work." action={{ label: 'Add Project', onClick: openAdd }} />
      ) : visible.length === 0 ? (
        /*
          Projects exist but none match the filter — a different situation from
          having none at all, and offering "Add Project" here would be the
          wrong suggestion.
        */
        <EmptyState
          icon={<FolderKanban size={36} />}
          title={status === 'archived' ? 'No archived projects' : 'No active projects'}
          description={status === 'archived'
            ? 'Projects you archive will appear here, where they can be restored.'
            : 'Every project is archived. Switch the filter to Archived to restore one.'}
        />
      ) : (
        <div className="vs-card" style={{ overflow: 'hidden' }}>
          <div className="overflow-x-auto">
            <table className="vs-table w-full" style={{ minWidth: 480 }}>
              <thead>
                <tr style={{ background: 'color-mix(in srgb, var(--color-neutral-300) 30%, transparent)' }}>
                  <th>Project</th>
                  <th className="hidden sm:table-cell">Code</th>
                  <th className="hidden md:table-cell">Manager</th>
                  <th className="hidden lg:table-cell">Members</th>
                  <th>Status</th>
                  <th style={{ width: 104 }} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {visible.map(p => (
                  <tr key={p.id}>
                    <td>
                      <p style={{ fontWeight: 500, color: 'var(--color-text)', fontSize: 13 }}>{p.name}</p>
                      {p.description && <p className="line-clamp-1" style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 2 }}>{p.description}</p>}
                    </td>
                    <td className="hidden sm:table-cell">
                      {p.project_code ? <code style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--color-neutral-600)', background: 'color-mix(in srgb, var(--color-neutral-300) 30%, transparent)', padding: '2px 6px' }}>{p.project_code}</code> : <span style={{ color: 'var(--color-neutral-400)' }}>—</span>}
                    </td>
                    <td className="hidden md:table-cell" style={{ color: 'var(--color-neutral-700)', fontSize: 13 }}>
                      {(p.manager as { full_name: string } | null)?.full_name ?? <span style={{ color: 'var(--color-neutral-400)' }}>—</span>}
                    </td>
                    {/*
                      Who is on the project, by name. This is where an employee
                      who picked this project while creating their account shows
                      up, with no administrative step in between.
                    */}
                    <td className="hidden lg:table-cell" style={{ color: 'var(--color-neutral-700)', fontSize: 12.5 }}>
                      {p.members.length === 0
                        ? <span style={{ color: 'var(--color-neutral-400)' }}>—</span>
                        : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {p.members.slice(0, 3).map(m => <span key={m.id}>{m.full_name}</span>)}
                            {p.members.length > 3 && (
                              <span style={{ color: 'var(--color-neutral-600)' }}>
                                +{p.members.length - 3} more
                              </span>
                            )}
                          </div>
                        )}
                    </td>
                    <td><span className={`vs-tag ${p.is_active ? 'vs-tag-accent' : 'vs-tag-neutral'}`}>{p.is_active ? 'Active' : 'Archived'}</span></td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <button className="vs-btn-icon" style={{ width: 28, height: 28 }} onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}><Edit2 size={12} /></button>
                        {/*
                          Archived projects were previously a dead end: the
                          only action disappeared with the Archive button, so
                          nothing could bring one back.
                        */}
                        <button
                          className="vs-btn-icon"
                          style={{ width: 28, height: 28 }}
                          onClick={() => { setToggleError(null); setConfirmToggle(p) }}
                          aria-label={p.is_active ? `Archive ${p.name}` : `Restore ${p.name}`}
                        >
                          {p.is_active ? <Archive size={12} /> : <RotateCcw size={12} />}
                        </button>
                        <button
                          className="vs-btn-icon"
                          style={{ width: 28, height: 28 }}
                          onClick={() => { setDeleteError(null); setConfirmDelete(p) }}
                          aria-label={`Delete ${p.name}`}
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

      <FormDialog open={showForm} onClose={closeForm} title={editing ? 'Edit Project' : 'Add Project'} onSubmit={save} saving={saving} submitLabel={editing ? 'Save changes' : 'Add Project'} error={saveError}>
        <FL label="Project Name"><Input placeholder="e.g. ABC Client Portal" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus /></FL>
        <FL label="Project Code" optional><Input placeholder="e.g. PROJ-001" value={form.project_code} onChange={e => setForm(f => ({ ...f, project_code: e.target.value }))} /></FL>
        <FL label="Description" optional><Input placeholder="Brief description of the project" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></FL>
        <FL label="Project Manager">
          <select
            className="vs-input w-full"
            value={form.manager_id}
            onChange={e => setForm(f => ({ ...f, manager_id: e.target.value }))}
            aria-label="Project Manager"
            required
          >
            <option value="">Select a manager…</option>
            {managers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </select>
          <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 5, lineHeight: 1.45 }}>
            Approves every recognition filed against this project. Changing it
            affects new recognitions only — anything already awaiting approval
            stays with the manager it was sent to.
          </p>
          {managers.length === 0 && (
            <p className="text-sm text-danger" role="alert" style={{ marginTop: 5 }}>
              No Manager accounts exist yet. Create one before adding a project.
            </p>
          )}
        </FL>
      </FormDialog>

      <ConfirmModal
        open={confirmToggle !== null}
        onOpenChange={open => { if (!open) { setConfirmToggle(null); setToggleError(null) } }}
        title={confirmToggle?.is_active
          ? `Archive "${confirmToggle?.name}"?`
          : `Restore "${confirmToggle?.name}"?`}
        description={
          toggleError
          ?? (confirmToggle?.is_active
            ? 'It will no longer be offered in the recognition wizard. Existing recognitions keep it and stay readable, and you can restore it later.'
            : 'It will be offered in the recognition wizard again.')
        }
        confirmLabel={confirmToggle?.is_active ? 'Archive' : 'Restore'}
        variant={confirmToggle?.is_active ? 'destructive' : 'default'}
        onConfirm={toggleActive}
        loading={setProjectActive.isPending}
      />

      <ConfirmModal
        open={confirmDelete !== null}
        onOpenChange={open => { if (!open) { setConfirmDelete(null); setDeleteError(null) } }}
        title={`Delete "${confirmDelete?.name}" permanently?`}
        description={
          deleteError
          ?? 'This cannot be undone. It only works if nothing uses the project yet — if any recognition or team assignment references it, the database will refuse and you can archive it instead.'
        }
        confirmLabel="Delete permanently"
        variant="destructive"
        onConfirm={remove}
        loading={deleteProject.isPending}
      />
    </div>
  )
}
