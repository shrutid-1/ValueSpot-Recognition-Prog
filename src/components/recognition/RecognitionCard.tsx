import { useEffect, useState } from 'react'
import { Check, Plus, Briefcase, ArrowRight } from 'lucide-react'
import type { RecognitionFeedItem } from '@/types'
import { EmployeeAvatar } from '@/components/shared/EmployeeAvatar'
import { CoreValueBadge } from '@/components/shared/CoreValueBadge'
import { ModerationMenu } from '@/components/recognition/ModerationMenu'
import { timeAgo } from '@/lib/date-utils'
import { recognitionsApi } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import type { CoreValueSlug } from '@/lib/constants'

/**
 * Which side of a recognition the viewer is on.
 *
 * Presentation only. The card does not decide this and nothing about the
 * recognition changes with it — the caller knows who is reading, compares
 * that to the row, and passes the answer down. Ownership, routing and every
 * permission remain exactly where they were.
 */
export type RecognitionPerspective = 'received' | 'given'

interface RecognitionCardProps {
  item: RecognitionFeedItem
  /**
   * Dense one-line row. Used where a list is a summary of activity rather
   * than the thing itself — the HR dashboard's recent strip.
   */
  compact?: boolean
  /**
   * Story-first treatment: the account of what happened is the largest thing
   * on the card. Used by the employee dashboard's Recent Moments, where the
   * point is not that a recognition occurred but what somebody actually did.
   *
   * Takes precedence over `compact` when both are set.
   */
  moment?: boolean
  /** Labels the card RECEIVED or GIVEN from the viewer's standpoint. */
  perspective?: RecognitionPerspective
  /**
   * Whether the signed-in user has already appreciated this recognition.
   * Supplied by parents that fetch appreciations in bulk; without it the card
   * still self-corrects on the first click.
   */
  alreadyAppreciated?: boolean
}

const KICKER: Record<RecognitionPerspective, string> = {
  received: 'Received',
  given: 'Given',
}

export function RecognitionCard({
  item,
  compact = false,
  moment = false,
  perspective,
  alreadyAppreciated = false,
}: RecognitionCardProps) {
  const { employee } = useAuth()
  const [appreciated, setAppreciated] = useState(alreadyAppreciated)
  const [appreciationCount, setAppreciationCount] = useState(item.appreciation_count)

  // Re-sync when the card is reused for a different recognition, or when the
  // parent resolves the user's existing appreciations after first paint.
  useEffect(() => {
    setAppreciated(alreadyAppreciated)
    setAppreciationCount(item.appreciation_count)
  }, [item.id, item.appreciation_count, alreadyAppreciated])

  // One write at a time. A press during a write in flight is ignored rather
  // than queued, so a double-tap cannot land an insert and a delete out of
  // order and leave the row disagreeing with the button.
  const [busy, setBusy] = useState(false)

  const handleAppreciate = async () => {
    if (!employee || busy) return
    setBusy(true)

    if (appreciated) {
      // Take it back. Optimistic, rolled back if the delete does not land.
      setAppreciated(false)
      setAppreciationCount(c => Math.max(c - 1, 0))

      try {
        // Removing nothing means the row was already gone from another device,
        // so the count we are holding — which no longer counts us — is right.
        await recognitionsApi.unappreciate(item.id, employee.id)
      } catch {
        // Genuine failure — put the appreciation back.
        setAppreciated(true)
        setAppreciationCount(c => c + 1)
      } finally {
        setBusy(false)
      }
      return
    }

    // Optimistic update, rolled back if the write does not land.
    setAppreciated(true)
    setAppreciationCount(c => c + 1)

    try {
      const { recorded } = await recognitionsApi.appreciate(item.id, employee.id)

      if (!recorded) {
        // Already appreciated on another device or before a reload. The button
        // is correctly pressed now, but the count was never actually ours to
        // add — undo the increment.
        setAppreciationCount(c => Math.max(c - 1, item.appreciation_count))
      }
    } catch {
      // Genuine failure — put the button back.
      setAppreciated(false)
      setAppreciationCount(c => Math.max(c - 1, 0))
    } finally {
      setBusy(false)
    }
  }

  const slug = item.core_value_name?.toLowerCase().replace(/\s+/g, '') as CoreValueSlug
  const when = item.approved_at ? timeAgo(item.approved_at) : ''

  /*
    Whose face to show, and how to word the exchange. With no perspective the
    card is a neutral observer — which is what the company feed is.
  */
  const counterpart =
    perspective === 'given'
      ? { name: item.nominee_name, avatar: item.nominee_avatar }
      : { name: item.nominator_name, avatar: item.nominator_avatar }

  const fromLabel = perspective === 'given' ? 'You' : item.nominator_name
  const toLabel = perspective === 'received' ? 'You' : item.nominee_name

  const ariaLabel =
    perspective === 'received'
      ? `Recognition received from ${item.nominator_name} for ${item.core_value_name}`
      : perspective === 'given'
        ? `Recognition you gave to ${item.nominee_name} for ${item.core_value_name}`
        : `${item.nominator_name} recognized ${item.nominee_name} for ${item.core_value_name}`

  /* The exchange line — names either side of a direction mark. */
  const exchange = (
    <p
      className="min-w-0"
      style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.4 }}
    >
      <span style={{ fontWeight: 600 }}>{fromLabel}</span>
      <ArrowRight
        size={11}
        aria-hidden="true"
        style={{
          display: 'inline',
          verticalAlign: 'middle',
          margin: '0 6px',
          color: 'var(--color-neutral-600)',
        }}
      />
      <span style={{ fontWeight: 600 }}>{toLabel}</span>
    </p>
  )

  /*
    Appreciate.

    One action, worded rather than symbolised: "Appreciate" becomes
    "Appreciated". The state is carried by the word AND the icon, so it never
    rests on the tint alone, and the count sits beside it in tabular figures.
    It is a toggle: a second press takes the appreciation back, the same as in
    the feed, because a control that is the same thing in two places should not
    behave differently in one of them.
  */
  const appreciateButton = (
    <button
      type="button"
      onClick={handleAppreciate}
      disabled={!employee || busy}
      className="vs-btn"
      title={appreciated ? 'Appreciated — select again to undo' : undefined}
      style={{
        fontSize: 12,
        padding: '4px 9px',
        gap: 5,
        background: appreciated ? 'var(--accent-emphasis)' : 'transparent',
        borderColor: appreciated ? 'var(--color-accent-400)' : 'var(--color-divider)',
        color: appreciated ? 'var(--color-accent-800)' : 'var(--color-neutral-700)',
        opacity: busy ? 0.7 : undefined,
      }}
      aria-label={
        appreciated
          ? `Appreciated. ${appreciationCount} appreciation${appreciationCount !== 1 ? 's' : ''}. Select again to undo`
          : `Appreciate this recognition. ${appreciationCount} appreciation${appreciationCount !== 1 ? 's' : ''}`
      }
      aria-pressed={appreciated}
    >
      {appreciated
        ? <Check size={12} aria-hidden="true" />
        : <Plus size={12} aria-hidden="true" />}
      <span>{appreciated ? 'Appreciated' : 'Appreciate'}</span>
      {appreciationCount > 0 && (
        <span className="tabular-nums" style={{ color: 'var(--color-neutral-700)' }}>
          {appreciationCount}
        </span>
      )}
    </button>
  )

  // ── Compact: a dense activity row ──────────────────────────
  if (compact && !moment) {
    return (
      <article
        className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
        aria-label={ariaLabel}
      >
        <EmployeeAvatar
          name={counterpart.name}
          avatarUrl={counterpart.avatar}
          size="sm"
          className="shrink-0 mt-0.5"
        />
        <div className="flex-1 min-w-0">
          {perspective && (
            <p className="vs-kicker" style={{ fontSize: 9, marginBottom: 2 }}>
              {KICKER[perspective]}
            </p>
          )}
          {exchange}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <CoreValueBadge name={item.core_value_name} slug={slug} size="sm" />
            <span style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>{when}</span>
          </div>
        </div>
      </article>
    )
  }

  // ── Moment: the story is the headline ──────────────────────
  if (moment) {
    return (
      <article
        className="vs-card relative"
        style={{ padding: 16, overflow: 'visible' }}
        aria-label={ariaLabel}
      >
        <i className="corner tl" /><i className="corner tr" />
        <i className="corner bl" /><i className="corner br" />

        {/* Provenance */}
        <div className="flex items-start justify-between gap-2" style={{ marginBottom: 10 }}>
          <p className="vs-kicker" style={{ fontSize: 9, lineHeight: 1.5 }}>
            {perspective ? KICKER[perspective] : 'Recognition'}
            {when && <span style={{ color: 'var(--color-neutral-600)' }}> · {when}</span>}
            {item.project_name && (
              <span style={{ color: 'var(--color-neutral-600)' }}> · {item.project_name}</span>
            )}
          </p>
          <ModerationMenu item={item} />
        </div>

        {/* The story */}
        <blockquote className="vs-quote" style={{ marginBottom: 12 }}>
          {item.what_happened}
        </blockquote>

        {/* The impact, when the author recorded one */}
        {item.what_impact && (
          <div style={{ marginBottom: 12, paddingLeft: 14 }}>
            <p className="vs-kicker" style={{ fontSize: 9, marginBottom: 2 }}>Impact</p>
            <p style={{ fontSize: 12.5, color: 'var(--color-neutral-700)', lineHeight: 1.5 }}>
              {item.what_impact}
            </p>
          </div>
        )}

        {/* Who, for what */}
        <div
          className="flex items-center gap-2.5"
          style={{ paddingTop: 10, borderTop: '1px solid var(--color-divider)' }}
        >
          <EmployeeAvatar
            name={counterpart.name}
            avatarUrl={counterpart.avatar}
            size="sm"
            className="shrink-0"
          />
          <div className="flex-1 min-w-0">
            {exchange}
            <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: 3 }}>
              <CoreValueBadge name={item.core_value_name} slug={slug} size="sm" />
              {item.behaviour_name && (
                <span style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>
                  {item.behaviour_name}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end" style={{ marginTop: 10 }}>
          {appreciateButton}
        </div>
      </article>
    )
  }

  // ── Full: the company feed ─────────────────────────────────
  return (
    <article
      className="vs-card relative"
      style={{ padding: 18, overflow: 'visible' }}
      aria-label={ariaLabel}
    >
      <i className="corner tl" /><i className="corner tr" />
      <i className="corner bl" /><i className="corner br" />

      {/* Header */}
      <div className="flex items-start justify-between gap-3" style={{ marginBottom: 12 }}>
        <div className="flex items-center gap-3 min-w-0">
          <EmployeeAvatar
            name={item.nominator_name}
            avatarUrl={item.nominator_avatar}
            size="md"
            className="shrink-0"
          />
          <div className="min-w-0">
            {perspective && (
              <p className="vs-kicker" style={{ fontSize: 9, marginBottom: 2 }}>
                {KICKER[perspective]}
              </p>
            )}
            {exchange}
            <p style={{ fontSize: 11, color: 'var(--color-neutral-600)', marginTop: 2 }}>
              {when}
              {item.project_name && (
                <> · <span className="inline-flex items-center gap-1">
                  <Briefcase size={10} aria-hidden="true" />
                  {item.project_name}
                </span></>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-1.5 shrink-0">
          <CoreValueBadge name={item.core_value_name} slug={slug} className="shrink-0" />
          {/*
            Renders nothing at all for an Employee or a Manager. The database
            refuses them either way — see ModerationMenu and migration 034.
          */}
          <ModerationMenu item={item} />
        </div>
      </div>

      {/* The story */}
      <blockquote className="vs-quote" style={{ marginBottom: 12 }}>
        {item.what_happened}
      </blockquote>

      {item.what_impact && (
        <div style={{ marginBottom: 12, paddingLeft: 14 }}>
          <p className="vs-kicker" style={{ fontSize: 9, marginBottom: 2 }}>Impact</p>
          <p style={{ fontSize: 13, color: 'var(--color-neutral-700)', lineHeight: 1.55 }}>
            {item.what_impact}
          </p>
        </div>
      )}

      {/* Nominee row */}
      <div
        className="flex items-center gap-2.5"
        style={{ paddingTop: 10, borderTop: '1px solid var(--color-divider)' }}
      >
        <EmployeeAvatar
          name={item.nominee_name}
          avatarUrl={item.nominee_avatar}
          size="xs"
          className="shrink-0"
        />
        <p
          className="flex-1 min-w-0 truncate"
          style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}
        >
          <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{item.nominee_name}</span>
          {item.behaviour_name && <> · {item.behaviour_name}</>}
        </p>

        {appreciateButton}
      </div>
    </article>
  )
}
