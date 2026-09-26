import { useEffect, useState } from 'react'
import { Check, Heart } from 'lucide-react'
import type { RecognitionFeedItem } from '@/types'
import { recognitionsApi } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'

interface AppreciateButtonProps {
  item: RecognitionFeedItem
  alreadyAppreciated?: boolean
}

/**
 * Appreciate a recognition, or take it back.
 *
 * A toggle, the way every one-tap reaction people already use is a toggle:
 * pressing it a second time removes the appreciation rather than doing
 * nothing. Previously the button disabled itself on the first press, so a
 * misclick was permanent — the database agreed, because nomination_appreciations
 * had no delete policy at all. Migration 045 added one, scoped to your own
 * row, and this is the control that uses it.
 *
 * Both directions are optimistic and both roll back the same way. The write
 * reports whether IT was the call that changed anything; when it was not —
 * the appreciation was already recorded, or already gone, from another tab or
 * device — the end state is still the one that was wanted, so only the count
 * guess is corrected, never the pressed state.
 *
 * One write at a time. A press while a write is in flight is ignored rather
 * than queued, so a rapid double-tap cannot land an insert and a delete out of
 * order and leave the row disagreeing with the button.
 *
 * The writes are `recognitionsApi.appreciate` and `.unappreciate` — the same
 * API module as before. Nothing here talks to Supabase directly and nothing
 * here decides whether the write is allowed; the database does.
 */
export function AppreciateButton({ item, alreadyAppreciated = false }: AppreciateButtonProps) {
  const { employee } = useAuth()
  const [appreciated, setAppreciated] = useState(alreadyAppreciated)
  const [count, setCount] = useState(item.appreciation_count)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setAppreciated(alreadyAppreciated)
    setCount(item.appreciation_count)
  }, [item.id, item.appreciation_count, alreadyAppreciated])

  const toggle = async () => {
    if (!employee || busy) return
    setBusy(true)

    if (appreciated) {
      setAppreciated(false)
      setCount(c => Math.max(c - 1, 0))
      try {
        /*
          `removed: false` means the row was already gone — so the count we
          are holding, which no longer counts us, is the right one. Nothing
          to correct, unlike the insert below.
        */
        await recognitionsApi.unappreciate(item.id, employee.id)
      } catch {
        setAppreciated(true)
        setCount(c => c + 1)
      } finally {
        setBusy(false)
      }
      return
    }

    setAppreciated(true)
    setCount(c => c + 1)
    try {
      const { recorded } = await recognitionsApi.appreciate(item.id, employee.id)
      if (!recorded) setCount(c => Math.max(c - 1, item.appreciation_count))
    } catch {
      setAppreciated(false)
      setCount(c => Math.max(c - 1, 0))
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!employee || busy}
      className="vsx-btn vsx-btn-sm"
      title={appreciated ? 'Appreciated — select again to undo' : undefined}
      style={{
        background: appreciated ? 'var(--vsx-red)' : 'var(--vsx-ink-3)',
        /*
          What sits on the primary fill. Lime takes near-black; the
          administrative portals fill this button with a deeper red that takes
          white, and they set --vsx-on-red to say so. The fallback is the
          Employee portal's own value, so nothing changes there.
        */
        color: appreciated ? 'var(--vsx-on-red, #0B0B0B)' : 'var(--vsx-text-2)',
        opacity: busy ? 0.7 : undefined,
      }}
      aria-pressed={appreciated}
      aria-label={
        appreciated
          ? `Appreciated. ${count} ${count === 1 ? 'person has' : 'people have'} appreciated this. Select again to undo`
          : `Appreciate this recognition. ${count} so far`
      }
    >
      {appreciated
        ? <Check size={14} aria-hidden="true" strokeWidth={2.2} />
        : <Heart size={14} aria-hidden="true" strokeWidth={1.8} />}
      {appreciated ? 'Appreciated' : 'Appreciate'}
      {count > 0 && (
        <span className="vsx-fig" style={{ fontSize: 14, color: 'inherit' }}>{count}</span>
      )}
    </button>
  )
}

