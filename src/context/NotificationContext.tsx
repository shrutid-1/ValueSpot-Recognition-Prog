import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Notification } from '@/types'
import { useAuth } from './AuthContext'

interface NotificationContextValue {
  notifications: Notification[]
  unreadCount: number
  loading: boolean
  /** True once the first fetch for the signed-in employee has returned. */
  loaded: boolean
  markAsRead: (id: string) => Promise<void>
  markAllAsRead: () => Promise<void>
  /** Deletes every notification the employee has. Throws if the database refuses. */
  clearAll: () => Promise<void>
  refetch: () => Promise<void>
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

const LIMIT = 50

/**
 * Newest first, one row per id, capped — the only shape the list is ever in.
 *
 * Every write goes through this. A realtime INSERT that lands while a fetch is
 * in flight is in BOTH the fetch result and the live list; appending it blindly
 * showed the row twice and counted it twice in the unread badge.
 */
function normalise(rows: Notification[]): Notification[] {
  const byId = new Map<string, Notification>()
  for (const n of rows) if (!byId.has(n.id)) byId.set(n.id, n)
  return [...byId.values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, LIMIT)
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { employee } = useAuth()
  /*
    The id, not the object. AuthContext hands out a new employee object on
    every SIGNED_IN event — including the ones the auth client emits when a tab
    regains focus — and keying on the object refetched the list and tore down
    the realtime channel each time, which is when rows flickered or vanished.
  */
  const employeeId = employee?.id ?? null

  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Only the newest request may write. An older one finishing late — a slow
  // network, or a previous employee's fetch after a sign-out — is dropped.
  const requestSeq = useRef(0)
  // Rows pushed live while a fetch is in flight: newer than its answer, so
  // they are kept when the answer replaces the list.
  const arrivedDuringFetch = useRef<Notification[]>([])
  // The list as last rendered, for undoing an optimistic clear.
  const listRef = useRef<Notification[]>([])
  listRef.current = notifications

  const fetchNotifications = useCallback(async () => {
    if (!employeeId) return
    const seq = ++requestSeq.current
    arrivedDuringFetch.current = []
    setLoading(true)

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', employeeId)
      .order('created_at', { ascending: false })
      .limit(LIMIT)

    if (seq !== requestSeq.current) return
    setLoading(false)

    // A failed read keeps what is on screen. It used to replace it with an
    // empty list, so one dropped request emptied the panel and the badge.
    if (error) return

    // The server's answer replaces the list — so a row read or cleared in
    // another tab is corrected here — plus anything that arrived live while
    // the question was out.
    setNotifications(normalise([...arrivedDuringFetch.current, ...(data ?? [])]))
    arrivedDuringFetch.current = []
    setLoaded(true)
  }, [employeeId])

  // A different person (or nobody) — nothing of the last one's may show.
  useEffect(() => {
    requestSeq.current++
    setNotifications([])
    setLoaded(false)
    setLoading(false)
    void fetchNotifications()
  }, [fetchNotifications])

  // Realtime, plus a resync whenever the connection or the tab comes back.
  useEffect(() => {
    if (!employeeId) return

    /*
      A unique topic per subscription. The client hands back an existing
      channel for a topic it still holds, and removeChannel() is async — so a
      quick unmount/remount (StrictMode, or the employee id settling) got the
      old, already-subscribed channel and threw on the `.on()` calls, leaving
      the list with no live updates until a full reload.
    */
    const topic = `notifications:${employeeId}:${Math.random().toString(36).slice(2)}`
    let everSubscribed = false

    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${employeeId}` },
        payload => {
          const row = payload.new as Notification
          arrivedDuringFetch.current.push(row)
          setNotifications(prev => normalise([row, ...prev]))
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${employeeId}` },
        payload => setNotifications(prev =>
          prev.map(n => (n.id === payload.new.id ? { ...n, ...(payload.new as Notification) } : n)),
        ),
      )
      .subscribe(status => {
        if (status !== 'SUBSCRIBED') return
        // Anything sent while the socket was down (a sleeping laptop, a
        // dropped connection) was never delivered — read it back.
        if (everSubscribed) void fetchNotifications()
        everSubscribed = true
      })

    // Returning to the tab also picks up rows changed elsewhere — read or
    // cleared in another tab — which realtime does not tell us about.
    const onVisible = () => { if (document.visibilityState === 'visible') void fetchNotifications() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void supabase.removeChannel(channel)
    }
  }, [employeeId, fetchNotifications])

  /*
    The writes are optimistic: the screen changes on the click, not a round
    trip later, and a refusal puts the truth back by reading it again. The row
    used to change only after the request returned, so a click felt ignored.
  */
  const markAsRead = useCallback(async (id: string) => {
    const readAt = new Date().toISOString()
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, is_read: true, read_at: readAt } : n)))
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: readAt })
      .eq('id', id)
    if (error) void fetchNotifications()
  }, [fetchNotifications])

  const markAllAsRead = useCallback(async () => {
    if (!employeeId) return
    const readAt = new Date().toISOString()
    setNotifications(prev => prev.map(n => (n.is_read ? n : { ...n, is_read: true, read_at: readAt })))
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: readAt })
      .eq('recipient_id', employeeId)
      .eq('is_read', false)
    if (error) void fetchNotifications()
  }, [employeeId, fetchNotifications])

  const clearAll = useCallback(async () => {
    if (!employeeId) return
    const before = listRef.current
    // A fetch already in flight would answer with the rows being deleted and
    // put them straight back.
    requestSeq.current++
    setLoading(false)
    setNotifications([])

    // Every row, not only the fifty on screen: "clear" that left older ones
    // to scroll back into view would not be clear.
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('recipient_id', employeeId)

    if (error) {
      setNotifications(prev => normalise([...prev, ...before]))
      throw error
    }
  }, [employeeId])

  const unreadCount = notifications.filter(n => !n.is_read).length

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      loading,
      loaded,
      markAsRead,
      markAllAsRead,
      clearAll,
      refetch: fetchNotifications,
    }}>
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider')
  return ctx
}
