import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { RecognitionFeedItem } from '@/types'
import { ApiError } from '@/lib/api'
import { useWalletBalance, useSendValueCoins } from '@/hooks/queries'
import { useAuth } from '@/context/AuthContext'
import { useValueCoins } from '@/context/ValueCoinContext'
import { ValueCoin, ValueCoinAmount } from './ValueCoin'

/** Offered as one press, so the common case needs no typing. */
const QUICK_AMOUNTS = [10, 25, 50, 100]

interface SendCoinsButtonProps {
  item: RecognitionFeedItem
}

/**
 * Send Value Coins to the person a recognition is about.
 *
 * WHO RECEIVES
 * ------------
 * The NOMINEE — the colleague who was recognised — never the person who
 * wrote the recognition. That is the rule the database enforces too: pass any
 * other recipient and send_value_coins() refuses it rather than recording a
 * transfer with a recognition's name attached to it.
 *
 * The button is absent on your own recognitions, because you cannot pay
 * yourself, and absent when you have no coins, because offering a control
 * that can only fail is worse than not offering it.
 *
 * WHAT THE POPOVER IS FOR
 * -----------------------
 * Four amounts as one press each, an exact amount for anything else, and an
 * optional line to say what it is for. Sending coins is a small decision that
 * should stay a small decision; a full dialog for it would make every send
 * feel like a transaction in the banking sense, which these are not.
 *
 * WHAT IT SPENDS
 * --------------
 * The recognition BUDGET, not coins the sender has earned. Those are separate
 * balances by design (050): if sending drew on earned coins, being recognised
 * would fund recognising, and a budget nobody can exhaust is not a budget.
 *
 * The quick amounts and the field are both capped by whichever bites first,
 * the budget or the per-recognition limit. Offering an amount that would be
 * refused is worse than not offering it — but the refusal still lives in
 * send_value_coins(), which re-checks the ceiling, the daily limit and the
 * budget. Nothing here is a control; it is only an accurate offer.
 *
 * The budget shown is the query's, which is what the database last reported.
 * It is not adjusted hopefully: the number moves when the send has actually
 * happened, because somebody believing they spent coins they still have is a
 * worse failure than a number that is a second behind.
 *
 * WHAT GIVING LOOKS LIKE
 * ----------------------
 * Quiet, and deliberately quieter than receiving. The button answers with
 * "Sent 25" and the giving balance in the bar counts down with a small −25
 * beside it. There is no toast, which is why the hint is marked `inline`:
 * congratulating somebody for spending is the wrong note, and the
 * recognition — not the receipt for it — is meant to be the thing that
 * stays in mind.
 */
export function SendCoinsButton({ item }: SendCoinsButtonProps) {
  const { employee } = useAuth()
  const wallet = useWalletBalance(employee?.id)
  const send = useSendValueCoins()
  const { attribute } = useValueCoins()

  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState<number | ''>(25)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<number | null>(null)

  const wrap = useRef<HTMLDivElement>(null)
  const amountBox = useRef<HTMLInputElement>(null)

  const budget = wallet.data?.budget ?? 0
  /* 0 means no limit, the same everywhere. Resolving it to the budget here
     keeps every comparison below a plain `<=` with no special case in it. */
  const perSendCap = wallet.data?.maxPerRecognition
  const ceiling = perSendCap && perSendCap > 0 ? Math.min(perSendCap, budget) : budget

  const isNominee = employee?.id === item.nominee_id

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (open) amountBox.current?.focus()
    else { setError(null); setNote('') }
  }, [open])

  /*
    The confirmation clears itself.

    A send is small and frequent, and a receipt that stays until dismissed
    turns a one-press action into a two-press one. Four seconds is long
    enough to read "Sent 25" and short enough that the button is ready again
    before anybody reaches for it.
  */
  useEffect(() => {
    if (sent === null) return
    const t = setTimeout(() => setSent(null), 4000)
    return () => clearTimeout(t)
  }, [sent])

  // Nothing to offer: your own recognition, or an empty wallet.
  if (!employee || isNominee) return null

  const value = amount === '' ? 0 : amount
  const canSend = value > 0 && value <= ceiling && !send.isPending

  const submit = async () => {
    if (!canSend) return
    setError(null)
    try {
      const result = await send.mutateAsync({
        recipientId: item.nominee_id,
        amount: value,
        nominationId: item.id,
        note: note.trim() || null,
      })
      /*
        Says what the movement WAS, never how much it was. The figure comes
        from the balance the database reports on the next read — so a send
        that the server ends up refusing cannot leave a number on screen.
      */
      attribute({
        account: 'budget',
        flow: 'out',
        title: 'Value Coins given',
        detail: `to ${item.nominee_name}`,
        inline: true,
      })

      setSent(result.amount)
      setOpen(false)
      setNote('')
    } catch (err) {
      /* The database writes these messages — "You have 40 Value Coins, which
         is not enough to send 100" — so an overdraft explains itself instead
         of failing generically. */
      setError(err instanceof ApiError ? err.message : 'We could not send those Value Coins.')
    }
  }

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        className="vsx-btn vsx-btn-sm"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={budget === 0 && !open}
        title={
          budget === 0
            ? 'Your recognition budget is spent for this period'
            : `Send Value Coins to ${item.nominee_name}`
        }
      >
        <ValueCoin size={15} />
        {/* The post's running total used to sit here too. It is on the post
            itself now, where the nominee can also see it. */}
        {sent !== null ? `Sent ${sent}` : 'Send coins'}
      </button>

      {open && (
        <div className="vsx-coin-pop" role="dialog" aria-label={`Send Value Coins to ${item.nominee_name}`}>
          <div className="vsx-coin-pop-head">
            <div style={{ minWidth: 0 }}>
              <p className="vsx-heading" style={{ fontSize: 12 }}>Send Value Coins</p>
              <p className="vsx-meta" style={{ fontSize: 12.5, marginTop: 3 }}>
                to {item.nominee_name}
              </p>
            </div>
            <button
              type="button"
              className="vsx-comment-menu-btn"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>

          {perSendCap !== undefined && perSendCap > 0 && (
            <p className="vsx-meta" style={{ fontSize: 12 }}>
              Up to {perSendCap} on one recognition
            </p>
          )}

          <div className="vsx-coin-quick">
            {QUICK_AMOUNTS.map(q => (
              <button
                key={q}
                type="button"
                className={amount === q ? 'vsx-coin-chip is-on' : 'vsx-coin-chip'}
                onClick={() => setAmount(q)}
                /* An amount you cannot afford is shown but not offered, so
                   the row does not silently reshape as coins are spent. */
                disabled={q > ceiling}
                aria-pressed={amount === q}
              >
                {q}
              </button>
            ))}
          </div>

          <label className="vsx-coin-field">
            <span className="sr-only">Amount to send</span>
            <ValueCoin size={16} />
            <input
              ref={amountBox}
              type="number"
              inputMode="numeric"
              min={1}
              max={ceiling}
              value={amount}
              onChange={e => {
                const next = e.target.value
                setAmount(next === '' ? '' : Math.max(0, Math.floor(Number(next))))
              }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }}
              aria-label="Amount to send"
            />
          </label>

          <input
            type="text"
            className="vsx-coin-note"
            value={note}
            maxLength={200}
            placeholder="Say what it's for (optional)"
            aria-label="Note, optional"
            onChange={e => setNote(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }}
          />

          {error && <p className="vsx-comment-note is-error" role="alert">{error}</p>}

          <div className="vsx-coin-pop-foot">
            <span className="vsx-meta" style={{ fontSize: 12 }}>
              Budget <ValueCoinAmount amount={budget} size={13} fontSize={13} />
            </span>

            <button
              type="button"
              className="vsx-comment-post"
              onClick={() => void submit()}
              disabled={!canSend}
            >
              {send.isPending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
