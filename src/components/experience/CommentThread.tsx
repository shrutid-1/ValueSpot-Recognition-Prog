import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, CornerDownRight, MessageCircle, MoreVertical, ThumbsUp } from 'lucide-react'
import type { RecognitionFeedItem } from '@/types'
import type { RecognitionComment } from '@/lib/api'
import { ApiError } from '@/lib/api'
import {
  useCommentThread, useAddComment, useRemoveComment, useToggleCommentLike,
} from '@/hooks/queries'
import { useAuth } from '@/context/AuthContext'
import { formatIST } from '@/lib/date-utils'
import { Avatar } from './Avatar'

/** Matches the CHECK constraint on nomination_comments (migration 046). */
const MAX_LENGTH = 1000

/** Comments shown when the thread first opens. */
const FIRST_PAGE = 2

/** How many more each "Load more comments" reveals. */
const PAGE = 3

interface CommentThreadProps {
  item: RecognitionFeedItem
}

/**
 * The conversation, inside the post it belongs to.
 *
 * WHY IN THE CARD AND NOT OVER IT
 * -------------------------------
 * A dialog gives a thread room, but it takes the recognition away to do it:
 * the post is behind a backdrop while you read what people said about it, and
 * closing is the only way back. Below the post, the comment and the thing it
 * is commenting on are on screen together, which is the whole reason a feed
 * reads the way it does.
 *
 * What made the inline version untenable before was height — a post with
 * forty comments pushed the next recognition off the screen. That is what the
 * paging solves rather than the dialog: two comments open, three more per
 * press, so an unread post is never more than a few lines taller than a read
 * one and the length of the conversation is the reader's choice.
 *
 * NEWEST FIRST
 * ------------
 * Deliberate, and the opposite of how the replies underneath are ordered.
 * With only two comments showing, those two should be what is happening now;
 * "Load more" then means "further back", which is the direction people expect
 * to travel through a list they are reading the top of. It also puts a
 * comment you just wrote directly under the composer, where you can see it
 * landed — oldest-first would hide it behind the very Load more button you
 * had not pressed.
 *
 * Replies stay oldest first. A reply group is a conversation, and a
 * conversation read backwards is nonsense.
 *
 * Closing the thread forgets how far it was unrolled — it unmounts — so
 * reopening is a fresh glance at the latest rather than a restored wall of
 * everything somebody had loaded ten minutes ago.
 *
 * Nothing here decides who may write, remove or like. The composer is absent
 * for a viewer with no employee record because there is nobody to attribute a
 * comment to, and the overflow menu renders only where it would have an item
 * in it. The refusals are the RLS policies in 046 and 047.
 */
export function CommentThread({ item }: CommentThreadProps) {
  const { employee, role } = useAuth()

  /* Mounted only while the post's conversation is open, so this fetches on
     open without needing to be told when that is. */
  const thread = useCommentThread(item.id, employee?.id)
  const addComment = useAddComment()
  const removeComment = useRemoveComment()

  const [visible, setVisible] = useState(FIRST_PAGE)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const moderator = role === 'hr_admin' || role === 'super_admin'
  const comments = useMemo(() => thread.data?.comments ?? [], [thread.data])

  // A Set, not the array it arrives as: every row asks this question, and an
  // array scan per row is quadratic in the length of the conversation.
  const likedIds = useMemo(() => new Set(thread.data?.likedIds ?? []), [thread.data])

  /*
    Flat rows in, two levels out.

    The query returns comments and replies together because they are one table
    and one round trip; the shape a thread is READ in is this component's
    business. Roots are reversed into newest-first; replies keep the order
    they were fetched in, which is oldest first.
  */
  const { roots, repliesOf } = useMemo(() => {
    const repliesOf = new Map<string, RecognitionComment[]>()
    const roots: RecognitionComment[] = []

    for (const comment of comments) {
      if (comment.parent_comment_id === null) {
        roots.push(comment)
        continue
      }
      const siblings = repliesOf.get(comment.parent_comment_id)
      if (siblings) siblings.push(comment)
      else repliesOf.set(comment.parent_comment_id, [comment])
    }

    roots.reverse()
    return { roots, repliesOf }
  }, [comments])

  /*
    An open overflow menu closes on the next press anywhere else.

    On MOUSEDOWN, which is what makes the menu feel like a menu — and which is
    why the menu and its button stop mousedown from propagating. Without that,
    pressing Delete would close the menu on mousedown and unmount the button
    before its own click could land, so the item would look pressable and do
    nothing.
  */
  useEffect(() => {
    if (menuFor === null) return
    const away = () => setMenuFor(null)
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [menuFor])

  const post = async (body: string, parentCommentId: string | null) => {
    if (!employee) return
    setError(null)
    try {
      await addComment.mutateAsync({
        nominationId: item.id,
        authorId: employee.id,
        body,
        parentCommentId,
      })

      if (parentCommentId) {
        // A reply lands inside a group that may be collapsed. Open it —
        // posting into a thread and being shown nothing is indistinguishable
        // from the post having failed.
        setExpanded(prev => new Set(prev).add(parentCommentId))
        setReplyTo(null)
      } else {
        // A new comment is the newest, so it is first in the list and already
        // on screen. Nothing to reveal.
        setVisible(v => Math.max(v, FIRST_PAGE))
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not post that comment.')
      throw err
    }
  }

  const remove = async (commentId: string) => {
    setMenuFor(null)
    setError(null)
    try {
      await removeComment.mutateAsync(commentId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not remove that comment.')
    }
  }

  const toggleReplies = (commentId: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(commentId)) next.delete(commentId)
      else next.add(commentId)
      return next
    })
  }

  const shown = roots.slice(0, visible)
  const remaining = roots.length - shown.length

  return (
    <section className="vsx-thread" aria-label="Comments on this recognition">
      {/* The composer first, the way a comment box sits directly under the
          post it is about. It is also where a new comment appears, since the
          list below is newest first. */}
      {employee ? (
        <Composer
          avatarName={employee.full_name}
          avatarUrl={employee.avatar_url}
          placeholder="Add a comment…"
          busy={addComment.isPending}
          onSubmit={body => post(body, null)}
          autoFocus
        />
      ) : (
        <p className="vsx-comment-note">Sign in to join the conversation.</p>
      )}

      {error && <p className="vsx-comment-note is-error" role="alert">{error}</p>}

      {thread.isPending && <p className="vsx-comment-note">Loading comments…</p>}

      {thread.isError && (
        <p className="vsx-comment-note is-error" role="alert">
          We could not load this conversation. Close it and try again.
        </p>
      )}

      {!thread.isPending && !thread.isError && roots.length === 0 && (
        <p className="vsx-comment-note">
          No comments yet. Say something about this recognition.
        </p>
      )}

      <ul className="vsx-comment-list">
        {shown.map(comment => {
          const replies = repliesOf.get(comment.id) ?? []
          const isOpen = expanded.has(comment.id)

          return (
            <li key={comment.id}>
              <CommentRow
                comment={comment}
                likedInitially={likedIds.has(comment.id)}
                canRemove={comment.author_id === employee?.id || moderator}
                isMine={comment.author_id === employee?.id}
                canReply={Boolean(employee)}
                menuOpen={menuFor === comment.id}
                onMenu={() => setMenuFor(m => (m === comment.id ? null : comment.id))}
                onRemove={() => void remove(comment.id)}
                onReply={() => setReplyTo(id => (id === comment.id ? null : comment.id))}
                removing={removeComment.isPending}
              />

              {(replies.length > 0 || replyTo === comment.id) && (
                <div className="vsx-replies">
                  {replies.length > 0 && (
                    <button
                      type="button"
                      className="vsx-replies-toggle"
                      onClick={() => toggleReplies(comment.id)}
                      aria-expanded={isOpen}
                    >
                      <ChevronDown
                        size={14}
                        aria-hidden="true"
                        style={{
                          transform: isOpen ? 'rotate(180deg)' : undefined,
                          transition: 'transform var(--vsx-t) var(--vsx-ease)',
                        }}
                      />
                      {isOpen ? 'Hide' : 'See'} {replies.length}{' '}
                      {replies.length === 1 ? 'reply' : 'replies'}
                    </button>
                  )}

                  {isOpen && (
                    <ul className="vsx-comment-list vsx-reply-list">
                      {replies.map(reply => (
                        <li key={reply.id}>
                          <CommentRow
                            comment={reply}
                            likedInitially={likedIds.has(reply.id)}
                            canRemove={reply.author_id === employee?.id || moderator}
                            isMine={reply.author_id === employee?.id}
                            /* A reply cannot be replied to (047). The control
                               is absent rather than present and failing. */
                            canReply={false}
                            menuOpen={menuFor === reply.id}
                            onMenu={() => setMenuFor(m => (m === reply.id ? null : reply.id))}
                            onRemove={() => void remove(reply.id)}
                            onReply={() => undefined}
                            removing={removeComment.isPending}
                            compact
                          />
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* The reply box opens UNDER the comment being answered,
                      not at the top of the thread — otherwise you would be
                      typing an answer several comments away from the thing
                      you are answering. */}
                  {replyTo === comment.id && employee && (
                    <Composer
                      avatarName={employee.full_name}
                      avatarUrl={employee.avatar_url}
                      placeholder={`Reply to ${comment.author?.full_name ?? 'this comment'}…`}
                      busy={addComment.isPending}
                      onSubmit={body => post(body, comment.id)}
                      onCancel={() => setReplyTo(null)}
                      autoFocus
                      compact
                    />
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {remaining > 0 && (
        <button
          type="button"
          className="vsx-load-more"
          onClick={() => setVisible(v => v + PAGE)}
        >
          <CornerDownRight size={14} aria-hidden="true" />
          Load more comments
          <span className="vsx-fig" style={{ fontSize: 13 }}>{remaining}</span>
        </button>
      )}
    </section>
  )
}

// ────────────────────────────────────────────────────────────

interface ComposerProps {
  avatarName: string
  avatarUrl?: string | null
  placeholder: string
  busy: boolean
  onSubmit: (body: string) => Promise<void>
  onCancel?: () => void
  autoFocus?: boolean
  compact?: boolean
}

/**
 * A box to write in.
 *
 * Owns its own draft, which is the reason it is a component rather than
 * markup repeated twice: the thread can have a comment box and a reply box
 * open at once, and a draft held by the thread would put the same half-typed
 * sentence in both.
 */
function Composer({
  avatarName, avatarUrl, placeholder, busy, onSubmit, onCancel, autoFocus, compact,
}: ComposerProps) {
  const [draft, setDraft] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) box.current?.focus()
  }, [autoFocus])

  /* Grows with what is typed. Height is reset before it is measured, or the
     box could only ever grow — deleting three lines would leave the hole they
     occupied. */
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [draft])

  const body = draft.trim()
  const canPost = body.length > 0 && body.length <= MAX_LENGTH && !busy

  const submit = async () => {
    if (!canPost) return
    try {
      await onSubmit(body)
      setDraft('')
    } catch {
      // The thread reports it. The draft stays exactly where it was, so
      // nothing anybody wrote is thrown away by a failed request.
    }
  }

  return (
    <div className={compact ? 'vsx-comment-composer is-compact' : 'vsx-comment-composer'}>
      <Avatar name={avatarName} avatarUrl={avatarUrl} size="xs" />

      <textarea
        ref={box}
        className="vsx-comment-input"
        rows={1}
        value={draft}
        maxLength={MAX_LENGTH}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          /* Enter posts; Shift+Enter breaks the line. The bargain every chat
             box makes, and the reason this is a textarea at all — a comment
             is usually one line but is allowed to be three. */
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void submit()
          }
          if (e.key === 'Escape' && onCancel) onCancel()
        }}
      />

      {/* The counter appears only when the limit is in sight. */}
      {draft.length > MAX_LENGTH - 100 && (
        <span className="vsx-comment-count" aria-live="polite">
          {MAX_LENGTH - draft.length}
        </span>
      )}

      {onCancel && (
        <button type="button" className="vsx-comment-action" onClick={onCancel}>
          Cancel
        </button>
      )}

      <button
        type="button"
        className="vsx-comment-post"
        onClick={() => void submit()}
        disabled={!canPost}
      >
        {busy ? 'Posting…' : 'Post'}
      </button>
    </div>
  )
}

// ────────────────────────────────────────────────────────────

interface CommentRowProps {
  comment: RecognitionComment
  likedInitially: boolean
  canRemove: boolean
  isMine: boolean
  canReply: boolean
  menuOpen: boolean
  onMenu: () => void
  onRemove: () => void
  onReply: () => void
  removing: boolean
  compact?: boolean
}

/**
 * One comment: who, when, what, and what can be done about it.
 *
 * The like lives HERE rather than in the thread, and holds its own count.
 * Pressing it is the most frequent thing anybody does in a conversation, and
 * a count owned by the thread would mean every press re-rendered every
 * comment on screen — including the one somebody is half-way through reading.
 */
function CommentRow({
  comment, likedInitially, canRemove, isMine, canReply,
  menuOpen, onMenu, onRemove, onReply, removing, compact,
}: CommentRowProps) {
  const { employee } = useAuth()
  const toggleLike = useToggleCommentLike()

  const [liked, setLiked] = useState(likedInitially)
  const [count, setCount] = useState(comment.like_count)

  // Re-sync when the thread refetches, or when this row is reused for a
  // different comment.
  useEffect(() => {
    setLiked(likedInitially)
    setCount(comment.like_count)
  }, [comment.id, comment.like_count, likedInitially])

  const like = async () => {
    if (!employee || toggleLike.isPending) return

    const wasLiked = liked
    setLiked(!wasLiked)
    setCount(c => (wasLiked ? Math.max(c - 1, 0) : c + 1))

    try {
      await toggleLike.mutateAsync({
        commentId: comment.id,
        employeeId: employee.id,
        nominationId: comment.nomination_id,
        liked: wasLiked,
      })
    } catch {
      // Put it back exactly as it was. Both directions roll back the same way.
      setLiked(wasLiked)
      setCount(c => (wasLiked ? c + 1 : Math.max(c - 1, 0)))
    }
  }

  const author = comment.author

  return (
    <article className={compact ? 'vsx-comment is-reply' : 'vsx-comment'}>
      <Avatar
        name={author?.full_name ?? '?'}
        avatarUrl={author?.avatar_url}
        size={compact ? 'xs' : 'sm'}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="vsx-comment-by">
          <strong className="vsx-comment-name">
            {/* No author means their employee row is not readable here —
                deactivated, or erased. The comment outlives the account
                either way, so the line says so rather than rendering a blank
                where a name should be. */}
            {author?.full_name ?? 'Former colleague'}
          </strong>
          <time className="vsx-comment-when" dateTime={comment.created_at}>
            {formatIST(comment.created_at, 'd MMM yyyy')}
          </time>
        </div>

        <p className="vsx-comment-body">{comment.body}</p>

        <div className="vsx-comment-actions">
          <button
            type="button"
            className={liked ? 'vsx-comment-like is-on' : 'vsx-comment-like'}
            onClick={() => void like()}
            disabled={!employee}
            aria-pressed={liked}
            aria-label={
              liked
                ? `Liked. ${count} ${count === 1 ? 'like' : 'likes'}. Select again to undo`
                : `Like this comment. ${count} ${count === 1 ? 'like' : 'likes'}`
            }
          >
            <ThumbsUp size={14} aria-hidden="true" strokeWidth={liked ? 2.2 : 1.7} />
            {count > 0 && <span className="vsx-fig" style={{ fontSize: 13 }}>{count}</span>}
          </button>

          {canReply && (
            <button type="button" className="vsx-comment-reply" onClick={onReply}>
              <MessageCircle size={14} aria-hidden="true" strokeWidth={1.7} />
              Reply
            </button>
          )}
        </div>
      </div>

      {/* The overflow menu renders only when it would have something in it,
          rather than opening empty on somebody else's comment. */}
      {canRemove && (
        <div className="vsx-comment-menu-wrap">
          <button
            type="button"
            className="vsx-comment-menu-btn"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onMenu() }}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={isMine ? 'Options for your comment' : 'Moderate this comment'}
          >
            <MoreVertical size={15} />
          </button>

          {menuOpen && (
            <div
              className="vsx-comment-menu"
              role="menu"
              onMouseDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                className="vsx-comment-menu-item is-danger"
                onClick={onRemove}
                disabled={removing}
              >
                {isMine ? 'Delete' : 'Remove as moderator'}
              </button>
              {/* Deleting a comment takes its replies (047), which is the kind
                  of thing somebody should read before pressing, not discover
                  afterwards. */}
              {comment.parent_comment_id === null && (
                <p className="vsx-comment-menu-note">Any replies go with it.</p>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  )
}
