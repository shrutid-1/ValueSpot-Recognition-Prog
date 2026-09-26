import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Award, Bell, Heart, LayoutGrid, LifeBuoy, LogOut, Plus, Radio, ShoppingBag,
  User, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useNotifications } from '@/context/NotificationContext'
import { NotificationCenter } from '@/components/notifications/NotificationCenter'
import { useWalletBalance } from '@/hooks/queries'
import { Avatar } from './Avatar'
import { ValueCoin } from './ValueCoin'
import { ValueSpotLogo, ValueSpotMark } from '@/components/brand/ValueSpotLogo'
import { ValueCoinFigure } from './ValueCoinFigure'
import { ToggleTheme } from '@/components/lightswind/toggle-theme'
import { ROUTES } from '@/lib/constants'
import { useIsDarkTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

/**
 * The top bar.
 *
 * A circular mark, a row of destination pills, and the signed-in person at
 * the right. The current destination is a SOLID WHITE pill with near-black
 * text — the strongest inversion in the palette, spent on the question a
 * navigation bar exists to answer.
 *
 * Every Employee destination is reachable from here: Home, Recognition feed,
 * My recognitions, My journey, Support, Give recognition, notifications,
 * Profile and Sign out. Routing and authorisation are untouched — the same
 * links to the same paths, with ProtectedRoute and the database still
 * deciding everything that matters.
 *
 * On controls: there is exactly ONE menu control. Below 1180px it is shown
 * and the inline pills are not; at or above 1180px the pills are shown and
 * the menu is display:none. It and the sheet it opens are gated by the SAME
 * pair of classes (.vsx-narrow), so they can never disagree — which is
 * exactly how an earlier version ended up with a visible button whose sheet
 * was hidden, and which therefore did nothing.
 */

interface Destination {
  label: string
  href: string
  icon: LucideIcon
}

const DESTINATIONS: Destination[] = [
  { label: 'Home',             href: ROUTES.DASHBOARD,           icon: LayoutGrid },
  { label: 'Feed',             href: ROUTES.RECOGNITION_FEED,    icon: Radio },
  { label: 'My recognitions',  href: ROUTES.MY_RECOGNITIONS,     icon: Heart },
  { label: 'My journey',       href: ROUTES.CORE_VALUE_JOURNEY,  icon: Award },
  { label: 'Support',          href: ROUTES.SUPPORT,             icon: LifeBuoy },
]

/** The mark: the logo's dotted O on its own black ground. */
function Mark() {
  return <ValueSpotMark size={46} />
}

function Wordmark() {
  // The letters follow the page; the mark keeps its own black ground.
  const dark = useIsDarkTheme()
  return (
    <span className="inline-flex items-center gap-3">
      <Mark />
      <ValueSpotLogo size={17} tone={dark ? 'onDark' : 'onLight'} title={null} />
    </span>
  )
}

export function AppNavigation() {
  const { employee, signOut } = useAuth()
  const { unreadCount } = useNotifications()
  const navigate = useNavigate()
  const location = useLocation()

  const [bellOpen, setBellOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  const bellRef = useRef<HTMLDivElement>(null)
  const accountRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const sheetCloseRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false)
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setAccountOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (sheetOpen) { setSheetOpen(false); menuButtonRef.current?.focus(); return }
      if (bellOpen) return setBellOpen(false)
      if (accountOpen) return setAccountOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sheetOpen, bellOpen, accountOpen])

  // Following a link inside the sheet must close it, or it covers the page
  // the tap just loaded.
  useEffect(() => { setSheetOpen(false) }, [location.pathname])

  // The sheet is modal: hold the page still behind it and move focus into it.
  useEffect(() => {
    if (!sheetOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    sheetCloseRef.current?.focus()
    return () => { document.body.style.overflow = previous }
  }, [sheetOpen])

  const handleSignOut = async () => {
    setAccountOpen(false)
    setSheetOpen(false)
    await signOut()
    navigate(ROUTES.LOGIN)
  }

  const name = employee?.full_name ?? ''

  /*
    Opens the wallet if this is their first time, and reports the balance.
    Mounted on the bar, which is on every Employee screen, so the one-time
    grant happens on the first screen anybody reaches rather than depending
    on them visiting a particular page.
  */
  const wallet = useWalletBalance(employee?.id)
  const walletBalance = wallet.data?.budget ?? null
  /*
    The line under the name. The reference puts a social handle here; the
    real equivalent in this product is the Company ID, which is on the
    employee record and is what colleagues and HR actually identify somebody
    by. Nothing is invented when it is missing — the line is simply absent.
  */
  const companyId = employee?.employee_id ?? ''

  return (
    <>
      <header className="vsx-topbar" style={{ position: 'sticky', top: 0, zIndex: 40 }}>
        <div
          className="vsx-measure-bar flex items-center"
          style={{ height: 82, gap: 'clamp(10px, 1.4vw, 18px)' }}
        >
          <NavLink
            to={ROUTES.DASHBOARD}
            style={{ textDecoration: 'none', flexShrink: 0, display: 'flex' }}
            aria-label="ValueSpot, go to home"
          >
            {/* The full wordmark where it fits; the disc alone where it does not. */}
            <span className="vsx-wide"><Wordmark /></span>
            <span className="vsx-narrow"><Mark /></span>
          </NavLink>

          {/* Destination pills — only at widths where they fit. */}
          <nav className="vsx-wide items-center" style={{ gap: 8 }} aria-label="Main">
            {DESTINATIONS.map(d => {
              const Icon = d.icon
              return (
                <NavLink
                  key={d.href}
                  to={d.href}
                  end={d.href === ROUTES.DASHBOARD}
                  className={({ isActive }) => cn('vsx-navpill', isActive && 'is-active')}
                >
                  <Icon size={16} aria-hidden="true" strokeWidth={2} />
                  {d.label}
                </NavLink>
              )
            })}
          </nav>

          <div className="flex items-center ml-auto" style={{ gap: 10 }}>
            {/*
              The balance, beside the bell.

              Here rather than only on the profile because it is the number
              that tells you whether the Send coins button on a post will
              work — and that decision is made in the feed, not on an account
              page. It links to the profile, where the ledger explains it.

              Hidden below 1180px with the destination pills: on a phone the
              bar is a mark, a bell and a face, and a fourth item crowds the
              one control that has to stay reachable.

              It links to the Value Wallet, which is where the number is
              explained rather than merely restated.
            */}
            <NavLink
              to={ROUTES.WALLET}
              className="vsx-coin-chip-nav vsx-wide"
              aria-label={
                walletBalance === null
                  ? 'Your recognition budget'
                  : `Your recognition budget: ${walletBalance} Value Coins`
              }
              title="Your Value Coins"
            >
              <ValueCoin size={17} />
              {/* The one balance visible from every screen, so it is where a
                  send is seen to land: it counts down to its new figure with
                  the amount dropping away beneath it. */}
              <ValueCoinFigure
                value={walletBalance ?? 0}
                account="budget"
                pending={walletBalance === null}
                style={{ fontSize: 15 }}
              />
            </NavLink>

            {/* Light or dark, remembered for this portal (lib/theme.ts). */}
            <ToggleTheme className="vsx-round" animationType="fade-in-out" duration={500} />

            {/* Notifications, as the circular control beside the pills. */}
            <div ref={bellRef} className="relative">
              <button
                type="button"
                className="vsx-round"
                onClick={() => { setBellOpen(v => !v); setAccountOpen(false) }}
                aria-label={
                  unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
                }
                aria-expanded={bellOpen}
                aria-haspopup="dialog"
              >
                <Bell size={19} aria-hidden="true" strokeWidth={1.8} />
                {unreadCount > 0 && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      top: 6,
                      right: 6,
                      minWidth: 18,
                      height: 18,
                      padding: '0 5px',
                      borderRadius: 999,
                      background: 'var(--vsx-silver)',
                      color: 'var(--vsx-on-fill)',
                      fontFamily: 'var(--vsx-display)',
                      fontSize: 12,
                      fontWeight: 700,
                      lineHeight: '18px',
                      textAlign: 'center',
                      border: '2px solid var(--vsx-ink)',
                    }}
                  >
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {bellOpen && <NotificationCenter onClose={() => setBellOpen(false)} />}
            </div>

            {/* The signed-in person. Name and role, then the face. */}
            <div ref={accountRef} className="vsx-wide relative items-center" style={{ gap: 12 }}>
              <div style={{ textAlign: 'right', minWidth: 0 }}>
                <p
                  className="truncate"
                  style={{
                    fontFamily: 'var(--vsx-sans)',
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--vsx-text)',
                    lineHeight: 1.25,
                    maxWidth: 190,
                  }}
                >
                  {name || '—'}
                </p>
                {companyId && (
                  <p
                    className="truncate"
                    style={{ fontSize: 12.5, color: 'var(--vsx-text-3)', maxWidth: 190 }}
                  >
                    {companyId}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => { setAccountOpen(v => !v); setBellOpen(false) }}
                aria-expanded={accountOpen}
                aria-haspopup="menu"
                aria-label="Account"
                style={{
                  background: 'transparent',
                  border: 0,
                  padding: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  borderRadius: 999,
                }}
              >
                <Avatar name={name || '?'} avatarUrl={employee?.avatar_url} size="lg" />
              </button>

              {accountOpen && (
                <div
                  role="menu"
                  className="vsx-sheet-in"
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: '100%',
                    marginTop: 12,
                    width: 250,
                    background: 'var(--vsx-ink-3)',
                    borderRadius: 'var(--vsx-r-sm)',
                    boxShadow: '0 24px 64px rgba(0,0,0,0.62)',
                    overflow: 'hidden',
                    zIndex: 50,
                  }}
                >
                  <div style={{ padding: '15px 17px' }}>
                    <p style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--vsx-text)' }}>
                      {name || '—'}
                    </p>
                    <p className="vsx-meta truncate" style={{ fontSize: 12.5, marginTop: 2 }}>
                      {employee?.email ?? ''}
                    </p>
                  </div>
                  <div style={{ padding: '0 7px 7px' }}>
                    <button
                      type="button"
                      role="menuitem"
                      className="vsx-btn vsx-btn-quiet"
                      style={{ width: '100%', justifyContent: 'flex-start' }}
                      onClick={() => { setAccountOpen(false); navigate(ROUTES.WALLET) }}
                    >
                      <ValueCoin size={15} /> Value Wallet
                      {walletBalance !== null && (
                        <span className="vsx-fig ml-auto" style={{ fontSize: 13 }}>
                          {walletBalance.toLocaleString()}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="vsx-btn vsx-btn-quiet"
                      style={{ width: '100%', justifyContent: 'flex-start' }}
                      onClick={() => { setAccountOpen(false); navigate(ROUTES.VALUE_STORE) }}
                    >
                      <ShoppingBag size={15} aria-hidden="true" strokeWidth={1.8} /> Value Store
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="vsx-btn vsx-btn-quiet"
                      style={{ width: '100%', justifyContent: 'flex-start' }}
                      onClick={() => { setAccountOpen(false); navigate(ROUTES.PROFILE) }}
                    >
                      <User size={15} aria-hidden="true" strokeWidth={1.8} /> Profile
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="vsx-btn vsx-btn-quiet"
                      style={{ width: '100%', justifyContent: 'flex-start' }}
                      onClick={handleSignOut}
                    >
                      <LogOut size={15} aria-hidden="true" strokeWidth={1.8} /> Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/*
              The one menu control. Rendered only below 1180px, which is
              exactly where the pills and the account block are hidden — so it
              always has something to open, and above 1180px it does not
              exist. Labelled, not drawn as three anonymous lines.
            */}
            <button
              ref={menuButtonRef}
              type="button"
              className="vsx-btn vsx-btn-sm vsx-narrow"
              onClick={() => setSheetOpen(true)}
              aria-expanded={sheetOpen}
              aria-haspopup="dialog"
              aria-controls="vsx-menu-sheet"
            >
              Menu
            </button>
          </div>
        </div>
      </header>

      {/* ── Menu sheet ─────────────────────────────────────── */}
      {sheetOpen && (
        <div
          id="vsx-menu-sheet"
          className="vsx-narrow"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          style={{ position: 'fixed', inset: 0, zIndex: 60 }}
        >
          <div
            style={{ position: 'absolute', inset: 0, background: 'rgba(5,5,5,0.8)' }}
            onClick={() => setSheetOpen(false)}
            aria-hidden="true"
          />
          <div
            className="vsx-sheet-in"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'var(--vsx-ink)',
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
            }}
          >
            <div
              className="flex items-center"
              style={{
                height: 82,
                padding: '0 clamp(16px, 5vw, 28px)',
                flexShrink: 0,
              }}
            >
              <Wordmark />
              <button
                ref={sheetCloseRef}
                type="button"
                className="vsx-round ml-auto"
                onClick={() => setSheetOpen(false)}
                aria-label="Close menu"
              >
                <X size={20} aria-hidden="true" strokeWidth={1.8} />
              </button>
            </div>

            <nav
              aria-label="Main"
              style={{
                padding: 'clamp(12px, 4vw, 24px)',
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {DESTINATIONS.map(d => {
                const Icon = d.icon
                return (
                  <NavLink
                    key={d.href}
                    to={d.href}
                    end={d.href === ROUTES.DASHBOARD}
                    className={({ isActive }) => cn('vsx-navpill', isActive && 'is-active')}
                    style={{ height: 58, fontSize: 16, justifyContent: 'flex-start' }}
                  >
                    <Icon size={19} aria-hidden="true" strokeWidth={2} />
                    {d.label}
                  </NavLink>
                )
              })}

              <div
                className="flex items-center gap-3"
                style={{
                  marginTop: 14,
                  padding: 16,
                  background: 'var(--vsx-ink-2)',
                  borderRadius: 'var(--vsx-r)',
                }}
              >
                <Avatar name={name || '?'} avatarUrl={employee?.avatar_url} size="md" />
                <div className="min-w-0">
                  <p style={{ fontSize: 14.5, fontWeight: 600 }}>{name || '—'}</p>
                  <p className="vsx-meta truncate" style={{ fontSize: 12.5 }}>
                    {employee?.email ?? ''}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {/* The balance pill in the bar is hidden below 1180px, so the
                    wallet needs a way in from here or it is unreachable on a
                    phone. */}
                <button
                  type="button"
                  className="vsx-btn vsx-btn-sm"
                  onClick={() => navigate(ROUTES.WALLET)}
                >
                  <ValueCoin size={15} /> Value Wallet
                  {walletBalance !== null && (
                    <span className="vsx-fig" style={{ fontSize: 13 }}>
                      {walletBalance.toLocaleString()}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="vsx-btn vsx-btn-sm"
                  onClick={() => navigate(ROUTES.VALUE_STORE)}
                >
                  <ShoppingBag size={15} aria-hidden="true" strokeWidth={1.8} /> Value Store
                </button>
                <button
                  type="button"
                  className="vsx-btn vsx-btn-sm"
                  onClick={() => navigate(ROUTES.PROFILE)}
                >
                  <User size={15} aria-hidden="true" strokeWidth={1.8} /> Profile
                </button>
                <button type="button" className="vsx-btn vsx-btn-sm" onClick={handleSignOut}>
                  <LogOut size={15} aria-hidden="true" strokeWidth={1.8} /> Sign out
                </button>
              </div>
            </nav>

            <div style={{ padding: 'clamp(16px, 4vw, 24px)', flexShrink: 0 }}>
              <button
                type="button"
                className="vsx-btn vsx-btn-primary"
                style={{ width: '100%', height: 54 }}
                onClick={() => { setSheetOpen(false); navigate(ROUTES.GIVE_RECOGNITION) }}
              >
                <Plus size={18} aria-hidden="true" strokeWidth={2.4} />
                Recognize someone
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
