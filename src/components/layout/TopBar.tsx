import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell, LogOut, Settings, Menu, ChevronDown, Search, LifeBuoy, User, CornerDownLeft,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useNotifications } from '@/context/NotificationContext'
import { NotificationCenter } from '@/components/notifications/NotificationCenter'
import { ToggleTheme } from '@/components/lightswind/toggle-theme'
import { buildNav } from './navModel'
import { ROUTES } from '@/lib/constants'

interface TopBarProps {
  onMobileMenuOpen: () => void
}

/** Get initials from a full name */
function getInitials(name: string): string {
  return name
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/** Role label for display */
function formatRole(role: string | null): string {
  if (!role) return ''
  return role.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())
}

export function TopBar({ onMobileMenuOpen }: TopBarProps) {
  const { employee, role, signOut } = useAuth()
  const { unreadCount } = useNotifications()
  const navigate = useNavigate()

  const [notifOpen, setNotifOpen]     = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [query, setQuery]             = useState('')
  const [searchOpen, setSearchOpen]   = useState(false)

  const notifRef   = useRef<HTMLDivElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)
  const searchRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)

  /*
    What the search searches.

    The field used to hold text and do nothing with it — a control that looks
    like it works and does not. It now searches THE DESTINATIONS THIS ROLE
    HAS, read from the same buildNav() the sidebar renders, so it can never
    offer a screen the person is not shown. It finds pages, not records: the
    screens that hold records — Employees, Reports, the feed — each carry
    their own search over their own data, and a second, shallower one in the
    chrome would be the worse answer to "where is Priya".
  */
  const destinations = useMemo(
    () => buildNav(role).flatMap(g =>
      g.items.map(i => ({ label: i.label, href: i.href, group: g.label ?? 'Menu', icon: i.icon }))),
    [role],
  )

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return destinations.filter(d => d.label.toLowerCase().includes(q)).slice(0, 6)
  }, [destinations, query])

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false)
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false)
      }
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Ctrl/⌘ + K puts the caret in the field, from anywhere in the portal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const go = (href: string) => {
    setQuery('')
    setSearchOpen(false)
    navigate(href)
  }

  const handleSignOut = async () => {
    setProfileOpen(false)
    await signOut()
    navigate(ROUTES.LOGIN)
  }

  const initials  = employee ? getInitials(employee.full_name) : '??'
  const roleLabel = formatRole(role)

  return (
    <header className="ad-topbar">
      {/* Mobile hamburger */}
      <button
        className="ad-icon-btn ad-only-mobile"
        onClick={onMobileMenuOpen}
        aria-label="Open navigation menu"
      >
        <Menu size={18} />
      </button>

      {/* Search */}
      <div ref={searchRef} className="relative" style={{ flex: 1, minWidth: 0, maxWidth: 360 }}>
        <div className="ad-search">
          <Search size={16} style={{ color: 'var(--ad-text-3)', flexShrink: 0 }} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setSearchOpen(true) }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={e => {
              if (e.key === 'Enter' && matches[0]) go(matches[0].href)
              if (e.key === 'Escape') { setQuery(''); setSearchOpen(false); inputRef.current?.blur() }
            }}
            placeholder="Search screens…"
            aria-label="Search screens"
            aria-expanded={searchOpen && matches.length > 0}
            aria-controls="ad-search-results"
          />
          <kbd className="ad-kbd ad-hide-xs" aria-hidden="true">Ctrl K</kbd>
        </div>

        {searchOpen && query.trim() !== '' && (
          <div className="ad-menu" id="ad-search-results" style={{ left: 0, right: 'auto', minWidth: 'min(340px, 80vw)' }} role="listbox">
            {matches.length === 0 ? (
              <p style={{ padding: '12px 11px', fontSize: 13, color: 'var(--ad-text-3)' }}>
                No screen matches “{query.trim()}”.
              </p>
            ) : (
              matches.map(m => {
                const Icon = m.icon
                return (
                  <button
                    key={m.href}
                    type="button"
                    role="option"
                    aria-selected="false"
                    className="ad-menu-item"
                    onClick={() => go(m.href)}
                  >
                    <Icon size={16} aria-hidden="true" strokeWidth={1.9} />
                    <span style={{ flex: 1, minWidth: 0 }} className="truncate">{m.label}</span>
                    <span style={{ fontSize: 11, color: 'var(--ad-text-3)' }}>{m.group}</span>
                  </button>
                )
              })
            )}
            {matches.length > 0 && (
              <p
                className="flex items-center gap-1.5"
                style={{ padding: '7px 11px 4px', fontSize: 11, color: 'var(--ad-text-3)' }}
              >
                <CornerDownLeft size={12} aria-hidden="true" />
                Enter opens the first result
              </p>
            )}
          </div>
        )}
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-2 ml-auto">
        <button
          type="button"
          className="ad-icon-btn ad-hide-xs"
          onClick={() => navigate(ROUTES.SUPPORT)}
          aria-label="Support"
          title="Support"
        >
          <LifeBuoy size={18} strokeWidth={1.9} />
        </button>

        {/* Light or dark, remembered for this portal (lib/theme.ts). */}
        <ToggleTheme className="ad-icon-btn" animationType="fade-in-out" duration={500} />

        {/* Notifications */}
        <div ref={notifRef} className="relative">
          <button
            className="ad-icon-btn"
            onClick={() => { setNotifOpen(v => !v); setProfileOpen(false) }}
            aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
            aria-expanded={notifOpen}
          >
            <Bell size={18} strokeWidth={1.9} />
            {unreadCount > 0 && <span className="ad-dot" aria-hidden="true" />}
          </button>
          {notifOpen && <NotificationCenter onClose={() => setNotifOpen(false)} />}
        </div>

        {/* Profile cluster */}
        <div ref={profileRef} className="relative">
          <button
            className="ad-user"
            onClick={() => { setProfileOpen(v => !v); setNotifOpen(false) }}
            aria-expanded={profileOpen}
            aria-label="Profile menu"
          >
            <span className="ad-avatar" aria-hidden="true">
              {employee?.avatar_url
                ? <img src={employee.avatar_url} alt="" />
                : initials}
            </span>
            <span className="hidden md:block text-left min-w-0">
              <span className="ad-user-name" style={{ display: 'block' }}>
                {employee?.full_name ?? '…'}
              </span>
              <span className="ad-user-mail" style={{ display: 'block' }}>
                {employee?.email ?? roleLabel}
              </span>
            </span>
            <ChevronDown
              size={14}
              className="hidden md:block"
              style={{ color: 'var(--ad-text-3)', flexShrink: 0 }}
              aria-hidden="true"
            />
          </button>

          {profileOpen && (
            <div className="ad-menu">
              <div style={{ padding: '10px 11px 8px' }}>
                <p style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ad-text)' }}>
                  {employee?.full_name ?? '…'}
                </p>
                <p style={{ fontSize: 11.5, color: 'var(--ad-text-3)', marginTop: 2 }}>
                  {employee?.email ?? ''}
                </p>
                <span className="ad-status ad-status-ok" style={{ marginTop: 8 }}>{roleLabel}</span>
              </div>

              <div className="ad-menu-sep" />

              <button
                className="ad-menu-item"
                onClick={() => { navigate(ROUTES.PROFILE); setProfileOpen(false) }}
              >
                <User size={16} strokeWidth={1.9} aria-hidden="true" />
                My profile
              </button>

              {/*
                Settings is an HR screen — workspace rules and badge
                thresholds — and the route is gated to hr_admin and above.
                Offering it to a Manager would be offering a refusal.
              */}
              {(role === 'hr_admin' || role === 'super_admin') && (
                <button
                  className="ad-menu-item"
                  onClick={() => { navigate(ROUTES.SETTINGS); setProfileOpen(false) }}
                >
                  <Settings size={16} strokeWidth={1.9} aria-hidden="true" />
                  Settings
                </button>
              )}

              <div className="ad-menu-sep" />

              <button
                className="ad-menu-item"
                style={{ color: 'var(--ad-a-700)' }}
                onClick={handleSignOut}
              >
                <LogOut size={16} strokeWidth={1.9} aria-hidden="true" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
