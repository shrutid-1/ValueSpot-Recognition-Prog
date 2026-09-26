import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { RewardCategory } from '@/types'
import { REWARD_CATEGORIES } from '@/lib/api'
import { useStoreRewards, useWalletSummary } from '@/hooks/queries'
import { useAuth } from '@/context/AuthContext'
import { useCoinPulse } from '@/hooks/useCoinPulse'
import { errorMessage } from '@/lib/query'
import { ROUTES } from '@/lib/constants'
import { ValueCoin } from '@/components/experience/ValueCoin'
import { ValueCoinFigure } from '@/components/experience/ValueCoinFigure'
import { RewardCard } from '@/components/experience/RewardCard'
import { MyRedemptions } from '@/components/experience/MyRedemptions'

/**
 * The Value Store.
 *
 * WHAT IS SPENT HERE
 * ------------------
 * EARNED coins, and only earned coins. The giving budget is not shown on this
 * screen, is not read by this screen, and cannot reach a reward: redeem_reward()
 * touches `earned_balance` and never names `budget_balance` at all. Two
 * balances that look alike are easy to confuse, so the store simply does not
 * mention the one that is irrelevant here.
 *
 * TWO REQUESTS, WHATEVER THE CATALOGUE'S SIZE
 * -------------------------------------------
 * The rewards and the wallet. Every card renders from the first list and
 * compares against the second number; no card fetches anything of its own, so
 * seven rewards and seventy cost the same.
 *
 * THE HEADLINE IS CAPACITY, NOT A BALANCE
 * ---------------------------------------
 * A number on its own says nothing about whether it is a lot. "2,500 earned"
 * beside "five of seven rewards within reach" says what it can actually do,
 * which is the question somebody arriving at a store is asking.
 *
 * TWO VIEWS, NOT TWO ROUTES
 * -------------------------
 * The shelves and what you have already taken off them are one screen with
 * two views, because "where is the thing I redeemed" is a question people
 * ask AT the store. A second top-level route would answer it somewhere the
 * question does not get asked, and would need its own place in a navigation
 * bar that is already carrying five.
 *
 * The category shelves stay exactly where they were, one level down, inside
 * the Store view they have always belonged to.
 */

/** The two things this screen is. */
type StoreView = 'store' | 'redemptions'

export default function ValueStorePage() {
  const { employee } = useAuth()
  const [view, setView] = useState<StoreView>('store')
  const [shelf, setShelf] = useState<RewardCategory | 'all'>('all')

  const rewardsQuery = useStoreRewards()
  const wallet = useWalletSummary(employee?.id)
  /* Only the earned balance can move on this screen — the giving budget is
     not spendable here and is deliberately not even read. */
  const earnedPulse = useCoinPulse('earned')

  const rewards = useMemo(() => rewardsQuery.data ?? [], [rewardsQuery.data])
  const earned = wallet.data?.earned ?? 0

  const shown = useMemo(
    () => (shelf === 'all' ? rewards : rewards.filter(r => r.category === shelf)),
    [rewards, shelf],
  )

  const withinReach = useMemo(
    () => rewards.filter(r => r.coin_price <= earned).length,
    [rewards, earned],
  )

  const loadError = rewardsQuery.isError
    ? errorMessage(rewardsQuery.error, 'We could not load the Value Store.')
    : null

  return (
    <div data-vs-theme="dark" className="vsx-store-page">
      <header>
        <p className="vsx-heading" style={{ fontSize: 12, color: 'var(--vsx-text-3)' }}>
          Value Store
        </p>
        <h1 className="vsx-title" style={{ fontSize: 'clamp(34px, 5vw, 52px)', marginTop: 8 }}>
          Spend what you&rsquo;ve earned
        </h1>
      </header>

      {/* The balance, said as capacity. */}
      <section
        className="vsx-panel vsx-store-hero vsx-coin-lit"
        data-lit={earnedPulse ? earnedPulse.flow : undefined}
        aria-label="Your earned balance"
      >
        <div className="flex items-center" style={{ gap: 18 }}>
          <ValueCoin size={40} />
          <div style={{ minWidth: 0 }}>
            <ValueCoinFigure
              value={earned}
              account="earned"
              pending={!wallet.data}
              deltaSize="lg"
              style={{ fontSize: 'clamp(34px, 5vw, 46px)', lineHeight: 1 }}
            />
            <p className="vsx-meta" style={{ fontSize: 13.5, marginTop: 7 }}>
              earned from colleagues
            </p>
          </div>
        </div>

        <p className="vsx-store-reach">
          {rewards.length === 0
            ? 'Nothing in the Value Store yet.'
            : withinReach === 0
              ? 'Nothing within reach yet — coins arrive when colleagues recognise you.'
              : `${withinReach} of ${rewards.length} rewards within reach.`}
          {' '}
          <Link to={ROUTES.WALLET} className="vsx-store-link">See your wallet</Link>
        </p>
      </section>

      {/*
        The two views. A segmented control rather than a second row of the
        same pills the shelves use — these are not two categories of reward,
        they are two different screens, and making them look alike would
        flatten that.
      */}
      <div className="vsx-store-views" role="tablist" aria-label="Value Store views">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'store'}
          className={view === 'store' ? 'vsx-store-view is-on' : 'vsx-store-view'}
          onClick={() => setView('store')}
        >
          Store
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'redemptions'}
          className={view === 'redemptions' ? 'vsx-store-view is-on' : 'vsx-store-view'}
          onClick={() => setView('redemptions')}
        >
          My Redemptions
        </button>
      </div>

      {view === 'redemptions' ? (
        <MyRedemptions onBrowseStore={() => setView('store')} />
      ) : (
        <>
        {loadError && (
          <p className="vsx-comment-note is-error" role="alert">{loadError}</p>
        )}

        {/* Shelves. Only offered once there is more than one thing to sort. */}
        {rewards.length > 1 && (
          <div className="vsx-wallet-tabs" role="tablist" aria-label="Reward categories">
            {REWARD_CATEGORIES.filter(
              c => c.value === 'all' || rewards.some(r => r.category === c.value),
            ).map(c => (
              <button
                key={c.value}
                type="button"
                role="tab"
                aria-selected={shelf === c.value}
                className={shelf === c.value ? 'vsx-wallet-tab is-on' : 'vsx-wallet-tab'}
                onClick={() => setShelf(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        {rewardsQuery.isPending && (
          <div className="vsx-store-grid">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="vsx-panel" style={{ height: 232 }} aria-hidden="true">
                <div className="vsx-skeleton" style={{ height: 13, width: '38%' }} />
                <div className="vsx-skeleton" style={{ height: 19, width: '70%', marginTop: 16 }} />
                <div className="vsx-skeleton" style={{ height: 13, marginTop: 12 }} />
                <div className="vsx-skeleton" style={{ height: 30, width: 110, marginTop: 28 }} />
              </div>
            ))}
          </div>
        )}

        {!rewardsQuery.isPending && rewards.length === 0 && (
          <section className="vsx-panel vsx-store-empty">
            <h2 className="vsx-panel-title">Nothing in the Value Store yet</h2>
            <p className="vsx-meta" style={{ fontSize: 14, marginTop: 10, maxWidth: '48ch', lineHeight: 1.6 }}>
              HR adds rewards and sets what each one costs. Your earned coins keep
              adding up in the meantime.
            </p>
          </section>
        )}

        {!rewardsQuery.isPending && rewards.length > 0 && shown.length === 0 && (
          <section className="vsx-panel vsx-store-empty">
            <h2 className="vsx-panel-title">Nothing on this shelf</h2>
            <p className="vsx-meta" style={{ fontSize: 14, marginTop: 10 }}>
              Other categories have rewards in them.
            </p>
            <button
              type="button"
              className="vsx-btn"
              style={{ marginTop: 18, alignSelf: 'flex-start' }}
              onClick={() => setShelf('all')}
            >
              Show everything
            </button>
          </section>
        )}

        {shown.length > 0 && (
          <div className="vsx-store-grid">
            {shown.map(reward => (
              <RewardCard key={reward.id} reward={reward} earned={earned} />
            ))}
          </div>
        )}
        </>
      )}
    </div>
  )
}
