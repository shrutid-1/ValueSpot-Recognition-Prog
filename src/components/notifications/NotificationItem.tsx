import React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckSquare, Award, Bell, FileText, AlertCircle, MessageSquare, Zap, LifeBuoy,
  MessageCircle, Coins, ShoppingBag,
} from 'lucide-react'
import type { Notification, NotificationType } from '@/types'
import { timeAgo } from '@/lib/date-utils'
import { useNotifications } from '@/context/NotificationContext'
import { ROUTES } from '@/lib/constants'
import { cn } from '@/lib/utils'

interface NotificationItemProps {
  notification: Notification
  onClose: () => void
}

const NOTIFICATION_ICONS: Record<NotificationType, React.ReactNode> = {
  nomination_submitted:       <CheckSquare size={13} />,
  approval_required:          <AlertCircle size={13} />,
  clarification_requested:    <MessageSquare size={13} />,
  nomination_approved:        <CheckSquare size={13} />,
  nomination_rejected:        <AlertCircle size={13} />,
  recognition_received:       <Award size={13} />,
  team_recognition_published: <Bell size={13} />,
  badge_unlocked:             <Zap size={13} />,
  monthly_report_ready:       <FileText size={13} />,
  // Migration 034 — recognition correction requests.
  support_request_created:    <LifeBuoy size={13} />,
  support_request_resolved:   <LifeBuoy size={13} />,
  support_request_rejected:   <LifeBuoy size={13} />,
  /*
    Migration 046 — somebody commented on a recognition.

    A distinct glyph from clarification_requested's MessageSquare, which is an
    approver asking the author a question and needs an answer. This one is a
    colleague remarking in public and needs nothing.
  */
  recognition_commented:      <MessageCircle size={13} />,
  // Migration 047 — somebody answered your comment.
  comment_replied:            <MessageCircle size={13} />,
  // Migration 048 — a colleague sent Value Coins on a recognition.
  value_coins_received:       <Coins size={13} />,
  /* Migration 051 — the Value Store. One glyph for all three, because they
     are one thread: a request, and what happened to it. */
  reward_requested:           <ShoppingBag size={13} />,
  reward_approved:            <ShoppingBag size={13} />,
  reward_rejected:            <ShoppingBag size={13} />,
}

function getNotificationHref(type: NotificationType): string {
  if (type === 'approval_required')                 return ROUTES.PENDING_APPROVALS
  if (type === 'badge_unlocked')                    return ROUTES.CORE_VALUE_JOURNEY
  if (type === 'recognition_received')              return ROUTES.MY_RECOGNITIONS
  if (type === 'nomination_approved')               return ROUTES.MY_RECOGNITIONS
  if (type === 'clarification_requested')           return ROUTES.MY_RECOGNITIONS
  if (type === 'monthly_report_ready')              return ROUTES.REPORTS
  /*
    The two audiences of a correction request land in different places, which
    is the whole reason this is a switch rather than one route: an
    administrator is being asked to act, so they go to the queue; the requester
    is being told an outcome, so they go to their own list.
  */
  if (type === 'support_request_created')           return ROUTES.SUPPORT_REQUESTS
  if (type === 'support_request_resolved')          return ROUTES.SUPPORT
  if (type === 'support_request_rejected')          return ROUTES.SUPPORT
  /*
    A comment is read where it was written, under the post, so the feed is
    the right destination rather than the fallback — and the fallback below
    happens to be the same route, which is why this line is here to say so.
  */
  if (type === 'recognition_commented')             return ROUTES.RECOGNITION_FEED
  if (type === 'comment_replied')                   return ROUTES.RECOGNITION_FEED
  /* Coins land in a wallet, and the wallet with its ledger is on the profile
     — which is where somebody told "Arjun sent you 50" wants to go. */
  if (type === 'value_coins_received')              return ROUTES.WALLET
  /* An employee told about their own request goes to the wallet, where the
     Rewards tab shows where it got to. HR goes to the queue they have to
     act on. */
  if (type === 'reward_approved')                   return ROUTES.WALLET
  if (type === 'reward_rejected')                   return ROUTES.WALLET
  if (type === 'reward_requested')                  return ROUTES.REWARDS
  return ROUTES.RECOGNITION_FEED
}

export function NotificationItem({ notification, onClose }: NotificationItemProps) {
  const { markAsRead } = useNotifications()
  const navigate = useNavigate()

  /*
    Go first, mark in the background. Awaiting the write before navigating
    made every click sit still for a round trip — long enough to click again.
    markAsRead updates the list at once and corrects itself if refused.
  */
  const handleClick = () => {
    if (!notification.is_read) void markAsRead(notification.id)
    navigate(getNotificationHref(notification.type))
    onClose()
  }

  return (
    <button
      type="button"
      className={cn('vs-notif-item w-full text-left flex items-start gap-3', !notification.is_read && 'is-unread')}
      style={{
        padding: '10px 14px',
        cursor: 'pointer',
        border: 'none',
        borderBottom: '1px solid var(--color-divider)',
        fontFamily: 'Barlow, sans-serif',
      }}
      onClick={handleClick}
    >
      {/* Icon tile */}
      <div
        style={{
          width: 28,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
          color: 'var(--color-accent-700)',
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        {NOTIFICATION_ICONS[notification.type]}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p
          style={{
            fontSize: 13,
            lineHeight: 1.4,
            color: notification.is_read ? 'var(--color-neutral-700)' : 'var(--color-text)',
            fontWeight: notification.is_read ? 400 : 500,
          }}
        >
          {notification.title}
        </p>
        <p
          className="line-clamp-2"
          style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 2 }}
        >
          {notification.body}
        </p>
        <p
          style={{
            fontSize: 10,
            color: 'var(--color-neutral-500)',
            marginTop: 4,
            letterSpacing: '0.03em',
          }}
        >
          {timeAgo(notification.created_at)}
        </p>
      </div>

      {/* Unread indicator */}
      {!notification.is_read && (
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--color-accent)',
            flexShrink: 0,
            marginTop: 6,
          }}
          aria-label="Unread"
        />
      )}
    </button>
  )
}
