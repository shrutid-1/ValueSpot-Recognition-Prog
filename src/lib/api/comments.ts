/**
 * The conversation under a recognition.
 *
 * Plain table reads and writes against nomination_comments (migration 046)
 * and nomination_comment_likes (047) — no RPC, because there is no decision
 * to make server-side beyond the ones the policies already make. What may be
 * written, by whom, and on which recognitions is settled by RLS:
 * `comments_insert_own` refuses an author id that is not yours and refuses
 * any nomination that is not approved, `comments_delete_own_or_moderator`
 * refuses a delete that is neither yours nor a moderator's, and a trigger
 * refuses a reply to a reply. Nothing in this file authorises anything.
 *
 * ONE THREAD AT A TIME
 * --------------------
 * A thread is fetched when its dialog opens, not with the feed. The feed
 * shows a count and nothing else, so twenty posts are twenty numbers on rows
 * the feed was fetching anyway — and the conversation, which is the expensive
 * part, is loaded only for the post somebody actually opened.
 *
 * Replies come back in the same array as the comments they answer, flat, with
 * `parent_comment_id` saying which is which. Nesting them is the renderer's
 * business: it is a display question, it is one level deep by construction,
 * and a second query for replies would double the round trips to rebuild
 * something the first query already contains.
 */
import { supabase, toApiError } from './client'

/** A comment or a reply, with the person who wrote it resolved by join. */
export interface RecognitionComment {
  id: string
  nomination_id: string
  author_id: string
  body: string
  created_at: string
  /** Null for a comment; the comment's id for a reply to it. */
  parent_comment_id: string | null
  /** Counted at read time, never stored. */
  like_count: number
  /**
   * Resolved from employees rather than stored on the row, so a rename
   * corrects every comment that person has ever written.
   *
   * Nullable, because the join comes back empty whenever the author's
   * employee row is not readable by this viewer: employees_read_active (001,
   * narrowed in 022) serves ACTIVE people, so a comment written by somebody
   * since deactivated or erased has no author to show. The renderer names
   * that case rather than crashing on a name it assumed was there.
   */
  author: { id: string; full_name: string; avatar_url: string | null } | null
}

/** A thread, with the viewer's own likes on it. */
export interface CommentThread {
  /** Comments and replies together, oldest first. */
  comments: RecognitionComment[]
  /**
   * Ids in `comments` this viewer has liked.
   *
   * Carried with the thread rather than fetched per comment, and shaped the
   * same way the feed carries `appreciatedIds`: the server knows who is
   * asking, so it can answer "and which of these are yours" in the same trip
   * instead of leaving every row to ask on its own.
   */
  likedIds: string[]
}

/*
  `likes:...(count)` asks PostgREST to aggregate the related rows rather than
  return them. The alternative is selecting every like row for every comment
  and counting them here, which downloads a row per like to produce a number.
*/
const COMMENT_COLUMNS = `
  id,
  nomination_id,
  author_id,
  body,
  created_at,
  parent_comment_id,
  author:author_id (id, full_name, avatar_url),
  likes:nomination_comment_likes(count)
`

/** The shape PostgREST returns for the select above, before it is flattened. */
interface RawComment extends Omit<RecognitionComment, 'like_count'> {
  likes: { count: number }[] | null
}

const flatten = (rows: RawComment[]): RecognitionComment[] =>
  rows.map(({ likes, ...rest }) => ({
    ...rest,
    // An aggregate comes back as a one-element array, and as an empty one
    // when nothing has been liked.
    like_count: likes?.[0]?.count ?? 0,
  }))

export const commentsApi = {
  /**
   * One recognition's whole conversation, oldest first.
   *
   * Oldest first because that is the order a conversation happened in, and
   * the order it has to be read in for a reply to make sense. The dialog
   * scrolls; the newest is at the bottom, where the composer is.
   */
  async list(nominationId: string, viewerId?: string): Promise<CommentThread> {
    const { data, error } = await supabase
      .from('nomination_comments')
      .select(COMMENT_COLUMNS)
      .eq('nomination_id', nominationId)
      .order('created_at', { ascending: true })

    if (error) throw toApiError(error, 'We could not load the comments.')

    const comments = flatten((data ?? []) as unknown as RawComment[])
    if (!viewerId || comments.length === 0) return { comments, likedIds: [] }

    const { data: mine, error: likeError } = await supabase
      .from('nomination_comment_likes')
      .select('comment_id')
      .eq('employee_id', viewerId)
      .in('comment_id', comments.map(c => c.id))

    // A thread that loaded is worth showing even if "which of these did I
    // like" did not. The hearts render unpressed rather than the dialog
    // failing over a detail.
    if (likeError) return { comments, likedIds: [] }

    return { comments, likedIds: (mine ?? []).map(l => l.comment_id) }
  },

  /**
   * Leave a comment, or a reply to one.
   *
   * The body is trimmed here because the database's length check is applied
   * to the trimmed text — sending the untrimmed string would let a comment of
   * five spaces travel all the way to a constraint violation, and would store
   * a leading newline on every comment typed after one.
   *
   * `parentCommentId` is passed through untouched. Whether it names a real
   * comment, on this recognition, that is not itself a reply is checked by
   * the depth trigger (047), not here.
   */
  async add(input: {
    nominationId: string
    authorId: string
    body: string
    parentCommentId?: string | null
  }): Promise<RecognitionComment> {
    const { data, error } = await supabase
      .from('nomination_comments')
      .insert({
        nomination_id: input.nominationId,
        author_id: input.authorId,
        body: input.body.trim(),
        parent_comment_id: input.parentCommentId ?? null,
      })
      .select(COMMENT_COLUMNS)
      .single()

    if (error) throw toApiError(error, 'We could not post that comment.')

    return flatten([data as unknown as RawComment])[0]
  },

  /**
   * Remove a comment, and with it any replies.
   *
   * Takes only the id. Who is allowed to remove it — its author, or HR and a
   * Super Admin — is the delete policy's decision, and passing a role or an
   * employee id from here would be offering a lever that does nothing. The
   * replies go by cascade (047), in the database, not in a second call.
   *
   * Deleting nothing is not an error: it means the comment was already gone,
   * which is the end state the caller wanted.
   */
  async remove(commentId: string): Promise<{ removed: boolean }> {
    const { data, error } = await supabase
      .from('nomination_comments')
      .delete()
      .eq('id', commentId)
      .select('id')

    if (error) throw toApiError(error, 'We could not remove that comment.')

    return { removed: (data ?? []).length > 0 }
  },

  /**
   * Like a comment.
   *
   * Returns whether this call was the one that recorded it — a unique
   * violation means the like was already there, which is the end state the
   * caller wanted, so it is not an error. The same distinction
   * `recognitionsApi.appreciate` reports, for the same reason: a row showing
   * an optimistic +1 has to know whether to undo it.
   */
  async like(commentId: string, employeeId: string): Promise<{ recorded: boolean }> {
    const { error } = await supabase
      .from('nomination_comment_likes')
      .insert({ comment_id: commentId, employee_id: employeeId })

    if (!error) return { recorded: true }
    if ((error as { code?: string }).code === '23505') return { recorded: false }

    throw toApiError(error, 'We could not record that.')
  },

  /** Take a like back. Deleting nothing means it was already gone. */
  async unlike(commentId: string, employeeId: string): Promise<{ removed: boolean }> {
    const { data, error } = await supabase
      .from('nomination_comment_likes')
      .delete()
      .eq('comment_id', commentId)
      .eq('employee_id', employeeId)
      .select('id')

    if (error) throw toApiError(error, 'We could not undo that.')

    return { removed: (data ?? []).length > 0 }
  },
}
