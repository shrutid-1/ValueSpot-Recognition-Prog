import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import { useWalletSummary } from '@/hooks/queries'
import { useInvalidate } from '@/lib/query'
import { milestoneCrossed, readMoments, seedMoments, writeMoments } from '@/lib/value-coins'
import { useAuth } from './AuthContext'
import { useNotifications } from './NotificationContext'

/**
 * Value Coin events — one source of truth for every coin animation.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * ------------------------------------
 * An amount is never predicted, parsed or assumed. Every figure this context
 * emits is the DIFFERENCE BETWEEN TWO BALANCES THE DATABASE REPORTED — the
 * one it last told us, and the one it is telling us now. A send that fails
 * does not move a balance, so it cannot produce an event. A redemption that
 * is refused does not move a balance, so it cannot produce an event. There is
 * no code path from "a button was pressed" to "+100 appeared on screen"; the
 * only path runs through a number the backend chose.
 *
 * WHY A REFRESH DOES NOT REPLAY YESTERDAY
 * ---------------------------------------
 * The first balance of a session is a BASELINE, recorded silently. Events are
 * differences from it, so reloading the page establishes a new baseline and
 * announces nothing. The alternative — replaying recent ledger rows — would
 * congratulate somebody on the same 100 coins every morning.
 *
 * WHERE THE WORDS COME FROM
 * -------------------------
 * The amount is ours; the sentence is not. A movement is labelled by whoever
 * knows why it happened: the component that ran the mutation leaves a hint
 * (`attribute`), or the database's own notification text is used verbatim.
 * When neither exists the label names only the balance that moved, rather
 * than guessing at a cause it does not know — see `plainTitle`.
 *
 *      mutation / notification ──► hint ─┐
 *                                        ├─► event ──► toast, pulse, figure
 *      wallet summary refetch ──► delta ─┘
 */

export type CoinAccount = 'earned' | 'budget'
export type CoinFlow = 'in' | 'out'

/** A once-only thing riding along with a movement, never on its own toast. */
export interface ValueCoinMoment {
  kind: 'first-coins' | 'milestone'
  /** The lifetime total reached. Only on a milestone. */
  threshold?: number
}

export interface ValueCoinEvent {
  id: string
  account: CoinAccount
  flow: CoinFlow
  /** Confirmed by the backend. Zero means "a status, with no figure". */
  amount: number
  /** The balance after the movement, as the backend reported it. */
  balance: number
  title: string
  detail?: string
  moment?: ValueCoinMoment
}

/**
 * What a component knows about a movement it just caused.
 *
 * Left BEFORE the balance arrives, because the mutation resolves first and
 * the refetch follows. Unclaimed hints expire rather than attaching
 * themselves to an unrelated movement later in the session.
 */
export interface ValueCoinHint {
  account: CoinAccount
  flow: CoinFlow
  title: string
  detail?: string
  /**
   * The component is showing this movement itself — a dialog, say. The event
   * still fires, so balances still settle and panels still light up; it just
   * does not also raise a toast behind the thing already explaining it.
   */
  inline?: boolean
}

/** The most recent confirmed movement on one balance, for highlighting. */
export interface ValueCoinMovement {
  id: string
  flow: CoinFlow
  amount: number
}

interface ValueCoinContextValue {
  /** Events awaiting a toast, oldest first. */
  events: ValueCoinEvent[]
  dismiss: (id: string) => void
  attribute: (hint: ValueCoinHint) => void
  /** The last movement on each balance, whether or not it raised a toast. */
  movement: Record<CoinAccount, ValueCoinMovement | null>
}

/*
  A null object rather than a thrown error.

  This is a presentational layer. A figure rendered on an HR screen, outside
  the employee shell, should show its number and skip the animation — not
  take the page down. NotificationContext throws because a component asking
  for notifications it cannot have is a wiring mistake; a component asking
  whether a balance recently moved is asking something with a sane answer.
*/
const QUIET: ValueCoinContextValue = {
  events: [],
  dismiss: () => {},
  attribute: () => {},
  movement: { earned: null, budget: null },
}

const ValueCoinContext = createContext<ValueCoinContextValue>(QUIET)

/** A hint expires if no movement claims it. Generous: a refetch can be slow. */
const HINT_TTL = 15_000

/** How recently a recognition must have landed to be named on a coin event. */
const RECOGNITION_WINDOW = 25_000

let sequence = 0
const nextId = () => `vc-${++sequence}`

/**
 * Direction, stated plainly, when nothing knows why the coins moved.
 *
 * DELIBERATELY VAGUER THAN IT COULD BE.
 *
 * Every movement with a known cause arrives with a hint carrying the real
 * sentence, so these labels only ever cover the cases nothing claimed — and
 * those are precisely the cases where a confident label would be a guess.
 * A budget debit, for instance, is usually a send; but `allowance_expired`
 * (050) also debits the budget, silently, when an unused allowance is
 * forfeited at a period reset. "Value Coins given" would then be telling
 * somebody they gave away coins that simply lapsed.
 *
 * So an unattributed movement says only what is certainly true: which
 * balance moved. The figure and the direction chip carry the rest, and the
 * wallet's transaction history names the kind exactly.
 */
function plainTitle(account: CoinAccount, flow: CoinFlow): string {
  if (account === 'earned') {
    return flow === 'in' ? 'Value Coins added to your wallet' : 'Earned balance updated'
  }
  return flow === 'in' ? 'Giving balance topped up' : 'Giving balance updated'
}

type StampedHint = ValueCoinHint & { at: number }

interface Baseline {
  employeeId: string
  budget: number
  earned: number
  receivedTotal: number
}

export function ValueCoinProvider({ children }: { children: React.ReactNode }) {
  const { employee } = useAuth()
  const { notifications, loaded: notificationsLoaded } = useNotifications()
  const invalidate = useInvalidate()

  /*
    The wallet, mounted once for the whole portal.

    Not an extra request: the Wallet and Value Store screens already ask for
    this exact query, so React Query serves all three from one cache entry.
    Mounting it here is what lets coins that arrive while somebody is reading
    the feed be noticed at all.
  */
  const summary = useWalletSummary(employee?.id)
  const data = summary.data

  const [events, setEvents] = useState<ValueCoinEvent[]>([])
  const [movement, setMovement] = useState<Record<CoinAccount, ValueCoinMovement | null>>({
    earned: null, budget: null,
  })

  const baseline = useRef<Baseline | null>(null)
  const hints = useRef<StampedHint[]>([])
  const recognitionAt = useRef<number>(0)
  /** The newest notification already accounted for. Null until first read. */
  const seenNotification = useRef<string | null>(null)

  const attribute = useCallback((hint: ValueCoinHint) => {
    const now = Date.now()
    hints.current = [...hints.current.filter(h => now - h.at < HINT_TTL), { ...hint, at: now }]
  }, [])

  const dismiss = useCallback((id: string) => {
    setEvents(current => current.filter(e => e.id !== id))
  }, [])

  /** Claims the hint left for this movement, if one is still waiting. */
  const takeHint = useCallback((account: CoinAccount, flow: CoinFlow) => {
    const now = Date.now()
    const live = hints.current.filter(h => now - h.at < HINT_TTL)
    const index = live.findIndex(h => h.account === account && h.flow === flow)

    if (index === -1) {
      hints.current = live
      return undefined
    }

    hints.current = live.filter((_, i) => i !== index)
    return live[index]
  }, [])

  /* ── Notifications: the sentence, and the nudge to refetch ──────────────
     A notification row is the database saying something happened. It does
     not carry an amount as a number, so it is never the source of one; it
     leaves the WORDS and asks the wallet to refetch, and the balance that
     comes back is what produces the figure. */
  useEffect(() => {
    /*
      Nothing is judged until the first fetch has answered. The empty list
      before it used to be taken as the starting point, so the newest OLD row
      then looked new — and a "reward approved" was announced again on every
      page load. A change of employee resets the mark for the same reason.
    */
    if (!notificationsLoaded) {
      seenNotification.current = null
      return
    }

    const newest = notifications[0]?.id ?? null

    // First read of the session: remember where we are, announce nothing.
    if (seenNotification.current === null) {
      seenNotification.current = newest ?? ''
      return
    }

    if (!newest || newest === seenNotification.current) return

    const edge = notifications.findIndex(n => n.id === seenNotification.current)
    // Not found means the list rolled over entirely; take only the newest
    // rather than treating fifty rows as fifty fresh events.
    const arrived = edge === -1 ? notifications.slice(0, 1) : notifications.slice(0, edge)
    seenNotification.current = newest

    let touchesWallet = false

    for (const n of arrived) {
      if (n.type === 'recognition_received') {
        recognitionAt.current = Date.now()
        continue
      }

      if (n.type === 'value_coins_received') {
        /* The database wrote this sentence — "Vaibhav sent you 100 Value
           Coins" — so it is used verbatim rather than reassembled here. */
        attribute({ account: 'earned', flow: 'in', title: n.title })
        touchesWallet = true
        continue
      }

      if (n.type === 'reward_rejected') {
        attribute({
          account: 'earned', flow: 'in',
          title: n.title,
          detail: 'Refunded in full',
        })
        touchesWallet = true
        continue
      }

      if (n.type === 'reward_approved') {
        /*
          Approval moves no balance — the coins were taken when the request
          was made — so there is no delta for the watcher to find and this is
          announced directly. It carries no figure, which is the honest
          shape: nothing was added or removed just now.
        */
        setEvents(current => [...current, {
          id: nextId(),
          account: 'earned',
          flow: 'in',
          amount: 0,
          balance: 0,
          title: n.title,
          detail: 'Your reward is confirmed',
        }])
      }
    }

    if (touchesWallet) invalidate.wallet()
  }, [notifications, notificationsLoaded, attribute, invalidate])

  /* ── Balances: the figures ──────────────────────────────────────────────
     The only place in the application where a coin amount is produced for
     display. It is a subtraction between two numbers the backend chose. */
  useEffect(() => {
    if (!employee?.id || !data) return

    const previous = baseline.current

    // A new session, a different person, or the first balance we have seen.
    // Recorded silently: a baseline is where measuring starts, not an event.
    if (!previous || previous.employeeId !== employee.id) {
      baseline.current = {
        employeeId: employee.id,
        budget: data.budget,
        earned: data.earned,
        receivedTotal: data.receivedTotal,
      }
      seedMoments(employee.id, data.receivedTotal)
      return
    }

    const earnedDelta = data.earned - previous.earned
    const budgetDelta = data.budget - previous.budget
    const receivedDelta = data.receivedTotal - previous.receivedTotal

    if (earnedDelta === 0 && budgetDelta === 0 && receivedDelta === 0) return

    baseline.current = {
      employeeId: employee.id,
      budget: data.budget,
      earned: data.earned,
      receivedTotal: data.receivedTotal,
    }

    /* ── Which once-only moment, if any, this crossing earned ── */
    const moments = readMoments(employee.id)
    let moment: ValueCoinMoment | undefined

    if (receivedDelta > 0) {
      if (!moments.firstCoins) {
        moment = { kind: 'first-coins' }
      } else {
        const threshold = milestoneCrossed(previous.receivedTotal, data.receivedTotal)
        if (threshold && threshold > moments.milestone) {
          moment = { kind: 'milestone', threshold }
        }
      }

      writeMoments(employee.id, {
        firstCoins: true,
        milestone: moment?.kind === 'milestone'
          ? Math.max(moments.milestone, moment.threshold ?? 0)
          : moments.milestone,
      })
    }

    const named = Date.now() - recognitionAt.current < RECOGNITION_WINDOW

    const built: ValueCoinEvent[] = []
    const raised: Partial<Record<CoinAccount, ValueCoinMovement>> = {}

    /*
      One event per balance, never one per transaction.

      Two colleagues sending coins inside the same refetch window is one
      arrival of 150, not two arrivals a second apart. Rule of the whole
      feature: an employee sees one polished event, not a stack.
    */
    const build = (account: CoinAccount, delta: number, balance: number) => {
      if (delta === 0) return

      const flow: CoinFlow = delta > 0 ? 'in' : 'out'
      const amount = Math.abs(delta)
      const hint = takeHint(account, flow)

      const id = nextId()
      raised[account] = { id, flow, amount }

      if (hint?.inline) return

      built.push({
        id,
        account,
        flow,
        amount,
        balance,
        title: hint?.title ?? plainTitle(account, flow),
        detail: hint?.detail
          ?? (account === 'earned' && flow === 'in' && named
            ? 'On a recognition you just received'
            : undefined),
        // The moment belongs to coins arriving, which is the only thing that
        // can produce one.
        moment: account === 'earned' && flow === 'in' ? moment : undefined,
      })
    }

    build('earned', earnedDelta, data.earned)
    build('budget', budgetDelta, data.budget)

    if (built.length > 0) setEvents(current => [...current, ...built])
    if (Object.keys(raised).length > 0) {
      setMovement(current => ({ ...current, ...raised }))
    }
  }, [data, employee?.id, takeHint])

  const value = useMemo<ValueCoinContextValue>(
    () => ({ events, dismiss, attribute, movement }),
    [events, dismiss, attribute, movement],
  )

  return <ValueCoinContext.Provider value={value}>{children}</ValueCoinContext.Provider>
}

/** The coin event stream. Safe to call outside the employee portal. */
export function useValueCoins(): ValueCoinContextValue {
  return useContext(ValueCoinContext)
}
