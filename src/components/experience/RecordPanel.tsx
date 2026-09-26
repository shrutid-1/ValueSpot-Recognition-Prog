import { useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, ChevronDown } from 'lucide-react'
import type { RecognitionFeedItem } from '@/types'
import { Panel } from './Panel'
import { Avatar } from './Avatar'
import { AppreciateButton } from './AppreciateButton'
import { ModerationMenu } from '@/components/recognition/ModerationMenu'
import { formatIST, timeAgo } from '@/lib/date-utils'
import { valueTone } from '@/lib/value-tone'
import { cn } from '@/lib/utils'

interface RecordPanelProps {
  items: RecognitionFeedItem[]
  employeeId: string | undefined
  activeValueId: string | null
  onClearValue: () => void
  onViewFeed: () => void
  onGiveRecognition: () => void
  delay?: number
}

/**
 * The record — recognition this person has given and received.
 *
 * Dated rows, each carrying a solid pill in its Core Value's colour. A column
 * of these reads as a band of colour down the panel, which is the point: the
 * pattern of somebody's values is visible before a single word is read.
 *
 * Every row expands. Collapsed it is a log entry; open it is the whole
 * recognition — what happened, what changed, and the controls that act on
 * it. That is what lets the panel be compact without the stories, which are
 * the reason this product exists, being pushed onto another screen.
 *
 * Rows come from v_recognition_feed, which filters to approved recognitions
 * in the view itself — nothing pending or rejected can appear here whatever
 * this component does with them.
 */
export function RecordPanel({
  items,
  employeeId,
  activeValueId,
  onClearValue,
  onViewFeed,
  onGiveRecognition,
  delay,
}: RecordPanelProps) {
  const [openId, setOpenId] = useState<string | null>(null)

  const activeName = activeValueId
    ? items.find(i => i.core_value_id === activeValueId)?.core_value_name ?? null
    : null
  const matching = activeValueId
    ? items.filter(i => i.core_value_id === activeValueId).length
    : items.length

  /* The values actually present, for the legend along the foot of the panel. */
  const legend = [...new Map(
    items.map(i => [i.core_value_id, i.core_value_name] as const),
  ).entries()]

  return (
    <Panel
      title="The record"
      delay={delay}
      action={
        items.length > 0 ? (
          <button type="button" className="vsx-btn vsx-btn-quiet vsx-btn-sm" onClick={onViewFeed}>
            Everyone&rsquo;s recognition
          </button>
        ) : undefined
      }
    >
      {/*
        Why part of the record has receded, and the way back. Dimming content
        without saying so is disorienting, so the filter states itself in
        words and offers one control to undo it. aria-live announces the
        change for anyone who cannot see the rows fade.
      */}
      {activeValueId && activeName && (
        <div
          className="flex flex-wrap items-center"
          style={{ gap: 10, marginBottom: 16 }}
          aria-live="polite"
        >
          <p className="vsx-meta" style={{ fontSize: 13 }}>
            Showing {matching} {matching === 1 ? 'entry' : 'entries'} for{' '}
            <span style={{ color: valueTone(activeName), fontWeight: 600 }}>{activeName}</span>
          </p>
          <button type="button" className="vsx-btn vsx-btn-sm" onClick={onClearValue}>
            Show all
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div style={{ padding: '14px 0 8px', maxWidth: '40ch' }}>
          <p style={{ fontSize: 17, lineHeight: 1.55, color: 'var(--vsx-text)' }}>
            Nothing on the record yet.
          </p>
          <p className="vsx-meta" style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.6 }}>
            Recognition you give and receive is kept here. Someone who helped
            you get something done this week is a good place to start.
          </p>
          <button
            type="button"
            className="vsx-btn vsx-btn-primary"
            style={{ marginTop: 18 }}
            onClick={onGiveRecognition}
          >
            Recognize someone
          </button>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map(item => {
            const tone = valueTone(item.core_value_name)
            const received = item.nominee_id === employeeId
            const isOpen = openId === item.id
            const recede = Boolean(activeValueId) && item.core_value_id !== activeValueId

            const other = received ? item.nominator_name : item.nominee_name
            const otherAvatar = received ? item.nominator_avatar : item.nominee_avatar
            const Direction = received ? ArrowDownLeft : ArrowUpRight

            const sentence = received
              ? `${item.nominator_name} recognised you`
              : `You recognised ${item.nominee_name}`

            return (
              <li
                key={item.id}
                className={cn(recede && 'vsx-recede')}
                style={{ marginBottom: 6 }}
              >
                <button
                  type="button"
                  className="flex items-center"
                  style={{
                    width: '100%',
                    gap: 12,
                    padding: '5px 4px',
                    background: 'transparent',
                    border: 0,
                    borderRadius: 999,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                  aria-expanded={isOpen}
                  aria-label={`${sentence} for ${item.core_value_name}. ${
                    isOpen ? 'Collapse' : 'Expand'
                  } the full recognition.`}
                  onClick={() => setOpenId(isOpen ? null : item.id)}
                >
                  {/* The date axis, as in a timeline. */}
                  <span
                    className="vsx-fig"
                    style={{
                      fontSize: 13,
                      width: 44,
                      flexShrink: 0,
                      color: 'var(--vsx-text-3)',
                    }}
                  >
                    {item.approved_at ? formatIST(item.approved_at, 'dd.MM') : '—'}
                  </span>

                  <span
                    className="vsx-data-pill"
                    style={{ ['--tone' as string]: tone, minWidth: 0 }}
                  >
                    <Avatar name={other} avatarUrl={otherAvatar} size="xs" />
                    <span className="truncate" style={{ minWidth: 0 }}>{other}</span>
                    <Direction size={13} aria-hidden="true" strokeWidth={2.6} />
                    <span
                      className="truncate"
                      style={{ fontWeight: 500, opacity: 0.72, minWidth: 0 }}
                    >
                      {item.core_value_name}
                    </span>
                  </span>

                  <ChevronDown
                    size={16}
                    aria-hidden="true"
                    strokeWidth={2}
                    className="ml-auto"
                    style={{
                      flexShrink: 0,
                      color: 'var(--vsx-text-3)',
                      transform: isOpen ? 'rotate(180deg)' : undefined,
                      transition: 'transform var(--vsx-t) var(--vsx-ease)',
                    }}
                  />
                </button>

                {isOpen && (
                  <div
                    className="vsx-sheet-in"
                    style={{
                      margin: '4px 0 14px 56px',
                      padding: 18,
                      background: 'var(--vsx-ink-3)',
                      borderRadius: 'var(--vsx-r-sm)',
                    }}
                  >
                    <div className="flex items-start" style={{ gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13.5, color: 'var(--vsx-text-2)' }}>
                          {sentence}
                          {item.approved_at ? `, ${timeAgo(item.approved_at)}` : ''}
                          {item.project_name ? ` in ${item.project_name}` : ''}
                        </p>
                      </div>
                      <ModerationMenu item={item} />
                    </div>

                    <p className="vsx-story" style={{ marginTop: 12, fontSize: 16 }}>
                      {item.what_happened}
                    </p>

                    {item.what_impact && (
                      <div style={{ marginTop: 14 }}>
                        <p
                          className="vsx-heading"
                          style={{ fontSize: 12, color: 'var(--vsx-text-3)' }}
                        >
                          What changed
                        </p>
                        <p
                          style={{
                            fontSize: 14.5,
                            lineHeight: 1.6,
                            color: 'var(--vsx-text-2)',
                            marginTop: 4,
                          }}
                        >
                          {item.what_impact}
                        </p>
                      </div>
                    )}

                    <div
                      className="flex flex-wrap items-center"
                      style={{ gap: 12, marginTop: 16 }}
                    >
                      <AppreciateButton item={item} />
                      {item.behaviour_name && (
                        <p className="vsx-meta truncate" style={{ fontSize: 12.5 }}>
                          {item.behaviour_name}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* The legend, along the foot of the panel — the values present in the
          rows above, named against their colours. */}
      {legend.length > 0 && (
        <div
          className="flex flex-wrap items-center"
          style={{ gap: '10px 18px', marginTop: 'auto', paddingTop: 20 }}
        >
          {legend.map(([id, name]) => (
            <span key={id} className="flex items-center" style={{ gap: 7 }}>
              <span
                aria-hidden="true"
                className="vsx-dot"
                style={{ ['--tone' as string]: valueTone(name) }}
              />
              <span style={{ fontSize: 12.5, color: 'var(--vsx-text-2)' }}>{name}</span>
            </span>
          ))}
          <span
            className="vsx-meta ml-auto"
            style={{ fontSize: 12.5, color: 'var(--vsx-text-3)' }}
          >
            Total: <span className="vsx-fig" style={{ fontSize: 14 }}>{items.length}</span>
          </span>
        </div>
      )}
    </Panel>
  )
}
