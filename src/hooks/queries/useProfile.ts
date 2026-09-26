import { useMutation, useQueryClient } from '@tanstack/react-query'
import { profileApi, type ProfileDetailsInput } from '@/lib/api'
import type { PreparedImage, ProfileImageKind } from '@/lib/profile-image'
import { useAuth } from '@/context/AuthContext'

/**
 * One save of the caller's own profile.
 *
 * For each image: a PreparedImage replaces it, `null` removes it, and leaving
 * the key out leaves it alone. `details` is the text half of the Edit Profile
 * form, sent only when present.
 */
export interface SaveMyProfileInput {
  details?: ProfileDetailsInput
  avatar?: PreparedImage | null
  cover?: PreparedImage | null
}

const IMAGE_KINDS: ProfileImageKind[] = ['avatar', 'cover']

/**
 * Save the caller's profile, in the only order that cannot strand anything:
 *
 *   1. upload new images      — nothing points at them yet
 *   2. point the profile at them, which returns what they replaced
 *   3. save the text fields
 *   4. delete the replaced files
 *
 * An upload that never got pointed at (step 2 or 3 failed) is deleted again,
 * so a failed save leaves storage as it found it. The person's own record is
 * re-read whatever happened, so the page shows exactly what was saved even
 * when only part of it was.
 *
 * Every cached query is invalidated on success, not a chosen few. A face or a
 * name appears in the feed, comments, leader boards, approvals, the team and
 * directory screens — listing them would be a list that is wrong the day
 * someone adds another. Only the queries on screen refetch immediately; the
 * rest are marked stale and refresh when next shown, so this costs little.
 */
export function useSaveMyProfile() {
  const qc = useQueryClient()
  const { refreshEmployee } = useAuth()

  return useMutation({
    mutationFn: async (input: SaveMyProfileInput) => {
      const uploaded: Partial<Record<ProfileImageKind, string>> = {}
      const applied = new Set<ProfileImageKind>()
      const replaced: string[] = []

      try {
        for (const kind of IMAGE_KINDS) {
          const image = input[kind]
          if (image) uploaded[kind] = await profileApi.uploadImage(kind, image)
        }

        for (const kind of IMAGE_KINDS) {
          if (input[kind] === undefined) continue
          const { previous } = await profileApi.setImage(kind, uploaded[kind] ?? null)
          applied.add(kind)
          if (previous && previous !== uploaded[kind]) replaced.push(previous)
        }

        if (input.details) await profileApi.updateDetails(input.details)
      } catch (err) {
        // Uploads that nothing points at are orphans — take them back out.
        await Promise.all(
          IMAGE_KINDS
            .filter(kind => uploaded[kind] && !applied.has(kind))
            .map(kind => profileApi.discardImage(uploaded[kind])),
        )
        // Whatever DID save (an image, before the text failed) is real, and
        // the old file it replaced is now unreferenced.
        await Promise.all(replaced.map(url => profileApi.discardImage(url)))
        throw err
      } finally {
        await refreshEmployee()
      }

      await Promise.all(replaced.map(url => profileApi.discardImage(url)))
    },
    onSuccess: () => { void qc.invalidateQueries() },
  })
}
