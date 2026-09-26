import { useEffect } from 'react'
import { X } from 'lucide-react'

interface BadgeUnlockToastProps {
  badgeName: string
  coreValueName: string
  recognitionCount: number
  previousBadgeName?: string | null
  onClose: () => void
}

/**
 * Additive blueprint badge mark.
 *
 * The same geometry the journey screens draw: each level ADDS to the one
 * below it, so the shape itself records how far somebody has come. Static
 * here — animating it belongs to the celebration work, not to this pass.
 */
function BadgeMark() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      aria-hidden="true"
      className="vs-badge-icon"
    >
      <rect x={3} y={3} width={18} height={18} />
      <rect x={7} y={7} width={10} height={10} />
      <line x1={12} y1={3} x2={12} y2={21} />
      <line x1={3} y1={12} x2={21} y2={12} />
    </svg>
  )
}

export function BadgeUnlockToast({
  badgeName,
  coreValueName,
  recognitionCount,
  previousBadgeName,
  onClose,
}: BadgeUnlockToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, 6000)
    return () => clearTimeout(timer)
  }, [onClose])

  return (
    <div
      className="vs-card relative animate-slide-in-right"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 50,
        width: 320,
        maxWidth: 'calc(100vw - 32px)',
        background: 'var(--color-bg)',
        boxShadow: 'var(--elev-raised)',
        padding: 16,
        overflow: 'visible',
      }}
      role="status"
      aria-live="polite"
    >
      <i className="corner tl" /><i className="corner tr" />
      <i className="corner bl" /><i className="corner br" />

      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          background: 'transparent',
          border: 'none',
          color: 'var(--color-neutral-700)',
          display: 'flex',
        }}
      >
        <X size={14} aria-hidden="true" />
      </button>

      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          style={{
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid var(--color-accent-400)',
            background: 'var(--accent-emphasis)',
            color: 'var(--color-accent-800)',
            flexShrink: 0,
          }}
        >
          <BadgeMark />
        </div>

        <div className="flex-1 min-w-0" style={{ paddingRight: 14 }}>
          <p className="vs-kicker" style={{ marginBottom: 3 }}>Badge unlocked</p>
          <p
            className="font-condensed"
            style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.2 }}
          >
            {badgeName}
          </p>
          <p
            style={{
              fontSize: 12,
              color: 'var(--color-neutral-700)',
              lineHeight: 1.5,
              marginTop: 4,
            }}
          >
            {previousBadgeName
              ? `Progressed from ${previousBadgeName} to ${badgeName} for ${coreValueName}.`
              : `${coreValueName} — recognized ${recognitionCount} time${recognitionCount !== 1 ? 's' : ''} this year.`
            }
          </p>
        </div>
      </div>

      {/* Time remaining */}
      <div
        className="vs-progress-track"
        style={{ height: 2, marginTop: 12 }}
        aria-hidden="true"
      >
        <div
          style={{
            height: '100%',
            background: 'var(--color-accent)',
            animation: 'vs-toast-countdown 6s linear forwards',
          }}
        />
      </div>

      <style>{`
        @keyframes vs-toast-countdown {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>
    </div>
  )
}
