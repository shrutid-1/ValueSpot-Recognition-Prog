import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Loader2, Minus, Plus, RotateCcw } from 'lucide-react'
import { ApiError } from '@/lib/api'
import {
  cropProfileImage, loadProfileImage, ProfileImageError, PROFILE_IMAGE_ASPECT,
  type LoadedProfileImage, type PreparedImage, type ProfileImageKind,
} from '@/lib/profile-image'
import { ProfileDialog } from './ProfileDialog'

/**
 * Where the frame sits on the image, independent of screen size.
 *
 * `cx`/`cy` are the point of the image at the centre of the frame, as
 * fractions of its width and height. `zoom` is 1 when the image just covers
 * the frame. Pixel-free on purpose: the stage resizes with the window (and
 * turns with a phone), and a crop stored in pixels would drift when it did.
 */
export interface CropState {
  zoom: number
  cx: number
  cy: number
}

const DEFAULT_CROP: CropState = { zoom: 1, cx: 0.5, cy: 0.5 }

const MAX_ZOOM = 4
const ZOOM_STEP = 0.2
/** Longest side of the on-screen copy. The export reads the full image. */
const DISPLAY_MAX = 2048

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Fraction of the image's width and height the frame covers at zoom 1.
 * One of the two is always 1: the image is scaled to just cover the frame.
 */
function coverFractions(width: number, height: number, aspect: number) {
  const imageAspect = width / height
  return imageAspect > aspect
    ? { fw: aspect / imageAspect, fh: 1 }   // wider than the frame: sides overflow
    : { fw: 1, fh: imageAspect / aspect }   // taller than the frame: top and bottom overflow
}

/** Keep the frame on the image: no empty strip may show inside it. */
function clampCrop(c: CropState, fw: number, fh: number): CropState {
  const zoom = clamp(c.zoom, 1, MAX_ZOOM)
  const hw = fw / zoom / 2
  const hh = fh / zoom / 2
  return { zoom, cx: clamp(c.cx, hw, 1 - hw), cy: clamp(c.cy, hh, 1 - hh) }
}

interface ImageCropDialogProps {
  open: boolean
  file: File | null
  kind: ProfileImageKind
  /** Where to start — a previous crop of the same file, when re-adjusting. */
  initial?: CropState
  /** Label of the confirm button. "Apply" when the result is staged, "Save" when it is saved at once. */
  applyLabel?: string
  onCancel: () => void
  /**
   * Receives the cropped image. If it returns a promise the dialog stays open
   * and busy until it settles, and shows the error if it rejects — so a save
   * that fails does not throw the person's framing away.
   */
  onApply: (result: { image: PreparedImage; crop: CropState }) => void | Promise<void>
}

export function ImageCropDialog({
  open, file, kind, initial, applyLabel = 'Apply', onCancel, onApply,
}: ImageCropDialogProps) {
  const aspect = PROFILE_IMAGE_ASPECT[kind]
  const round = kind === 'avatar'

  const [loaded, setLoaded] = useState<LoadedProfileImage | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [crop, setCrop] = useState<CropState>(initial ?? DEFAULT_CROP)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [active, setActive] = useState(false)
  const [stageW, setStageW] = useState(0)

  // State rather than a ref, so measuring and the wheel listener follow the
  // stage element that is actually mounted if it is ever replaced.
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // ---- Load the file whenever the dialog opens on a new one -----------------
  useEffect(() => {
    if (!open || !file) return
    let cancelled = false
    let current: LoadedProfileImage | null = null

    setLoaded(null)
    setLoadError(null)
    setApplyError(null)
    setApplying(false)
    setCrop(initial ?? DEFAULT_CROP)

    loadProfileImage(file)
      .then(img => {
        if (cancelled) { img.release(); return }
        current = img
        setLoaded(img)
      })
      .catch(err => {
        if (!cancelled) {
          setLoadError(err instanceof ProfileImageError ? err.message : 'That image could not be opened.')
        }
      })

    return () => {
      cancelled = true
      current?.release()
    }
    // `initial` is read once per file; a new object each render must not reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, file])

  const { fw, fh } = loaded
    ? coverFractions(loaded.width, loaded.height, aspect)
    : { fw: 1, fh: 1 }

  // Re-clamp once the image's shape is known (an `initial` from a different
  // stage is already valid, but DEFAULT_CROP is too until now).
  useEffect(() => {
    if (loaded) setCrop(c => clampCrop(c, fw, fh))
  }, [loaded, fw, fh])

  // ---- Stage geometry --------------------------------------------------------
  useLayoutEffect(() => {
    const el = stageEl
    if (!el) return
    const measure = () => { if (el.isConnected) setStageW(el.clientWidth) }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [stageEl])

  const pad = round ? 28 : 20
  const frameW = round
    ? Math.max(120, Math.min(stageW - pad * 2, 300))
    : Math.max(160, stageW - pad * 2)
  const frameH = frameW / aspect
  const stageH = Math.round(frameH + pad * 2 + (round ? 0 : 24))

  // On-screen size of the whole image at the current zoom.
  const dw = (frameW * crop.zoom) / fw
  const dh = (frameH * crop.zoom) / fh
  const imgLeft = stageW / 2 - crop.cx * dw
  const imgTop = stageH / 2 - crop.cy * dh

  // Paint the on-screen copy once per image — and again if the canvas is
  // first mounted later, which waits on the stage having been measured.
  const hasStage = stageW > 0
  useEffect(() => {
    const canvas = canvasRef.current
    if (!loaded || !canvas || !hasStage) return
    const scale = Math.min(1, DISPLAY_MAX / Math.max(loaded.width, loaded.height))
    canvas.width = Math.max(1, Math.round(loaded.width * scale))
    canvas.height = Math.max(1, Math.round(loaded.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(loaded.source, 0, 0, canvas.width, canvas.height)
  }, [loaded, hasStage])

  // ---- Moving and zooming ----------------------------------------------------

  /** Shift the image by a screen distance (the image follows the pointer). */
  const panBy = useCallback((dx: number, dy: number) => {
    setCrop(c => {
      const w = (frameW * c.zoom) / fw
      const h = (frameH * c.zoom) / fh
      return clampCrop({ ...c, cx: c.cx - dx / w, cy: c.cy - dy / h }, fw, fh)
    })
  }, [frameW, frameH, fw, fh])

  /**
   * Zoom, keeping the point under (ax, ay) — measured from the frame centre in
   * screen pixels — where it is. Buttons and the slider zoom about the centre.
   */
  const zoomTo = useCallback((next: number | ((z: number) => number), ax = 0, ay = 0) => {
    setCrop(c => {
      const zoom = clamp(typeof next === 'function' ? next(c.zoom) : next, 1, MAX_ZOOM)
      const w0 = (frameW * c.zoom) / fw, h0 = (frameH * c.zoom) / fh
      const w1 = (frameW * zoom) / fw,   h1 = (frameH * zoom) / fh
      const u = c.cx + ax / w0
      const v = c.cy + ay / h0
      return clampCrop({ zoom, cx: u - ax / w1, cy: v - ay / h1 }, fw, fh)
    })
  }, [frameW, frameH, fw, fh])

  // Pointer dragging, and pinch with two fingers.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; zoom: number } | null>(null)
  const zoomRef = useRef(crop.zoom)
  zoomRef.current = crop.zoom

  const onPointerDown = (e: React.PointerEvent) => {
    if (!loaded || applying) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setActive(true)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: zoomRef.current }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const next = { x: e.clientX, y: e.clientY }
    pointers.current.set(e.pointerId, next)

    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const rect = e.currentTarget.getBoundingClientRect()
      const mx = (a.x + b.x) / 2 - (rect.left + rect.width / 2)
      const my = (a.y + b.y) / 2 - (rect.top + rect.height / 2)
      const start = pinch.current
      zoomTo(start.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / start.dist), mx, my)
    } else {
      panBy(next.x - prev.x, next.y - prev.y)
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) setActive(false)
  }

  // The wheel needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const el = stageEl
    if (!el || !loaded) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const ax = e.clientX - (rect.left + rect.width / 2)
      const ay = e.clientY - (rect.top + rect.height / 2)
      zoomTo(z => z * Math.exp(-e.deltaY * 0.0015), ax, ay)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [stageEl, loaded, zoomTo])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!loaded || applying) return
    const step = e.shiftKey ? 40 : 10
    switch (e.key) {
      case 'ArrowLeft':  panBy(step, 0); break
      case 'ArrowRight': panBy(-step, 0); break
      case 'ArrowUp':    panBy(0, step); break
      case 'ArrowDown':  panBy(0, -step); break
      case '+': case '=': zoomTo(z => z + ZOOM_STEP); break
      case '-': case '_': zoomTo(z => z - ZOOM_STEP); break
      case '0':          setCrop(clampCrop(DEFAULT_CROP, fw, fh)); break
      default: return
    }
    e.preventDefault()
  }

  // ---- Apply -----------------------------------------------------------------
  const apply = async () => {
    if (!loaded || applying) return
    setApplying(true)
    setApplyError(null)
    try {
      const c = clampCrop(crop, fw, fh)
      const width = (fw / c.zoom) * loaded.width
      const height = (fh / c.zoom) * loaded.height
      const image = await cropProfileImage(loaded, {
        x: c.cx * loaded.width - width / 2,
        y: c.cy * loaded.height - height / 2,
        width,
        height,
      }, kind)
      await onApply({ image, crop: c })
    } catch (err) {
      setApplyError(
        err instanceof ProfileImageError || err instanceof ApiError
          ? err.message
          : 'Something went wrong. Please try again.',
      )
    } finally {
      setApplying(false)
    }
  }

  const zoomPct = Math.round(crop.zoom * 100)
  const atDefault = Math.abs(crop.zoom - 1) < 0.001 &&
    Math.abs(crop.cx - clampCrop(DEFAULT_CROP, fw, fh).cx) < 0.001 &&
    Math.abs(crop.cy - clampCrop(DEFAULT_CROP, fw, fh).cy) < 0.001

  return (
    <ProfileDialog
      open={open}
      onClose={onCancel}
      title={kind === 'avatar' ? 'Crop profile photo' : 'Crop background image'}
      description={kind === 'avatar'
        ? 'Choose what shows inside the circle.'
        : 'Choose the part of the image that fills your banner.'}
      busy={applying}
      width={kind === 'avatar' ? 480 : 720}
      footer={
        <>
          <button type="button" className="vs-btn" onClick={onCancel} disabled={applying}>Cancel</button>
          <button
            type="button"
            className="vs-btn vs-btn-primary"
            onClick={apply}
            disabled={!loaded || applying}
            aria-busy={applying}
          >
            {applying ? (applyLabel === 'Apply' ? 'Applying…' : 'Saving…') : applyLabel}
          </button>
        </>
      }
    >
      {applyError && <p role="alert" className="vp-form-error">{applyError}</p>}

      <div
        ref={setStageEl}
        className="vp-crop-stage"
        data-active={active || undefined}
        style={{ height: stageH }}
        tabIndex={loaded ? 0 : -1}
        data-autofocus
        role="group"
        aria-roledescription="image cropper"
        aria-label={`Crop area, zoom ${zoomPct}%. Drag or use the arrow keys to move the image, plus and minus to zoom.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        {loaded && hasStage && (
          <canvas
            ref={canvasRef}
            className="vp-crop-image"
            aria-hidden="true"
            style={{
              width: dw,
              height: dh,
              transform: `translate3d(${imgLeft}px, ${imgTop}px, 0)`,
            }}
          />
        )}

        {/* The frame: everything outside it is dimmed, and the grid inside
            it is the rule of thirds. */}
        {hasStage && (
          <div
            className="vp-crop-frame"
            data-round={round || undefined}
            aria-hidden="true"
            style={{ width: frameW, height: frameH }}
          >
            <span className="vp-crop-grid" />
          </div>
        )}

        {!loaded && !loadError && (
          <div className="vp-crop-status"><Loader2 size={22} className="animate-spin" aria-label="Loading image" /></div>
        )}
        {loadError && (
          <div className="vp-crop-status" role="alert">{loadError}</div>
        )}
      </div>

      <div className="vp-crop-controls">
        <button
          type="button"
          className="vp-crop-btn"
          onClick={() => zoomTo(z => z - ZOOM_STEP)}
          disabled={!loaded || applying || crop.zoom <= 1}
          aria-label="Zoom out"
        >
          <Minus size={16} />
        </button>
        <label className="vp-crop-zoom">
          <span className="sr-only">Zoom</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            onChange={e => zoomTo(Number(e.target.value))}
            disabled={!loaded || applying}
            aria-valuetext={`${zoomPct}%`}
          />
        </label>
        <button
          type="button"
          className="vp-crop-btn"
          onClick={() => zoomTo(z => z + ZOOM_STEP)}
          disabled={!loaded || applying || crop.zoom >= MAX_ZOOM}
          aria-label="Zoom in"
        >
          <Plus size={16} />
        </button>
        <span className="vp-crop-pct" aria-hidden="true">{zoomPct}%</span>
        <button
          type="button"
          className="vp-mini-btn"
          onClick={() => setCrop(clampCrop(DEFAULT_CROP, fw, fh))}
          disabled={!loaded || applying || atDefault}
        >
          <RotateCcw size={13} /> Reset
        </button>
      </div>

      <p className="vp-field-hint">
        Drag the image to reposition it. Zoom with the slider, the mouse wheel or a pinch.
      </p>
    </ProfileDialog>
  )
}
