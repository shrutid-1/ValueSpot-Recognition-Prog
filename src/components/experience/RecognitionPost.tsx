import { useState } from 'react'
import {
  Award, CheckCircle2, Eye, Lightbulb, MessageCircle, RefreshCw, Users,
  type LucideIcon,
} from 'lucide-react'
import type { RecognitionFeedItem } from '@/types'
import { Avatar } from './Avatar'
import { AppreciateButton } from './AppreciateButton'
import { CommentThread } from './CommentThread'
import { SendCoinsButton } from './SendCoinsButton'
import { ValueCoinTotal } from './ValueCoinFigure'
import { ModerationMenu } from '@/components/recognition/ModerationMenu'
import { timeAgo, formatIST } from '@/lib/date-utils'
import { toneKey, valueTone } from '@/lib/value-tone'

/*
  Each Core Value's mark, keyed like its tone (by normalised name). The same
  glyphs the catalogue records for them (core_values.icon). A value HR adds
  later gets the generic award mark rather than a guess.
*/
const VALUE_ICON: Record<string, LucideIcon> = {
  adaptable:     RefreshCw,
  transparent:   Eye,
  collaborative: Users,
  innovative:    Lightbulb,
  accountable:   CheckCircle2,
}

interface RecognitionPostProps {
  item: RecognitionFeedItem
  /** The signed-in employee, so the post can address them in second person. */
  viewerId: string | undefined
  alreadyAppreciated?: boolean
}

/**
 * A recognition, as a post.
 *
 * Built for the feed rather than adapted from the administrative card, and
 * the difference is the hierarchy. The header answers "who recognised whom,
 * for what" across one line: the two people on the left, the Core Value on
 * the right as a badge — its mark in a solid disc of the value's colour, the
 * name beside it — quiet in size, unmistakable in colour. The largest body
 * text is THE STORY, what a colleague actually did. Everything else is
 * apparatus around it: on what project, when.
 *
 * A recognition also is not authored the way a status update is. It always
 * has two people, so the post opens with both faces and names one against
 * the other, rather than presenting a single author.
 *
 * Nothing here is invented. No counts appear that are not read off the row —
 * appreciation_count, comment_count and value_coins_received all come from
 * v_recognition_feed. The action row holds exactly the controls that do
 * something: Appreciate, Comment, Send coins, and the moderation menu — and
 * the last two render nothing at all unless the database would accept the
 * action from this viewer.
 *
 * What the recognition was recorded against — behaviour, scenario, project,
 * approval date — is shown outright rather than behind a disclosure.
 */
export function RecognitionPost({
  item,
  viewerId,
  alreadyAppreciated = false,
}: RecognitionPostProps) {
  const tone = valueTone(item.core_value_name)
  const ValueIcon = VALUE_ICON[toneKey(item.core_value_name)] ?? Award

  /*
    The conversation opens INSIDE the post, under it.

    So that a remark and the recognition it is about are on screen together,
    which a dialog cannot do — it puts the post behind a backdrop to make
    room for the comments about it. What keeps the post from growing without
    limit is the thread's own paging, not a separate window: two comments
    open, three more per press.

    Mounted only while open, so a page of posts is a page of posts and not
    twenty dormant threads, and the conversation is fetched for the one post
    somebody asked about.
  */
  const [commentsOpen, setCommentsOpen] = useState(false)
  const when = item.approved_at ? timeAgo(item.approved_at) : ''

  const givenByViewer = Boolean(viewerId) && item.nominator_id === viewerId
  const receivedByViewer = Boolean(viewerId) && item.nominee_id === viewerId

  /*
    The sentence. Written as a sentence, in the second person where the
    reader is one of the two people — "Priya Nair recognised you" is how
    somebody would say it, and it is the whole reason the feed feels
    addressed rather than reported.
  */
  const giver = givenByViewer ? 'You' : item.nominator_name
  const receiver = receivedByViewer ? 'you' : item.nominee_name

  const aria = receivedByViewer
    ? `Recognition you received from ${item.nominator_name} for ${item.core_value_name}`
    : givenByViewer
      ? `Recognition you gave to ${item.nominee_name} for ${item.core_value_name}`
      : `${item.nominator_name} recognised ${item.nominee_name} for ${item.core_value_name}`

  /*
    Details are shown OUTRIGHT, not behind a disclosure.

    The behaviour, the scenario and the project are not extra reading — they
    are what the recognition was recorded against, and hiding them behind a
    toggle meant the most specific thing about a post was the one part nobody
    saw. The section still disappears entirely when the author recorded none
    of it, so a sparse recognition does not get an empty panel.
  */
  const hasDetails = Boolean(item.behaviour_name || item.scenario_name || item.approved_at)

  const detail = (label: string, value: string) => (
    <div style={{ minWidth: 0 }}>
      <p className="vsx-heading" style={{ fontSize: 11.5, color: 'var(--vsx-text-3)' }}>
        {label}
      </p>
      <p style={{ fontSize: 13.5, color: 'var(--vsx-text-2)', marginTop: 3, lineHeight: 1.5 }}>
        {value}
      </p>
    </div>
  )

  return (
    <article
      className="vsx-panel vsx-post"
      aria-label={aria}
      style={{ ['--tone' as string]: tone }}
    >
      {/* ── Who, and for which value ─────────────────────── */}
      <header className="flex items-start" style={{ gap: 13 }}>
        <span className="vsx-pair" aria-hidden="true">
          <Avatar name={item.nominator_name} avatarUrl={item.nominator_avatar} size="md" />
          <Avatar name={item.nominee_name} avatarUrl={item.nominee_avatar} size="md" />
        </span>

        <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
          <p style={{ fontSize: 15, lineHeight: 1.4, color: 'var(--vsx-text)' }}>
            <strong style={{ fontWeight: 600 }}>{giver}</strong>
            {' recognised '}
            <strong style={{ fontWeight: 600 }}>{receiver}</strong>
          </p>
          {/*
            Provenance as a written clause rather than a middle-dot string.
            "2 hours ago in Project Atlas" is how a person would say it.
          */}
          <p className="vsx-meta" style={{ fontSize: 12.5, marginTop: 2 }}>
            {when}
            {item.project_name ? ` in ${item.project_name}` : ''}
          </p>
        </div>

        {/* The value, opposite the names: the two halves of "who recognised
            whom, for what" read across one line. */}
        <div className="vsx-post-tags">
          <p className="vsx-post-value">
            <span className="vsx-post-value-mark" aria-hidden="true">
              <ValueIcon size={15} strokeWidth={2.2} />
            </span>
            <span className="vsx-post-value-text">
              <span className="vsx-post-value-label">Core Value</span>
              <span className="vsx-post-value-name">{item.core_value_name}</span>
            </span>
          </p>
          <ModerationMenu item={item} />
        </div>
      </header>

      {/* ── What happened ───────────────────────────────── */}
      <p className="vsx-post-story" style={{ marginTop: 18 }}>
        {item.what_happened}
      </p>

      {item.what_impact && (
        <div className="vsx-post-impact" style={{ marginTop: 16 }}>
          <p className="vsx-heading" style={{ fontSize: 11.5, color: 'var(--vsx-text-3)' }}>
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

      {/* ── What it was recorded against ────────────────
          No animation on this block. Motion is for answering an action, and
          nothing here is answering one any more — it is simply part of the
          post. */}
      {hasDetails && (
        <div
          style={{
            marginTop: 18,
            padding: 18,
            borderRadius: 'var(--vsx-r-sm)',
            background: 'var(--vsx-ink-3)',
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          }}
        >
          {item.behaviour_name && detail('Behaviour', item.behaviour_name)}
          {item.scenario_name && detail('Scenario', item.scenario_name)}
          {item.project_name && detail('Project', item.project_name)}
          {item.approved_at && detail('Approved', formatIST(item.approved_at, 'd MMM yyyy'))}
        </div>
      )}

      {/* ── Actions ─────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center"
        style={{
          gap: 10,
          marginTop: 18,
          paddingTop: 16,
          borderTop: '1px solid var(--vsx-rule)',
        }}
      >
        <AppreciateButton item={item} alreadyAppreciated={alreadyAppreciated} />

        <button
          type="button"
          className="vsx-btn vsx-btn-sm"
          onClick={() => setCommentsOpen(o => !o)}
          aria-expanded={commentsOpen}
          aria-label={
            item.comment_count === 1
              ? 'Comment. 1 comment so far'
              : `Comment. ${item.comment_count} comments so far`
          }
        >
          <MessageCircle size={14} aria-hidden="true" strokeWidth={1.8} />
          Comment
          {/* Guarded although the type says number: the column comes from a
              VIEW, and a browser served by a database where migration 046 has
              not run yet reads undefined here. */}
          {Number.isFinite(item.comment_count) && item.comment_count > 0 && (
            <span className="vsx-fig" style={{ fontSize: 14, color: 'inherit' }}>
              {item.comment_count}
            </span>
          )}
        </button>

        {/* Value Coins go to the NOMINEE, so this renders nothing on your own
            recognitions and nothing when your wallet is empty. */}
        <SendCoinsButton item={item} />

        {/*
          What this recognition has earned, shown to EVERYBODY.

          It used to live inside the Send coins button, which meant the two
          people most likely to want it — the nominee, who cannot send to
          themselves, and anyone whose budget is spent — were the two who
          could not see it. It is a reading, not a control, so it sits apart
          from the actions and carries no press.
        */}
        {item.value_coins_received > 0 && (
          <span className="ml-auto">
            <ValueCoinTotal amount={item.value_coins_received} />
          </span>
        )}
      </div>

      {commentsOpen && <CommentThread item={item} />}
    </article>
  )
}
