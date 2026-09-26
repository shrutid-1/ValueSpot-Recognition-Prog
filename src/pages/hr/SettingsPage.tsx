import { useEffect, useRef, useState } from 'react'
import {
  useAppConfig, useSetNumericConfig, useSetBadgeThresholds, useBadgeDefinitions,
} from '@/hooks/queries'
import { errorMessage } from '@/lib/query'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/shared/SkeletonLoader'
import type { BadgeDefinition } from '@/types'

const CONFIG_KEYS = [
  { key: 'rate_limit_daily',        label: 'Daily recognition limit',            hint: 'Max recognitions an employee can submit per day' },
  { key: 'rate_limit_monthly',      label: 'Monthly recognition limit',          hint: 'Max recognitions an employee can submit per month' },
  { key: 'anti_gaming_window_days', label: 'Anti-gaming window (days)',           hint: 'Days before the same nominator can re-recognize the same person for the same value' },
  { key: 'financial_year_q1_start', label: 'Financial year Q1 start month (1–12)', hint: 'e.g. 4 = April' },
]

/*
  Only the keys this screen actually edits. It used to select every row in
  app_config and render four of them, pulling operational keys it never shows.
*/
const EDITABLE_KEYS = CONFIG_KEYS.map(c => c.key)

function SettingRowSkeleton() {
  return (
    <div className="flex items-center gap-4 py-3 px-4 border-b border-divider last:border-b-0">
      <div className="flex-1">
        <Skeleton className="h-4 w-40 mb-1" />
        <Skeleton className="h-3 w-56" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-16" />
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const configQuery = useAppConfig(EDITABLE_KEYS)
  // Badge thresholds are the same cached copy the badge screens read.
  const badgeQuery = useBadgeDefinitions()
  const setNumericConfig = useSetNumericConfig()
  const setBadgeThresholds = useSetBadgeThresholds()

  const badgeDefs = badgeQuery.data ?? []
  const loading = configQuery.isPending || badgeQuery.isPending

  const [saving, setSaving] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  // Per-row save errors, keyed by config key or `badge-<id>`. Previously every
  // save failure was swallowed and the UI implied success.
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const setError = (key: string, message: string | null) =>
    setErrors(prev => ({ ...prev, [key]: message }))

  /*
    Seed the editable inputs ONCE, when the stored values first arrive.

    Deliberately not on every change of configQuery.data. Saving one setting
    invalidates this query, which refetches and hands back a new object — and
    re-seeding on that would overwrite a different row the user had already
    typed into but not yet saved. Seeding once reproduces the single fetch this
    screen did before it was cached, while keeping the cache.
  */
  const seeded = useRef(false)
  useEffect(() => {
    if (!seeded.current && configQuery.data) {
      setValues(configQuery.data)
      seeded.current = true
    }
  }, [configQuery.data])

  const saveConfig = async (key: string) => {
    const raw = (values[key] ?? '').trim()
    const numeric = Number(raw)

    if (raw === '' || !Number.isFinite(numeric) || numeric < 1) {
      setError(key, 'Enter a whole number of 1 or more.')
      return
    }

    setSaving(key)
    setError(key, null)

    try {
      await setNumericConfig.mutateAsync({ key, value: numeric })
    } catch (err) {
      // The database refused — RLS or the 2FA gate. Say so; do not imply
      // the new limit is in force when it is not.
      setError(key, errorMessage(err, 'Could not save. Please try again.'))
    }

    setSaving(null)
  }

  const saveBadge = async (badge: BadgeDefinition, min: number, max: number | null) => {
    const badgeKey = `badge-${badge.id}`

    if (!Number.isFinite(min) || min < 1) {
      setError(badgeKey, 'Minimum must be 1 or more.')
      return
    }
    if (max !== null && (!Number.isFinite(max) || max < min)) {
      setError(badgeKey, 'Maximum must be greater than or equal to the minimum.')
      return
    }

    setSaving(badgeKey)
    setError(badgeKey, null)

    try {
      await setBadgeThresholds.mutateAsync({
        badgeId: badge.id,
        minimumCount: min,
        maximumCount: max,
      })
    } catch (err) {
      setError(badgeKey, errorMessage(err, 'Could not save. Please try again.'))
    }

    // On success the mutation invalidates the badge definitions, so the list
    // refreshes itself — the manual refetch that used to follow is gone.
    setSaving(null)
  }

  return (
    <div className="animate-fade-in" style={{ maxWidth: 900, margin: '0 auto', paddingLeft: 24, paddingRight: 24 }}>
      <PageHeader
        title="Settings"
        subtitle="Configure recognition rules, rate limits and badge thresholds."
      />


      {/* Recognition Rules */}
      <Card style={{ marginTop: 32 }}>
        <CardHeader className="pb-3">
          <CardTitle>Recognition Rules</CardTitle>
          <p className="text-sm text-text-muted mt-0.5">
            These values are fetched by Edge Functions — changes take effect immediately.
          </p>
        </CardHeader>
        <CardContent style={{ padding: 0 }}>
          {loading ? (
            <div>
              {[...Array(4)].map((_, i) => <SettingRowSkeleton key={i} />)}
            </div>
          ) : (
            <div>
              {CONFIG_KEYS.map((cfg, idx) => (
                <div
                  key={cfg.key}
                  className="flex items-center gap-4 py-3 px-4"
                  style={{
                    borderBottom: idx < CONFIG_KEYS.length - 1 ? '1px solid var(--color-divider)' : 'none',
                  }}
                >
                  <div className="flex-1">
                    <label
                      htmlFor={`cfg-${cfg.key}`}
                      className="block text-sm font-medium"
                      style={{ color: 'var(--color-text)', marginBottom: 4 }}
                    >
                      {cfg.label}
                    </label>
                    <p style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>
                      {cfg.hint}
                    </p>
                    {errors[cfg.key] && (
                      <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-800)', marginTop: 4 }}>
                        {errors[cfg.key]}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Input
                      id={`cfg-${cfg.key}`}
                      type="number"
                      style={{ width: 80 }}
                      value={values[cfg.key] ?? ''}
                      onChange={e => setValues(v => ({ ...v, [cfg.key]: e.target.value }))}
                      min={1}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      loading={saving === cfg.key}
                      onClick={() => saveConfig(cfg.key)}
                      style={{ minWidth: 60 }}
                    >
                      {saving === cfg.key ? '...' : 'Save'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Badge Thresholds */}
      <Card style={{ marginTop: 24 }}>
        <CardHeader className="pb-3">
          <CardTitle>Badge Thresholds</CardTitle>
          <p className="text-sm text-text-muted mt-0.5">
            Set the recognition count required to earn each badge level. Leave max empty for unlimited (B5).
          </p>
        </CardHeader>
        <CardContent style={{ padding: 0 }}>
          {loading ? (
            <div>
              {[...Array(5)].map((_, i) => <SettingRowSkeleton key={i} />)}
            </div>
          ) : (
            <div>
              {badgeDefs.map((badge, idx) => (
                <BadgeThresholdRow
                  key={badge.id}
                  badge={badge}
                  saving={saving === `badge-${badge.id}`}
                  error={errors[`badge-${badge.id}`] ?? null}
                  onSave={saveBadge}
                  isLast={idx === badgeDefs.length - 1}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function BadgeThresholdRow({
  badge,
  saving,
  error,
  onSave,
  isLast,
}: {
  badge: BadgeDefinition
  saving: boolean
  error: string | null
  onSave: (badge: BadgeDefinition, min: number, max: number | null) => void
  isLast: boolean
}) {
  const [min, setMin] = useState(badge.minimum_count)
  const [max, setMax] = useState<string>(badge.maximum_count != null ? String(badge.maximum_count) : '')

  return (
    <div
      className="flex items-center gap-4 py-3 px-4"
      style={{
        borderBottom: !isLast ? '1px solid var(--color-divider)' : 'none',
      }}
    >
      <div className="flex-1">
        <p
          className="block text-sm font-medium"
          style={{ color: 'var(--color-text)', marginBottom: 4 }}
        >
          B{badge.level} — {badge.name}
        </p>
        <p style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>
          {badge.description}
        </p>
        {error && (
          <p role="alert" style={{ fontSize: 12, color: 'var(--color-accent-800)', marginTop: 4 }}>
            {error}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Input
          type="number"
          style={{ width: 60 }}
          value={min}
          onChange={e => setMin(Number(e.target.value))}
          min={1}
          aria-label={`B${badge.level} minimum count`}
        />
        <span style={{ color: 'var(--color-neutral-600)', fontSize: 13 }} aria-hidden="true">–</span>
        <Input
          type="number"
          style={{ width: 60 }}
          value={max}
          onChange={e => setMax(e.target.value)}
          placeholder="∞"
          aria-label={`B${badge.level} maximum count (empty = unlimited)`}
        />
        <Button
          size="sm"
          variant="outline"
          loading={saving}
          onClick={() => onSave(badge, min, max ? Number(max) : null)}
          style={{ minWidth: 60 }}
        >
          {saving ? '...' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
