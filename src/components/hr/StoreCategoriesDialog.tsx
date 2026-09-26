import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, Edit2, Plus, Trash2, X } from 'lucide-react'
import type { Reward, StoreCategory } from '@/types'
import {
  useStoreCategories, useCreateStoreCategory, useUpdateStoreCategory,
  useReorderStoreCategories, useDeleteStoreCategory,
} from '@/hooks/queries'
import { STORE_CATEGORY_LABEL_MAX } from '@/lib/api'
import { errorMessage } from '@/lib/query'
import { dismissOnBackdrop } from '@/lib/backdrop'
import { Input } from '@/components/ui/input'
import {
  CATEGORY_ICONS, DEFAULT_CATEGORY_ICON, iconFor,
} from '@/components/experience/rewardMarks'

/**
 * The Value Store's shelves, as HR and a Super Admin edit them (062).
 *
 * Add, rename, re-icon, reorder and remove, all in one dialog opened from the
 * Rewards screen — the shelves only mean anything next to the rewards on them.
 *
 * REMOVING A SHELF THAT HAS REWARDS ON IT
 * ---------------------------------------
 * Asks where they go, in the same row, before anything happens. The count
 * shown is read from the catalogue the page already holds; it is for the
 * person deciding, not a permission — delete_reward_category() re-counts
 * under a lock and refuses if rewards arrived and no destination was named.
 */
export function StoreCategoriesDialog({
  open,
  onClose,
  rewards,
}: {
  open: boolean
  onClose: () => void
  /** Every reward, active or not, so each shelf can say how many it holds. */
  rewards: Reward[]
}) {
  const categoriesQuery = useStoreCategories()
  const createCategory = useCreateStoreCategory()
  const updateCategory = useUpdateStoreCategory()
  const reorderCategories = useReorderStoreCategories()
  const deleteCategory = useDeleteStoreCategory()

  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data])

  const [newLabel, setNewLabel] = useState('')
  const [newIcon, setNewIcon] = useState(DEFAULT_CATEGORY_ICON)

  const [editingSlug, setEditingSlug] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editIcon, setEditIcon] = useState(DEFAULT_CATEGORY_ICON)

  const [removingSlug, setRemovingSlug] = useState<string | null>(null)
  const [moveTo, setMoveTo] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const busy =
    createCategory.isPending || updateCategory.isPending ||
    reorderCategories.isPending || deleteCategory.isPending

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rewards) m.set(r.category, (m.get(r.category) ?? 0) + 1)
    return m
  }, [rewards])

  // A fresh start each time it opens, so a half-finished edit from last time
  // is not waiting there.
  useEffect(() => {
    if (!open) return
    setNewLabel(''); setNewIcon(DEFAULT_CATEGORY_ICON)
    setEditingSlug(null); setRemovingSlug(null)
    setError(null); setNotice(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  const say = (message: string | null) => { setNotice(message); setError(null) }
  const fail = (err: unknown, fallback: string) => { setError(errorMessage(err, fallback)); setNotice(null) }

  const add = async () => {
    const label = newLabel.trim()
    if (!label) { setError('Give the category a name.'); return }
    try {
      const created = await createCategory.mutateAsync({ label, icon: newIcon })
      setNewLabel(''); setNewIcon(DEFAULT_CATEGORY_ICON)
      say(`Added ${created.label}. It appears in the Value Store once a reward is placed on it.`)
    } catch (err) {
      fail(err, 'Could not add that category.')
    }
  }

  const startEdit = (c: StoreCategory) => {
    setRemovingSlug(null)
    setEditingSlug(c.slug); setEditLabel(c.label); setEditIcon(c.icon)
    setError(null); setNotice(null)
  }

  const saveEdit = async (c: StoreCategory) => {
    const label = editLabel.trim()
    if (!label) { setError('Give the category a name.'); return }
    try {
      await updateCategory.mutateAsync({
        slug: c.slug,
        ...(label !== c.label ? { label } : {}),
        ...(editIcon !== c.icon ? { icon: editIcon } : {}),
      })
      setEditingSlug(null)
      say(null)
    } catch (err) {
      fail(err, 'Could not save that category.')
    }
  }

  const move = async (index: number, by: -1 | 1) => {
    const target = index + by
    if (target < 0 || target >= categories.length) return
    const next = [...categories]
    ;[next[index], next[target]] = [next[target], next[index]]
    try {
      await reorderCategories.mutateAsync(next)
      say(null)
    } catch (err) {
      fail(err, 'Could not reorder the categories.')
    }
  }

  const startRemove = (c: StoreCategory) => {
    setEditingSlug(null)
    setRemovingSlug(c.slug)
    // Pre-select the first other shelf, so the common case is one click.
    setMoveTo(categories.find(o => o.slug !== c.slug)?.slug ?? '')
    setError(null); setNotice(null)
  }

  const confirmRemove = async (c: StoreCategory) => {
    try {
      const { rewardsMoved } = await deleteCategory.mutateAsync({
        slug: c.slug,
        // Sent even when the page counted none: if a reward was placed on it
        // since, the database moves it here rather than refusing.
        moveTo: moveTo || null,
      })
      setRemovingSlug(null)
      const dest = categories.find(o => o.slug === moveTo)?.label
      say(
        rewardsMoved > 0 && dest
          ? `Removed ${c.label}. ${rewardsMoved} ${rewardsMoved === 1 ? 'reward' : 'rewards'} moved to ${dest}.`
          : `Removed ${c.label}.`,
      )
    } catch (err) {
      fail(err, 'Could not remove that category.')
    }
  }

  return createPortal(
    <div
      className="vs-dialog-backdrop"
      {...dismissOnBackdrop(() => { if (!busy) onClose() })}
      role="dialog"
      aria-modal="true"
      aria-labelledby="store-categories-title"
    >
      <div
        className="vs-dialog"
        style={{ width: 'min(560px, 100%)', animation: 'vs-rise 200ms ease-out both' }}
        onClick={e => e.stopPropagation()}
      >
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />

        <div className="flex items-start justify-between" style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--color-divider)' }}>
          <div>
            <h2 id="store-categories-title" className="font-condensed" style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text)' }}>
              Store categories
            </h2>
            <p style={{ fontSize: 12.5, color: 'var(--color-neutral-600)', marginTop: 3, lineHeight: 1.5 }}>
              The shelves employees browse in the Value Store, in the order shown here.
            </p>
          </div>
          <button className="vs-btn-icon" style={{ width: 28, height: 28, flexShrink: 0 }} onClick={onClose} disabled={busy} aria-label="Close">
            <X size={13} />
          </button>
        </div>

        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {categoriesQuery.isPending ? (
            <p style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>Loading categories…</p>
          ) : categoriesQuery.isError ? (
            <p className="text-sm text-danger" role="alert">
              {errorMessage(categoriesQuery.error, 'Could not load the store categories.')}
            </p>
          ) : (
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 6 }} aria-label="Store categories">
              {categories.map((c, i) => {
                const Mark = iconFor(c.icon)
                const onShelf = counts.get(c.slug) ?? 0
                const isLast = categories.length <= 1

                if (editingSlug === c.slug) {
                  return (
                    <li key={c.slug} style={rowStyle(true)}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
                        <Input
                          value={editLabel}
                          maxLength={STORE_CATEGORY_LABEL_MAX}
                          onChange={e => setEditLabel(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void saveEdit(c) }}
                          aria-label="Category name"
                          autoFocus
                        />
                        <IconPicker value={editIcon} onChange={setEditIcon} />
                        <div className="flex justify-end gap-2">
                          <button className="vs-btn" onClick={() => setEditingSlug(null)} disabled={busy}>Cancel</button>
                          <button className="vs-btn vs-btn-primary" onClick={() => void saveEdit(c)} disabled={busy} aria-busy={updateCategory.isPending}>
                            {updateCategory.isPending ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                }

                if (removingSlug === c.slug) {
                  const others = categories.filter(o => o.slug !== c.slug)
                  return (
                    <li key={c.slug} style={rowStyle(true)}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
                        <p style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.5 }}>
                          {onShelf === 0
                            ? <>Remove <strong>{c.label}</strong>? No rewards are in it.</>
                            : <>Remove <strong>{c.label}</strong>? {onShelf === 1 ? 'Its 1 reward' : `Its ${onShelf} rewards`} will move to the category you choose. Prices, validity and past redemptions are unchanged.</>}
                        </p>
                        {onShelf > 0 && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text)' }}>
                            Move to
                            <select
                              className="vs-input"
                              style={{ flex: 1 }}
                              value={moveTo}
                              onChange={e => setMoveTo(e.target.value)}
                            >
                              {others.map(o => <option key={o.slug} value={o.slug}>{o.label}</option>)}
                            </select>
                          </label>
                        )}
                        <div className="flex justify-end gap-2">
                          <button className="vs-btn" onClick={() => setRemovingSlug(null)} disabled={busy}>Cancel</button>
                          <button
                            className="vs-btn"
                            style={{ background: 'var(--color-accent-800)', color: 'var(--color-on-accent, var(--color-bg))', borderColor: 'var(--color-accent-800)' }}
                            onClick={() => void confirmRemove(c)}
                            disabled={busy || (onShelf > 0 && !moveTo)}
                            aria-busy={deleteCategory.isPending}
                          >
                            {deleteCategory.isPending ? 'Removing…' : onShelf > 0 ? 'Move rewards and remove' : 'Remove'}
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                }

                return (
                  <li key={c.slug} style={rowStyle(false)}>
                    <span style={markStyle} aria-hidden="true"><Mark size={15} strokeWidth={1.8} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.label}
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>
                        {onShelf === 0 ? 'No rewards' : onShelf === 1 ? '1 reward' : `${onShelf} rewards`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
                      <button className="vs-btn-icon" style={iconBtn} onClick={() => void move(i, -1)} disabled={busy || i === 0} aria-label={`Move ${c.label} up`} title="Move up">
                        <ArrowUp size={12} />
                      </button>
                      <button className="vs-btn-icon" style={iconBtn} onClick={() => void move(i, 1)} disabled={busy || i === categories.length - 1} aria-label={`Move ${c.label} down`} title="Move down">
                        <ArrowDown size={12} />
                      </button>
                      <button className="vs-btn-icon" style={iconBtn} onClick={() => startEdit(c)} disabled={busy} aria-label={`Edit ${c.label}`} title="Edit">
                        <Edit2 size={12} />
                      </button>
                      <button
                        className="vs-btn-icon"
                        style={iconBtn}
                        onClick={() => startRemove(c)}
                        disabled={busy || isLast}
                        aria-label={`Remove ${c.label}`}
                        title={isLast ? 'The Value Store needs at least one category' : 'Remove'}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          {notice && <p style={{ fontSize: 13, color: 'var(--color-neutral-700)' }} role="status">{notice}</p>}

          {/* Adding. Kept below the list so a new shelf appears where it will sit: last. */}
          <div style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label htmlFor="new-store-category" style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>
              Add a category
            </label>
            <div className="flex gap-2">
              <Input
                id="new-store-category"
                placeholder="e.g. Travel"
                value={newLabel}
                maxLength={STORE_CATEGORY_LABEL_MAX}
                onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void add() }}
                disabled={categoriesQuery.isError}
              />
              <button
                className="vs-btn vs-btn-primary relative"
                style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
                onClick={() => void add()}
                disabled={busy || categoriesQuery.isError || !newLabel.trim()}
                aria-busy={createCategory.isPending}
              >
                <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
                <Plus size={13} aria-hidden="true" /> {createCategory.isPending ? 'Adding…' : 'Add'}
              </button>
            </div>
            <IconPicker value={newIcon} onChange={setNewIcon} />
          </div>
        </div>

        <div className="flex justify-end" style={{ padding: '12px 18px', borderTop: '1px solid var(--color-divider)' }}>
          <button className="vs-btn" onClick={onClose} disabled={busy}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** The glyph a shelf wears, from the fixed set the store knows how to draw. */
function IconPicker({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Icon" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {Object.entries(CATEGORY_ICONS).map(([key, { icon: Icon, label }]) => {
        const on = key === value
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={label}
            onClick={() => onChange(key)}
            style={{
              width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 8,
              border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-divider)'}`,
              background: on ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'transparent',
              color: on ? 'var(--color-accent-700)' : 'var(--color-neutral-600)',
              cursor: 'pointer',
            }}
          >
            <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}

const iconBtn = { width: 28, height: 28 } as const

const markStyle = {
  width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
  color: 'var(--color-accent-700)', flexShrink: 0, borderRadius: 8,
} as const

function rowStyle(open: boolean) {
  return {
    display: 'flex', alignItems: open ? 'stretch' : 'center', gap: 12,
    padding: '10px 12px',
    border: '1px solid var(--color-divider)',
    borderRadius: 10,
    background: open ? 'color-mix(in srgb, var(--color-accent) 5%, transparent)' : 'transparent',
  } as const
}
