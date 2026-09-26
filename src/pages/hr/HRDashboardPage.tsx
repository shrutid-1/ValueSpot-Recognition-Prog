import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Plus, FileText, ShieldCheck, Shield, Settings, ArrowRight, ArrowUpRight, Trophy,
} from 'lucide-react'
import { useHrDashboard } from '@/hooks/queries'
import { useAuth } from '@/context/AuthContext'
import { ROUTES } from '@/lib/constants'
import { timeAgo } from '@/lib/date-utils'
import {
  Panel, StatCard, Row, ValuePill, AdminAvatar, BarBand, Gauge, Empty,
  StatSkeleton, RowsSkeleton, BlockSkeleton,
  type BandPoint,
} from '@/components/admin/AdminUI'
import { adminValueTone } from '@/lib/admin-value-tone'

/**
 * The administration strip, shown only to a Super Admin.
 *
 * The rest of this page is the organisation-wide recognition view, which HR
 * and a Super Admin read identically. This is the part that is genuinely
 * Super-Admin-shaped: who can administer the system, what has been done to it,
 * and the settings behind it.
 *
 * Deliberately links rather than summarises. Each of these screens already
 * loads and presents its own data, and pulling copies of it onto a dashboard
 * would mean a second place to keep correct — and three more queries on a page
 * that already runs several. The value here is the signposting, not a
 * duplicate of the numbers.
 */
function AdministrationBand() {
  const links = [
    { label: 'Administration', href: ROUTES.ADMINISTRATION, icon: ShieldCheck,
      hint: 'Who holds Super Admin and HR access' },
    { label: 'Audit Logs',     href: ROUTES.AUDIT_LOGS,     icon: Shield,
      hint: 'What has been changed, and by whom' },
    { label: 'Settings',       href: ROUTES.SETTINGS,       icon: Settings,
      hint: 'Badge thresholds and workspace rules' },
  ]

  return (
    <section aria-label="Administration" className="ad-grid ad-grid-3">
      {links.map(({ label, href, icon: Icon, hint }) => (
        <Link key={href} to={href} className="ad-card" style={{ textDecoration: 'none', padding: 16 }}>
          <div className="flex items-start" style={{ gap: 12 }}>
            <span className="ad-mark" aria-hidden="true" style={{ width: 38, height: 38 }}>
              <Icon size={17} strokeWidth={1.9} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--ad-text)' }}>
                {label}
              </span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--ad-text-3)', marginTop: 3, lineHeight: 1.45 }}>
                {hint}
              </span>
            </span>
            <ArrowUpRight size={16} aria-hidden="true" style={{ color: 'var(--ad-text-3)', flexShrink: 0 }} />
          </div>
        </Link>
      ))}
    </section>
  )
}

export default function HRDashboardPage() {
  /*
    All of this screen's data comes from one cached query.

    It used to be eight requests in three sequential waves — with the trend as
    twelve serial round trips of its own — re-run in full on every visit,
    because there was nowhere for the previous result to live. The aggregation
    now happens in analyticsApi (one wave) and the result is cached for a
    minute, so returning to the dashboard is instant.

    The component no longer knows any table name, column list or RPC.
  */
  const { data, isPending } = useHrDashboard()
  const { role } = useAuth()
  const navigate = useNavigate()

  const loading = isPending
  const isSuperAdmin = role === 'super_admin'

  const metrics     = data ?? null
  const cvDist      = useMemo(() => data?.coreValueDistribution ?? [], [data])
  const dailyLeaders = data?.dailyLeaders ?? []
  const recentFeed  = data?.recentFeed ?? []

  /*
    The week, as the band reads it.

    The dates arrive as IST calendar days (yyyy-MM-dd), already bucketed by
    the API, so the letters are derived in UTC from that key — reading them
    with a local clock would shift a day for anyone outside IST and file
    Monday's count under Sunday.
  */
  const band: BandPoint[] = useMemo(
    () => (data?.daily ?? []).map(d => {
      const day = new Date(`${d.date}T00:00:00Z`)
      return {
        label: day.toLocaleDateString(undefined, { weekday: 'narrow', timeZone: 'UTC' }),
        full: day.toLocaleDateString(undefined, {
          weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC',
        }),
        value: d.count,
      }
    }),
    [data],
  )

  const weekTotal = band.reduce((n, d) => n + d.value, 0)

  const distMax = useMemo(
    () => Math.max(...cvDist.map(v => v.count), 1),
    [cvDist],
  )
  const distSorted = useMemo(
    () => [...cvDist].sort((a, b) => b.count - a.count),
    [cvDist],
  )

  return (
    <div className="ad-page">

      {/* ── Head ─────────────────────────────────────────────── */}
      <div className="ad-page-head">
        <div style={{ minWidth: 0 }}>
          {/*
            The eyebrow names the ROLE READING the page, not the page.

            This one component is the primary dashboard for two roles — it is
            where both HR and a Super Admin land, and what "Dashboard" points
            at for both — because the organisation-wide view is the same view.
            Reusing it is deliberate; a second copy differing only in its
            heading would be two dashboards to keep in step for no gain.

            What must not happen is a Super Admin being told they are looking
            at the "HR Dashboard", so the label follows the reader.
          */}
          <p className="vs-kicker" style={{ marginBottom: 6 }}>
            {isSuperAdmin ? 'Super Admin' : 'HR Admin'}
          </p>
          <h1 className="ad-title">Dashboard</h1>
          <p className="ad-sub">
            How Touchcore&rsquo;s Core Values are being demonstrated across the organisation.
          </p>
        </div>

        <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
          <button
            type="button"
            className="ad-btn ad-btn-primary"
            onClick={() => navigate(ROUTES.GIVE_RECOGNITION)}
          >
            <Plus size={16} aria-hidden="true" strokeWidth={2.2} />
            Give Recognition
          </button>
          <button type="button" className="ad-btn" onClick={() => navigate(ROUTES.REPORTS)}>
            <FileText size={16} aria-hidden="true" strokeWidth={1.9} />
            Reports
          </button>
        </div>
      </div>

      {isSuperAdmin && <AdministrationBand />}

      {/* ── The four figures ─────────────────────────────────── */}
      {loading || !metrics ? (
        <div className="ad-grid ad-grid-4">
          {[0, 1, 2, 3].map(i => <StatSkeleton key={i} />)}
        </div>
      ) : (
        <div className="ad-grid ad-grid-4">
          <StatCard
            featured
            label="Total Recognitions"
            value={metrics.totalRecognitions}
            chip={metrics.mostRecognizedValue ?? undefined}
            foot={metrics.mostRecognizedValue ? 'leads the Core Values' : 'approved, all time'}
            onClick={() => navigate(ROUTES.ANALYTICS)}
            goesTo="Analytics"
          />
          <StatCard
            label="Employees Recognized"
            value={metrics.employeesRecognized}
            foot={`of ${metrics.activeEmployees} active employee${metrics.activeEmployees !== 1 ? 's' : ''}`}
            onClick={() => navigate(ROUTES.EMPLOYEES)}
            goesTo="Employees"
          />
          <StatCard
            label="Pending Approvals"
            value={metrics.pendingApprovals}
            foot={
              metrics.pendingApprovals === 0
                ? 'nothing waiting anywhere'
                : 'awaiting a decision'
            }
            onClick={() => navigate(ROUTES.PENDING_APPROVALS)}
            goesTo="Pending Approvals"
          />
          <StatCard
            label="Cross-Team Recognition"
            value={`${metrics.crossTeamPct}%`}
            chip={`${metrics.crossTeamCount}`}
            foot="crossed a department boundary"
            onClick={() => navigate(ROUTES.ANALYTICS)}
            goesTo="Analytics"
          />
        </div>
      )}

      {/* ── Trend · Today · Values ───────────────────────────── */}
      <div className="ad-grid ad-grid-3">
        <Panel
          title="Recognition Analytics"
          sub="Approved recognitions across the organisation, last 7 days"
          action={
            <button
              type="button"
              className="ad-btn ad-btn-quiet ad-btn-sm"
              onClick={() => navigate(ROUTES.ANALYTICS)}
            >
              Analytics
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          }
        >
          {loading ? (
            <BlockSkeleton height={190} />
          ) : (
            <>
              <BarBand data={band} />
              <p style={{ fontSize: 12.5, color: 'var(--ad-text-3)', marginTop: 16 }}>
                {weekTotal === 0
                  ? 'Nothing approved anywhere in the last seven days.'
                  : `${weekTotal} recognition${weekTotal !== 1 ? 's' : ''} approved this week.`}
              </p>
            </>
          )}
        </Panel>

        <Panel
          title="Most Recognized Today"
          sub="Leading the day, per Core Value"
          label="Who leads each Core Value today"
        >
          {loading ? (
            <RowsSkeleton rows={3} />
          ) : dailyLeaders.length === 0 ? (
            <Empty
              title="Nothing approved today"
              text="Today&rsquo;s leaders appear here as recognitions are approved."
            />
          ) : (
            <div className="ad-list">
              {dailyLeaders.map(l => (
                <Row
                  key={l.core_value_name}
                  lead={
                    <span
                      className="ad-mark"
                      style={{ ['--tone' as string]: adminValueTone(l.core_value_name) }}
                      aria-hidden="true"
                    >
                      <Trophy size={15} strokeWidth={1.9} />
                    </span>
                  }
                  title={l.employee_name}
                  sub={`${l.count} recognition${l.count !== 1 ? 's' : ''} today`}
                  trail={<ValuePill name={l.core_value_name} />}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Core Values"
          sub="Share of all approved recognitions"
          action={
            <button
              type="button"
              className="ad-btn ad-btn-quiet ad-btn-sm"
              onClick={() => navigate(ROUTES.CORE_VALUES)}
            >
              Manage
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          }
        >
          {loading ? (
            <RowsSkeleton rows={4} />
          ) : distSorted.length === 0 ? (
            <Empty title="No recognitions yet" text="Each Core Value appears here once it has been recognised." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {distSorted.map(v => {
                const tone = adminValueTone(v.slug || v.name)
                return (
                  <div key={v.name}>
                    <div className="flex items-center justify-between" style={{ gap: 10, marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ad-text)', minWidth: 0 }} className="truncate">
                        {v.name}
                      </span>
                      <span style={{ fontSize: 12.5, color: 'var(--ad-text-3)', fontVariantNumeric: 'tabular-nums' }}>
                        {v.count}
                      </span>
                    </div>
                    <div style={{ height: 8, borderRadius: 999, background: 'var(--ad-inset)', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.max((v.count / distMax) * 100, 2)}%`,
                          borderRadius: 999,
                          background: tone,
                          transition: 'width 640ms cubic-bezier(0.22, 0.61, 0.36, 1)',
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Panel>
      </div>

      {/* ── Recent · Coverage · Headline ─────────────────────── */}
      <div className="ad-grid ad-grid-3">
        <Panel
          title="Recent Recognitions"
          sub="The latest approved across the organisation"
          action={
            <button
              type="button"
              className="ad-btn ad-btn-quiet ad-btn-sm"
              onClick={() => navigate(ROUTES.RECOGNITION_FEED)}
            >
              Open feed
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          }
        >
          {loading ? (
            <RowsSkeleton rows={5} />
          ) : recentFeed.length === 0 ? (
            <Empty
              title="No recognitions yet"
              text="Approved recognitions appear here, newest first."
            />
          ) : (
            <div className="ad-list">
              {recentFeed.slice(0, 5).map(item => (
                <Row
                  key={item.id}
                  lead={<AdminAvatar name={item.nominee_name} avatarUrl={item.nominee_avatar} />}
                  title={item.nominee_name}
                  sub={`${item.nominator_name}${item.approved_at ? ` · ${timeAgo(item.approved_at)}` : ''}`}
                  trail={<ValuePill name={item.core_value_name} />}
                  onClick={() => navigate(ROUTES.RECOGNITION_FEED)}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Recognition Coverage" label="Share of active employees recognised">
          {loading || !metrics ? (
            <BlockSkeleton height={190} />
          ) : (
            <>
              <Gauge
                value={metrics.coverage}
                caption="of employees"
                legend={[
                  { label: `${metrics.employeesRecognized} recognised`, color: 'var(--ad-a-600)' },
                  {
                    label: `${Math.max(metrics.activeEmployees - metrics.employeesRecognized, 0)} not yet`,
                    color: 'var(--ad-inset)',
                  },
                ]}
              />
              <p style={{ fontSize: 12, color: 'var(--ad-text-3)', marginTop: 14, lineHeight: 1.5, textAlign: 'center' }}>
                {metrics.activeEmployees === 0
                  ? 'No active employees on record.'
                  : `${metrics.employeesRecognized} of ${metrics.activeEmployees} active employees appear in an approved recognition.`}
              </p>
            </>
          )}
        </Panel>

        {/*
          The headline reading. Which value the organisation demonstrates most
          — a fact about behaviour, not a score, and the reason the platform
          records a value on every recognition in the first place.
        */}
        <div className="ad-deep">
          <div style={{ position: 'relative', zIndex: 1 }}>
            <p className="ad-deep-label">Top Core Value</p>
            <p className="ad-deep-value" style={{ marginTop: 10 }}>
              {metrics?.mostRecognizedValue ?? '—'}
            </p>
          </div>
          <div style={{ position: 'relative', zIndex: 1 }}>
            {metrics && metrics.totalRecognitions > 0 && (
              <p
                className="ad-chip"
                style={{ background: 'rgba(255,255,255,0.18)', color: '#FFFFFF', marginBottom: 10 }}
              >
                {distSorted[0]?.count ?? 0} of {metrics.totalRecognitions}
              </p>
            )}
            <p className="ad-deep-foot">
              {metrics?.mostRecognizedValue
                ? 'Recognised more often than any other Core Value.'
                : 'Once recognitions are approved, the leading Core Value is named here.'}
            </p>
            <button
              type="button"
              className="ad-btn ad-btn-sm"
              style={{
                marginTop: 14,
                background: 'rgba(255,255,255,0.14)',
                borderColor: 'rgba(255,255,255,0.28)',
                color: '#FFFFFF',
              }}
              onClick={() => navigate(ROUTES.BADGE_ANALYTICS)}
            >
              Badge Analytics
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
