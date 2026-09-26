/**
 * The signed-in person's own profile: name, designation, location, skills,
 * photo and banner.
 *
 * Everything here acts on the CALLER. There is no employee-id parameter on any
 * method, because the database functions behind them (054) take none — they
 * resolve the row from the session. HR editing somebody else's designation is
 * employeesApi.updateProfile(), a different operation under a different policy.
 */
import type { ProfileImageKind, PreparedImage } from '@/lib/profile-image'
import { supabase, toApiError, ApiError } from './client'

const BUCKET = 'profile-media'

/** The public-URL segment that precedes an object path in this bucket. */
const PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`

export interface ProfileDetailsInput {
  fullName: string
  designation: string
  location: string
  skills: string[]
}

interface FunctionResult {
  status?: string
  reason?: string
  field?: string
  url?: string | null
  previous?: string | null
}

/** Map a profile function's non-ok status to something a person can act on. */
function failure(result: FunctionResult | null, fallback: string): ApiError {
  switch (result?.status) {
    case 'invalid':
      return new ApiError(result.reason ?? fallback, result.field ? `invalid:${result.field}` : 'invalid')
    case 'needs_verification':
      return new ApiError('Please finish signing in (the email code step) before editing your profile.', 'needs_verification')
    case 'not_authenticated':
      return new ApiError('Your session has expired. Please sign in again.', 'unauthenticated')
    case 'inactive':
      return new ApiError('This account is inactive, so its profile cannot be changed.', 'inactive')
    case 'no_employee_record':
      return new ApiError('Your account is not linked to an employee record yet.', 'no_employee_record')
    default:
      return new ApiError(fallback, result?.status ?? 'unknown')
  }
}

/** The object path inside the bucket for a URL we issued, or null if it is not ours. */
function objectPathOf(url: string | null | undefined): string | null {
  if (!url) return null
  const at = url.indexOf(PUBLIC_MARKER)
  if (at === -1) return null
  const path = url.slice(at + PUBLIC_MARKER.length).split(/[?#]/)[0]
  return path || null
}

export const profileApi = {
  /** Save the text fields of the Edit Profile form, together. */
  async updateDetails(input: ProfileDetailsInput): Promise<void> {
    const { data, error } = await supabase.rpc('update_my_profile', {
      p_full_name: input.fullName,
      p_designation: input.designation.trim() || null,
      p_location: input.location.trim() || null,
      p_skills: input.skills,
    })

    if (error) throw toApiError(error, 'Could not save your profile.')

    const result = data as FunctionResult | null
    if (result?.status !== 'ok') throw failure(result, 'Could not save your profile.')
  },

  /**
   * Upload a prepared image into the caller's folder and return its public URL.
   *
   * Always a NEW file name, never an overwrite: every screen caches faces by
   * URL, so replacing the bytes behind an unchanged URL would leave the old
   * photo showing for whoever had it cached. A fresh name changes the URL and
   * sidesteps the question. The old file is deleted once the new one is saved.
   */
  async uploadImage(kind: ProfileImageKind, image: PreparedImage): Promise<string> {
    const { data: auth } = await supabase.auth.getUser()
    const uid = auth.user?.id
    if (!uid) throw new ApiError('Your session has expired. Please sign in again.', 'unauthenticated')

    const stamp = Date.now().toString(36)
    const nonce = Math.random().toString(36).slice(2, 8)
    const path = `${uid}/${kind}-${stamp}-${nonce}.${image.ext}`

    const { error } = await supabase.storage.from(BUCKET).upload(path, image.blob, {
      contentType: image.contentType,
      cacheControl: '31536000',
      upsert: false,
    })

    if (error) {
      const message = (error as { message?: string }).message ?? ''
      if (/bucket not found/i.test(message)) {
        throw new ApiError(
          'Photo uploads are not set up on this database yet. Ask IT to apply the latest migration.',
          'not_installed',
          error,
        )
      }
      if (/row-level security|unauthori[sz]ed|403/i.test(message)) {
        throw new ApiError('You are not allowed to upload that image. Try signing in again.', 'forbidden', error)
      }
      if (/exceeded|too large|payload/i.test(message)) {
        throw new ApiError('That image is too large to upload.', 'too_large', error)
      }
      throw new ApiError('The image could not be uploaded. Please try again.', 'upload_failed', error)
    }

    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  },

  /**
   * Point the profile at an uploaded image, or remove it with `null`.
   *
   * Returns the URL it replaced so the caller can tidy the old file away.
   */
  async setImage(kind: ProfileImageKind, url: string | null): Promise<{ previous: string | null }> {
    const { data, error } = await supabase.rpc('set_my_profile_image', {
      p_kind: kind,
      p_url: url,
    })

    if (error) throw toApiError(error, 'Could not update that image.')

    const result = data as FunctionResult | null
    if (result?.status !== 'ok') throw failure(result, 'Could not update that image.')
    return { previous: result.previous ?? null }
  },

  /**
   * Delete a file we uploaded earlier. Best-effort and silent: a leftover
   * file costs a few kilobytes of storage and nobody can see it, whereas an
   * error here would report a failure for a save that in fact succeeded.
   * A URL that is not in this bucket (a seeded avatar, say) is left alone.
   */
  async discardImage(url: string | null | undefined): Promise<void> {
    const path = objectPathOf(url)
    if (!path) return
    try {
      await supabase.storage.from(BUCKET).remove([path])
    } catch {
      /* see above */
    }
  },
}
