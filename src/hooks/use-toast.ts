/**
 * Singleton toast store — all callers share the same queue.
 * Pattern: event emitter → subscribers update React state.
 */

type ToastVariant = 'default' | 'success' | 'destructive'

export interface ToastData {
  id: string
  title: string
  description?: string
  variant?: ToastVariant
  open: boolean
}

type Listener = (toasts: ToastData[]) => void

let toasts: ToastData[] = []
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach(l => l([...toasts]))
}

export function toast(options: Omit<ToastData, 'id' | 'open'>) {
  const id = crypto.randomUUID()
  const newToast: ToastData = { ...options, id, open: true }
  toasts = [...toasts, newToast]
  emit()

  // Auto-dismiss after 4s
  setTimeout(() => {
    toasts = toasts.map(t => t.id === id ? { ...t, open: false } : t)
    emit()
    setTimeout(() => {
      toasts = toasts.filter(t => t.id !== id)
      emit()
    }, 300)
  }, 4000)
}

export function dismiss(id: string) {
  toasts = toasts.map(t => t.id === id ? { ...t, open: false } : t)
  emit()
  setTimeout(() => {
    toasts = toasts.filter(t => t.id !== id)
    emit()
  }, 300)
}

// React hook — subscribes to the singleton store
import { useState, useEffect } from 'react'

export function useToast() {
  const [state, setState] = useState<ToastData[]>(toasts)

  useEffect(() => {
    listeners.add(setState)
    return () => { listeners.delete(setState) }
  }, [])

  return {
    toasts: state,
    toast,
    dismiss,
  }
}
