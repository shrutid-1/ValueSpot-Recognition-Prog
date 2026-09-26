import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { commentsApi, type CommentThread } from '@/lib/api'
import { keys, useInvalidate } from '@/lib/query'

/**
 * One recognition's conversation.
 *
 *     component → hook → commentsApi → nomination_comments → RLS
 *
 * Fetched when the thread opens and not before, which needs no flag: the post
 * mounts this hook's component only while the conversation is open and
 * unmounts it on close. Closing keeps the thread cached, so reopening the
 * same post is instant and still refetches in the background.
 */
export function useCommentThread(
  nominationId: string | undefined,
  viewerId: string | undefined,
) {
  return useQuery({
    queryKey: keys.comments.thread(nominationId ?? 'none', viewerId ?? 'anon'),
    queryFn: () => commentsApi.list(nominationId!, viewerId),
    enabled: Boolean(nominationId),
  })
}

/**
 * Leave a comment, or a reply to one.
 *
 * No optimistic insert. A comment is attributed, timestamped and immediately
 * visible to colleagues, and showing one as posted before the database has
 * accepted it means showing a line that may be about to vanish — an insert
 * can still be refused, by the approved-only rule, by the depth trigger, or
 * by a lost session. The round trip is one short request and the composer
 * clears when it lands.
 */
export function useAddComment() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: commentsApi.add,
    onSuccess: () => invalidate.comments(),
  })
}

/** Remove a comment — your own, or anyone's if you moderate. */
export function useRemoveComment() {
  const invalidate = useInvalidate()

  return useMutation({
    mutationFn: (commentId: string) => commentsApi.remove(commentId),
    onSuccess: () => invalidate.comments(),
  })
}

/**
 * Like a comment, or take the like back.
 *
 * ONE mutation for both directions, because they are one gesture: the button
 * is a toggle and the caller knows which way it is going. Two hooks would
 * mean two sets of pending state for one control.
 *
 * WHY THIS PATCHES THE CACHE INSTEAD OF INVALIDATING
 * --------------------------------------------------
 * Invalidating refetches the whole conversation to move one number by one,
 * and rebuilds every comment on screen while somebody is still reading one.
 *
 * But doing nothing is worse, and not obviously so: the row holds the new
 * state optimistically, which survives exactly as long as the row does.
 * Close the dialog and reopen it inside the 30-second staleTime and React
 * Query serves the cached thread without refetching — built from a
 * `likedIds` that never heard about the like. The like appears to have
 * undone itself.
 *
 * So the cache is corrected in place: the count on that one comment, and its
 * membership in `likedIds`. No request, no re-render of the thread behind the
 * dialog, and reopening shows what actually happened.
 */
export function useToggleCommentLike() {
  const qc = useQueryClient()

  return useMutation({
    /* Returns void rather than either call's own result shape. `like` reports
       `recorded` and `unlike` reports `removed`, and a union of the two is
       both awkward to type and useless to the caller: the row already knows
       which way it went, and a press that did not change anything ended in
       the state that was wanted either way. */
    mutationFn: async (input: {
      commentId: string
      employeeId: string
      nominationId: string
      liked: boolean
    }): Promise<void> => {
      if (input.liked) await commentsApi.unlike(input.commentId, input.employeeId)
      else await commentsApi.like(input.commentId, input.employeeId)
    },

    onSuccess: (_result, input) => {
      const key = keys.comments.thread(input.nominationId, input.employeeId)

      qc.setQueryData<CommentThread>(key, prev => {
        if (!prev) return prev

        // `liked` is the state BEFORE the press, so the press removed a like
        // when it was true.
        const removed = input.liked

        return {
          comments: prev.comments.map(c =>
            c.id === input.commentId
              ? { ...c, like_count: Math.max(c.like_count + (removed ? -1 : 1), 0) }
              : c,
          ),
          likedIds: removed
            ? prev.likedIds.filter(id => id !== input.commentId)
            : [...prev.likedIds, input.commentId],
        }
      })
    },
  })
}
