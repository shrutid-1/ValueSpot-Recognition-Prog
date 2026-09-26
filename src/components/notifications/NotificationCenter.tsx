import { useState } from 'react'
import { Bell, CheckCheck, Trash2 } from 'lucide-react'
import { useNotifications } from '@/context/NotificationContext'
import { NotificationItem } from './NotificationItem'

interface NotificationCenterProps {
  onClose: () => void
}

const HEADER_BTN = { padding: '3px 6px', fontSize: 12 } as const

export function NotificationCenter({ onClose }: NotificationCenterProps) {
  const { notifications, unreadCount, markAllAsRead, clearAll } = useNotifications()

  /*
    Clearing deletes the rows for good, so it asks once — inline, in the
    header where the button was, rather than a modal over a popover.
  */
  const [confirming, setConfirming] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)

  const handleClear = async () => {
    setClearing(true)
    setClearError(null)
    try {
      await clearAll()
      setConfirming(false)
    } catch {
      setClearError('Could not clear your notifications. Please try again.')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div
      className="vs-popover absolute right-0 top-full z-50 flex flex-col"
      style={{
        marginTop: 6,
        width: 'min(380px, calc(100vw - 32px))',
        maxHeight: 480,
        background: 'var(--color-bg)',
        border: '1px solid var(--color-divider)',
        boxShadow: 'var(--shadow-lg)',
      }}
      role="region"
      aria-label="Notifications"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between flex-wrap gap-x-2 gap-y-1 shrink-0"
        style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-divider)' }}
      >
        <div className="flex items-center gap-2">
          <h2
            className="font-condensed"
            style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)', letterSpacing: '-0.01em' }}
          >
            Notifications
          </h2>
          {unreadCount > 0 && (
            <span
              className="vs-tag vs-tag-accent"
              style={{ fontSize: 10, padding: '1px 6px' }}
              aria-label={`${unreadCount} unread`}
            >
              {unreadCount}
            </span>
          )}
        </div>
        {confirming ? (
          <div className="flex items-center gap-1" role="group" aria-label="Confirm clearing notifications">
            <span style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginRight: 2 }}>
              Clear all?
            </span>
            <button
              type="button"
              className="flex items-center gap-1 vs-btn-ghost"
              style={{ ...HEADER_BTN, fontWeight: 600 }}
              onClick={() => void handleClear()}
              disabled={clearing}
              autoFocus
            >
              {clearing ? 'Clearing…' : 'Clear'}
            </button>
            <button
              type="button"
              className="vs-btn-ghost"
              style={{ ...HEADER_BTN, color: 'var(--color-neutral-600)' }}
              onClick={() => { setConfirming(false); setClearError(null) }}
              disabled={clearing}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button
                type="button"
                className="flex items-center gap-1 vs-btn-ghost"
                style={HEADER_BTN}
                onClick={() => void markAllAsRead()}
                aria-label="Mark all notifications as read"
              >
                <CheckCheck size={12} />
                Mark all read
              </button>
            )}
            {notifications.length > 0 && (
              <button
                type="button"
                className="flex items-center gap-1 vs-btn-ghost"
                style={HEADER_BTN}
                onClick={() => setConfirming(true)}
                aria-label="Clear all notifications"
              >
                <Trash2 size={12} />
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {clearError && (
        <p
          role="alert"
          style={{
            padding: '8px 14px', fontSize: 12,
            color: 'var(--color-accent-800)',
            borderBottom: '1px solid var(--color-divider)',
          }}
        >
          {clearError}
        </p>
      )}

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto" style={{ overflowX: 'hidden' }}>
        {notifications.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center text-center"
            style={{ padding: '40px 24px' }}
          >
            <Bell size={32} style={{ color: 'var(--color-neutral-400)', marginBottom: 12 }} aria-hidden="true" />
            <p
              className="font-condensed"
              style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}
            >
              All caught up
            </p>
            <p style={{ fontSize: 13, color: 'var(--color-neutral-600)', marginTop: 4 }}>
              No new notifications right now.
            </p>
          </div>
        ) : (
          notifications.map(n => (
            <NotificationItem key={n.id} notification={n} onClose={onClose} />
          ))
        )}
      </div>
    </div>
  )
}
