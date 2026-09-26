/**
 * Getting a picked photo into shape before it leaves the browser.
 *
 * Two steps, with the person in between:
 *
 *   loadProfileImage()  validate and decode the file, once
 *   — the crop dialog lets them choose the region to keep —
 *   cropProfileImage()  cut that region out and re-encode it
 *
 * A phone photo is 4-12 MB and 4000px wide; the profile shows it at 112px or
 * as a banner. Uploading the original would cost the person the bandwidth,
 * cost every viewer of every list that shows their face, and blow straight
 * through the bucket's 5 MB limit. So what is uploaded is only the chosen
 * region, at the size it is shown, as a small WebP (or JPEG where the browser
 * cannot encode WebP).
 *
 * Re-encoding also strips EXIF — including GPS — which a profile photo has no
 * business publishing.
 */

export type ProfileImageKind = 'avatar' | 'cover'

/** Output size per kind. The banner is 3.75:1, the photo square. */
export const PROFILE_IMAGE_SIZE: Record<ProfileImageKind, { width: number; height: number }> = {
  avatar: { width: 512, height: 512 },
  cover:  { width: 1500, height: 400 },
}

/** Width ÷ height of the region kept for each kind. */
export const PROFILE_IMAGE_ASPECT: Record<ProfileImageKind, number> = {
  avatar: PROFILE_IMAGE_SIZE.avatar.width / PROFILE_IMAGE_SIZE.avatar.height,
  cover:  PROFILE_IMAGE_SIZE.cover.width / PROFILE_IMAGE_SIZE.cover.height,
}

/** What the file picker accepts. HEIC is absent: browsers cannot decode it. */
export const PROFILE_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'

/** Refuse before decoding anything larger — decoding is where the memory goes. */
const MAX_INPUT_BYTES = 15 * 1024 * 1024

export class ProfileImageError extends Error {}

export interface PreparedImage {
  blob: Blob
  /** File extension matching the encoded type, without the dot. */
  ext: 'webp' | 'jpg'
  contentType: 'image/webp' | 'image/jpeg'
}

/** A decoded image, upright, ready to be framed and cut. */
export interface LoadedProfileImage {
  source: CanvasImageSource
  /** Pixel size as displayed — i.e. after EXIF rotation. */
  width: number
  height: number
  /** Free the decoded pixels. Safe to call more than once. */
  release: () => void
}

/** The region to keep, in the loaded image's pixels. */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/** Refuse a file before any work is done on it. */
export function checkProfileImageFile(file: File): void {
  if (!PROFILE_IMAGE_ACCEPT.split(',').includes(file.type)) {
    throw new ProfileImageError('Please choose a JPG, PNG, WebP or GIF image.')
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new ProfileImageError('That image is larger than 15 MB. Please choose a smaller one.')
  }
}

export async function loadProfileImage(file: File): Promise<LoadedProfileImage> {
  checkProfileImageFile(file)

  // createImageBitmap honours EXIF orientation, so a portrait phone photo is
  // framed and uploaded the right way up.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      if (!bitmap.width || !bitmap.height) throw new ProfileImageError('That image appears to be empty.')
      let released = false
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => { if (!released) { released = true; bitmap.close() } },
      }
    } catch (err) {
      if (err instanceof ProfileImageError) throw err
      // Fall through to <img>, which some browsers decode more formats with.
    }
  }

  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('empty')
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    }
  } catch {
    URL.revokeObjectURL(url)
    throw new ProfileImageError('That file could not be read as an image. Try a JPG, PNG or WebP.')
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality))
}

/** Cut `rect` out of the image, scale it to the kind's size, and re-encode. */
export async function cropProfileImage(
  image: LoadedProfileImage,
  rect: CropRect,
  kind: ProfileImageKind,
): Promise<PreparedImage> {
  const target = PROFILE_IMAGE_SIZE[kind]

  // Keep the rectangle inside the image; rounding in the caller can push an
  // edge a fraction of a pixel out.
  const w = Math.min(rect.width, image.width)
  const h = Math.min(rect.height, image.height)
  const x = Math.min(Math.max(0, rect.x), image.width - w)
  const y = Math.min(Math.max(0, rect.y), image.height - h)

  // Never scale UP: a small source stays small rather than going soft.
  const scale = Math.min(1, target.width / w)
  const outW = Math.max(1, Math.round(w * scale))
  const outH = Math.max(1, Math.round(outW / PROFILE_IMAGE_ASPECT[kind]))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ProfileImageError('Your browser could not process that image.')

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // A transparent PNG would otherwise encode to black in JPEG.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, outW, outH)
  ctx.drawImage(image.source, x, y, w, h, 0, 0, outW, outH)

  // WebP where supported; Safari before 17 silently returns PNG instead, so
  // the type is checked rather than assumed.
  const webp = await toBlob(canvas, 'image/webp', 0.86)
  if (webp && webp.type === 'image/webp') {
    return { blob: webp, ext: 'webp', contentType: 'image/webp' }
  }

  const jpeg = await toBlob(canvas, 'image/jpeg', 0.88)
  if (jpeg && jpeg.type === 'image/jpeg') {
    return { blob: jpeg, ext: 'jpg', contentType: 'image/jpeg' }
  }

  throw new ProfileImageError('Your browser could not process that image.')
}
