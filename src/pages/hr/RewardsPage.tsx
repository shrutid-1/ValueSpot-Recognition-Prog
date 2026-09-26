import React, { useState } from 'react'
import { Plus, Edit2, Gift, X, LayoutGrid } from 'lucide-react'
import { useRewards, useCreateReward, useUpdateReward, useStoreCategories } from '@/hooks/queries'
import { errorMessage } from '@/lib/query'
import {
  REWARD_VALIDITY_MIN, REWARD_VALIDITY_MAX, REWARD_VALIDITY_DEFAULT,
} from '@/lib/api'
import type { Reward, RewardCategory } from '@/types'
import { RedemptionQueue } from '@/components/hr/RedemptionQueue'
import { StoreCategoriesDialog } from '@/components/hr/StoreCategoriesDialog'
import { markFor } from '@/components/experience/rewardMarks'
import { PageHeader } from '@/components/shared/PageHeader'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { TableSkeleton } from '@/components/shared/SkeletonLoader'
import { EmptyState } from '@/components/shared/EmptyState'
import { dismissOnBackdrop } from '@/lib/backdrop'

function FormDialog({ open, onClose, title, children, onSubmit, saving, submitLabel, error }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; onSubmit: () => void; saving: boolean; submitLabel: string; error?: string | null }) {
  if (!open) return null
  return (
    <div className="vs-dialog-backdrop" {...dismissOnBackdrop(() => onClose())}>
      <div className="vs-dialog animate-fade-in" style={{ minWidth: 440 }} onClick={e => e.stopPropagation()}>
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

export default function RewardsPage() {
  const rewardsQuery  = useRewards()
  const createReward  = useCreateReward()
  const updateReward  = useUpdateReward()

  const categoriesQuery = useStoreCategories()

  const rewards = rewardsQuery.data ?? []
  const loading = rewardsQuery.isPending
  const categories = categoriesQuery.data ?? []

  const [showForm, setShowForm]   = useState(false)
  const [showCategories, setShowCategories] = useState(false)
  const [editing, setEditing]     = useState<Reward | null>(null)
  const [form, setForm]           = useState({ name: '', description: '', frequency: '', eligibility_criteria: '', value_description: '', requires_approval: true, coin_price: 0, category: '' as RewardCategory, redemption_validity_days: REWARD_VALIDITY_DEFAULT, is_active: true })
  const [saving, setSaving]       = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // A new reward starts on the first shelf, whichever that is now — HR can
  // remove any of them, so no particular one can be assumed.
  const openAdd  = () => { setEditing(null); setForm({ name: '', description: '', frequency: '', eligibility_criteria: '', value_description: '', requires_approval: true, coin_price: 0, category: categories[0]?.slug ?? '', redemption_validity_days: REWARD_VALIDITY_DEFAULT, is_active: true }); setSaveError(null); setShowForm(true) }
  const openEdit = (r: Reward) => { setEditing(r); setForm({ name: r.name, description: r.description ?? '', frequency: r.frequency ?? '', eligibility_criteria: r.eligibility_criteria ?? '', value_description: r.value_description ?? '', requires_approval: r.requires_approval, coin_price: r.coin_price, category: r.category, redemption_validity_days: r.redemption_validity_days, is_active: r.is_active }); setSaveError(null); setShowForm(true) }
  const closeForm = () => { setShowForm(false); setSaveError(null) }

  const save = async () => {
    if (!form.name.trim()) { setSaveError('A name is required.'); return }
    if (!categories.some(c => c.slug === form.category)) {
      setSaveError('Choose a store category.')
      return
    }
    /*
      Said here rather than left to the CHECK. The database refuses a 0 or a
      400 with a constraint name, which is the right answer to the wrong
      audience — this is the sentence the person editing the form needs.
    */
    const validity = form.redemption_validity_days
    if (!Number.isInteger(validity) || validity < REWARD_VALIDITY_MIN || validity > REWARD_VALIDITY_MAX) {
      setSaveError(`Redemption validity must be a whole number of days between ${REWARD_VALIDITY_MIN} and ${REWARD_VALIDITY_MAX}.`)
      return
    }

    setSaving(true); setSaveError(null)

    const fields = {
      name: form.name,
      description: form.description || null,
      frequency: form.frequency || null,
      eligibilityCriteria: form.eligibility_criteria || null,
      valueDescription: form.value_description || null,
      requiresApproval: form.requires_approval,
      coinPrice: form.coin_price,
      category: form.category,
      validityDays: form.redemption_validity_days,
      isActive: form.is_active,
    }

    try {
      if (editing) {
        await updateReward.mutateAsync({ id: editing.id, ...fields })
      } else {
        // A new reward is active by definition, so `isActive` is not sent on
        // create and the toggle for it only appears when editing.
        await createReward.mutateAsync({
          name: fields.name,
          description: fields.description,
          frequency: fields.frequency,
          eligibilityCriteria: fields.eligibilityCriteria,
          valueDescription: fields.valueDescription,
          requiresApproval: fields.requiresApproval,
          coinPrice: fields.coinPrice,
          category: fields.category,
          validityDays: fields.validityDays,
        })
      }
    } catch (err) {
      /*
        The database refused — RLS, the 2FA gate or a constraint. Keep the
        dialog open with the work still in it and say what happened. Nothing
        is invalidated, because the mutation's onSuccess never ran.
      */
      setSaveError(errorMessage(err, 'Could not save that reward. Please try again.'))
      setSaving(false)
      return
    }

    setSaving(false); closeForm()
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        kicker="HR Manage"
        title="Rewards"
        subtitle="The Value Store catalogue. Set what each reward costs in Value Coins and whether you approve it before it is fulfilled."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <button className="vs-btn" onClick={() => setShowCategories(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <LayoutGrid size={13} aria-hidden="true" /> Store categories
            </button>
            <button className="vs-btn vs-btn-primary relative" onClick={openAdd} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
              <Plus size={13} aria-hidden="true" /> Add Reward
            </button>
          </div>
        }
      />

      {/* Said once, here, rather than in the descriptions themselves — which
          employees read in the store and which should not be carrying a note
          to HR. */}
      {!loading && rewards.length > 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--color-neutral-600)' }}>
          The starting catalogue is sample data, to make the Value Store usable
          straight away. Edit the prices and wording, or switch off anything
          your organisation does not offer.
        </p>
      )}

      <RedemptionQueue />

      {loading ? <TableSkeleton /> : rewards.length === 0 ? (
        <EmptyState icon={<Gift size={36} />} title="Nothing in the Value Store yet" description="Add a reward and set what it costs in Value Coins. Employees spend the coins colleagues have sent them." action={{ label: 'Add Reward', onClick: openAdd }} />
      ) : (
        <div className="space-y-2">
          {rewards.map(r => (
            <div
              key={r.id}
              className="vs-card"
              style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 14 }}
            >
              <div
                style={{
                  width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                  color: 'var(--color-accent-700)', flexShrink: 0,
                }}
                aria-hidden="true"
              >
                <Gift size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 4 }}>
                  <p className="font-condensed" style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>{r.name}</p>
                  <span className={`vs-tag ${r.is_active ? 'vs-tag-accent' : 'vs-tag-neutral'}`}>{r.is_active ? 'Active' : 'Inactive'}</span>
                  {r.frequency && <span className="vs-tag vs-tag-neutral" style={{ textTransform: 'capitalize' }}>{r.frequency}</span>}
                  {r.requires_approval && <span className="vs-tag vs-tag-outline">Requires approval</span>}
                  <span className="vs-tag vs-tag-neutral">{markFor(r.category, categories).label}</span>
                  {/* An unpriced reward cannot be redeemed, so say so here
                      rather than letting it sit invisibly out of the store. */}
                  <span className="vs-tag vs-tag-neutral">
                    {r.redemption_validity_days}-day validity
                  </span>
                  <span className={`vs-tag ${r.requires_approval ? 'vs-tag-outline' : 'vs-tag-neutral'}`}>
                    {r.requires_approval ? 'Approval required' : 'No approval'}
                  </span>
                  <span className={`vs-tag ${r.coin_price > 0 ? 'vs-tag-accent' : 'vs-tag-outline'}`}>
                    {r.coin_price > 0 ? `${r.coin_price.toLocaleString()} VC` : 'No price set'}
                  </span>
                </div>
                {r.description && <p style={{ fontSize: 13, color: 'var(--color-neutral-600)', lineHeight: 1.5 }}>{r.description}</p>}
                {r.eligibility_criteria && <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 4 }}><strong>Eligibility:</strong> {r.eligibility_criteria}</p>}
              </div>
              <button className="vs-btn-icon" style={{ width: 28, height: 28, flexShrink: 0 }} onClick={() => openEdit(r)} aria-label={`Edit ${r.name}`}><Edit2 size={12} /></button>
            </div>
          ))}
        </div>
      )}

      <FormDialog open={showForm} onClose={closeForm} title={editing ? 'Edit Reward' : 'Add Reward'} onSubmit={save} saving={saving} submitLabel={editing ? 'Save changes' : 'Add Reward'} error={saveError}>
        <FL label="Reward Name" required><Input placeholder="e.g. LinkedIn Spotlight" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus /></FL>
        <FL label="Description" optional><Textarea placeholder="Describe what this reward entails" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></FL>
        <FL label="Frequency">
          <select className="vs-input w-full" value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
            <option value="">Ad-hoc</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
          </select>
        </FL>
        <FL label="Eligibility" optional><Input placeholder="e.g. Employees with B4 or above" value={form.eligibility_criteria} onChange={e => setForm(f => ({ ...f, eligibility_criteria: e.target.value }))} /></FL>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <FL label="Value Coin price">
            <Input
              type="number"
              min={0}
              step={50}
              value={form.coin_price}
              onChange={e => setForm(f => ({ ...f, coin_price: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
            />
            <p style={{ fontSize: 11.5, color: 'var(--color-neutral-600)', marginTop: 4 }}>
              0 keeps it out of the Value Store.
            </p>
          </FL>
          <FL label="Store category">
            <select
              className="vs-input w-full"
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value as RewardCategory }))}
              disabled={categoriesQuery.isPending || categories.length === 0}
            >
              {/* Until one is chosen — or while the list is still arriving —
                  say so, rather than let the browser show the first option
                  as if it had been picked. */}
              {!categories.some(c => c.slug === form.category) && (
                <option value="" disabled>
                  {categoriesQuery.isPending ? 'Loading…' : categories.length === 0 ? 'No categories yet' : 'Choose a category'}
                </option>
              )}
              {categories.map(c => <option key={c.slug} value={c.slug}>{c.label}</option>)}
            </select>
            {categoriesQuery.isError && (
              <p className="text-danger" style={{ fontSize: 11.5, marginTop: 4 }}>
                {errorMessage(categoriesQuery.error, 'Could not load the store categories.')}
              </p>
            )}
          </FL>
        </div>
        <FL label="Redemption Validity" required>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={REWARD_VALIDITY_MIN}
              max={REWARD_VALIDITY_MAX}
              step={1}
              style={{ width: 110 }}
              value={form.redemption_validity_days}
              onChange={e => setForm(f => ({
                ...f,
                /* Not clamped on every keystroke: correcting a 3 to a 30 means
                   passing through values the field would otherwise snap back,
                   which makes the input feel broken. The range is checked on
                   save, clamped again in the API and enforced by the CHECK. */
                redemption_validity_days: Math.floor(Number(e.target.value) || 0),
              }))}
              aria-describedby="validity-help"
            />
            <span style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>days</span>
          </div>
          <p id="validity-help" style={{ fontSize: 11.5, color: 'var(--color-neutral-600)', marginTop: 5, lineHeight: 1.5 }}>
            How long an approved redemption remains valid. The clock starts when
            it is approved, not when it is requested, so a slow queue never eats
            somebody&rsquo;s window. {REWARD_VALIDITY_MIN}&ndash;{REWARD_VALIDITY_MAX} days.
            <br />
            Changes apply to future redemptions only. Existing redemptions keep
            their original validity.
          </p>
        </FL>
        <div className="flex items-center gap-2.5">
          <input
            type="checkbox"
            id="req-approval"
            checked={form.requires_approval}
            onChange={e => setForm(f => ({ ...f, requires_approval: e.target.checked }))}
            style={{ width: 14, height: 14, border: '1px solid var(--color-divider)', accentColor: 'var(--color-accent)' }}
          />
          <label htmlFor="req-approval" style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer' }}>You approve each redemption before it is fulfilled</label>
        </div>
        {editing && (
          <div className="flex items-center gap-2.5">
            <input
              type="checkbox"
              id="reward-active"
              checked={form.is_active}
              onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
              style={{ width: 14, height: 14, border: '1px solid var(--color-divider)', accentColor: 'var(--color-accent)' }}
            />
            <label htmlFor="reward-active" style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer' }}>
              Listed in the Value Store
            </label>
          </div>
        )}
      </FormDialog>

      <StoreCategoriesDialog
        open={showCategories}
        onClose={() => setShowCategories(false)}
        rewards={rewards}
      />
    </div>
  )
}
