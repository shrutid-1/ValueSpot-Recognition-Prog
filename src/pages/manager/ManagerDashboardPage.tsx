import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckSquare, Plus, FolderKanban, ArrowRight } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import {
  useManagerDashboard, useApprovalQueue, useTeamRecognitions,
  useTeamBadges, useManagedProjects,
} from '@/hooks/queries'
import { ROUTES } from '@/lib/constants'
import { timeAgo } from '@/lib/date-utils'
import {
  Panel, StatCard, Row, Status, ValuePill, AdminAvatar, BarBand, Gauge,
  Empty, StatSkeleton, RowsSkeleton, BlockSkeleton,
  type BandPoint,
} from '@/components/admin/AdminUI'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

/** Whole days between a timestamp and now, floored at 0. */
function daysSince(iso: string | null): number {
  if (!iso) return 0
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

/**
 * The last seven days, as a band.
 *
 * Built from the team's approved recognitions rather than from a separate
 * request: the list is already on the page for the activity panel, and one
 * pass over it is cheaper than a second round trip for the same rows. Days
 * with nothing in them are still drawn — a quiet Tuesday is a reading.
 */
function weekBand(dates: Array<string | null>): BandPoint[] {
  const byDay = new Map<string, number>()
  for (const d of dates) {
    if (!d) continue
    const key = new Date(d).toDateString()
    byDay.set(key, (byDay.get(key) ?? 0) + 1)
  }

  const out: BandPoint[] = []
  for (let i = 6; i >= 0; i--) {
    const day = new Date()
    day.setHours(0, 0, 0, 0)
    day.setDate(day.getDate() - i)
    out.push({
      label: day.toLocaleDateString(undefined, { weekday: 'narrow' }),
      full: day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }),
      value: byDay.get(day.toDateString()) ?? 0,
    })
  }
  return out
}

/**
 * The Manager dashboard.
 *
 * Everything on it is read from the manager's own scope — the queue routed to
 * them, the members of the projects they run, the recognitions those members
 * received. Nothing is projected, averaged against a benchmark or compared to
 * "last month": the platform records what people did, and a dashboard that
 * invented a trend line from it would be the first thing to lose a manager's
 * trust.
 *
 * The accented card is the approval queue, because that is the one thing on this
 * screen that is WAITING ON THIS PERSON. Every other figure is information.
 */
export default function ManagerDashboardPage() {
  const { employee, role } = useAuth()
  const navigate = useNavigate()

  const dashboard = useManagerDashboard(employee?.id)
  const queue     = useApprovalQueue()
  const team      = useTeamRecognitions(employee?.id)
  const badges    = useTeamBadges(employee?.id)
  const projects  = useManagedProjects()

  const stats = dashboard.data ?? { pending: 0, teamRecognitions: 0, teamMembers: 0 }
  // isLoading, not isPending: these are disabled until the manager is known,
  // and a disabled query is isPending forever.
  const loading = dashboard.isLoading

  const teamItems = useMemo(() => team.data?.items ?? [], [team.data])

  /* Only what is still waiting, and oldest first — the order an approver
     would work in, and the same rule the approvals screen applies. */
  const waiting = useMemo(
    () => (queue.data ?? [])
      .filter(i => i.status === 'pending')
      .sort((a, b) =>
        new Date(a.submitted_at ?? a.created_at).getTime() -
        new Date(b.submitted_at ?? b.created_at).getTime()),
    [queue.data],
  )

  const oldest = waiting[0] ?? null
  const oldestDays = oldest ? daysSince(oldest.submitted_at ?? oldest.created_at) : 0

  const band = useMemo(() => weekBand(teamItems.map(i => i.approved_at)), [teamItems])
  const weekTotal = band.reduce((n, d) => n + d.value, 0)

  const thisMonth = useMemo(() => {
    const now = new Date()
    return teamItems.filter(i => {
      if (!i.approved_at) return false
      const d = new Date(i.approved_at)
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    }).length
  }, [teamItems])

  /* How much of the team has been recognised at all, in the rows loaded.
     Stated as exactly that in the caption — it is a reach, not a score. */
  const recognisedMembers = useMemo(
    () => new Set(teamItems.map(i => i.nominee_id)).size,
    [teamItems],
  )
  const reach = stats.teamMembers > 0
    ? Math.min(100, Math.round((recognisedMembers / stats.teamMembers) * 100))
    : 0

  /* Counted from the same team_badges() answer as its denominator, so "X of N"
     can never mix two definitions of the team. For HR and Super Admin that
     answer is the organisation, and the caption says so. */
  const badgeHolders = useMemo(
    () => (badges.data?.members ?? []).filter(m => m.badges.some(b => b.badge_level !== null)).length,
    [badges.data],
  )
  const badgeScopeSize = badges.data?.members.length ?? stats.teamMembers
  const badgeScopeWord = badges.data?.scope === 'organization' ? ' employees' : ''

  /* The value this team is recognised for most often. Ties resolve to the
     first seen, which is the most recent — good enough for a headline that
     names a value rather than ranking them. */
  const topValue = useMemo(() => {
    const tally = new Map<string, number>()
    for (const i of teamItems) {
      tally.set(i.core_value_name, (tally.get(i.core_value_name) ?? 0) + 1)
    }
    const [name, count] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
    return name ? { name, count: count ?? 0 } : null
  }, [teamItems])

  const projectList = projects.data ?? []
  const managesProjects = role === 'manager'

  return (
    <div className="ad-page">

      {/* ── Head ─────────────────────────────────────────────── */}
      <div className="ad-page-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="ad-title">Dashboard</h1>
          <p className="ad-sub">
            {greeting()}, {employee?.full_name?.split(' ')[0] ?? 'there'}.{' '}
            {stats.pending > 0
              ? `${stats.pending} recognition${stats.pending !== 1 ? 's' : ''} ${stats.pending !== 1 ? 'are' : 'is'} waiting for your review.`
              : 'Nothing is waiting for your review.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
          <button
            type="button"
            className={stats.pending > 0 ? 'ad-btn ad-btn-primary' : 'ad-btn'}
            onClick={() => navigate(ROUTES.PENDING_APPROVALS)}
          >
            <CheckSquare size={16} aria-hidden="true" strokeWidth={2} />
            Review Approvals
          </button>
          <button
            type="button"
            className={stats.pending > 0 ? 'ad-btn' : 'ad-btn ad-btn-primary'}
            onClick={() => navigate(ROUTES.GIVE_RECOGNITION)}
          >
            <Plus size={16} aria-hidden="true" strokeWidth={2.2} />
            Give Recognition
          </button>
        </div>
      </div>

      {/* ── The four figures ─────────────────────────────────── */}
      {loading ? (
        <div className="ad-grid ad-grid-4">
          {[0, 1, 2, 3].map(i => <StatSkeleton key={i} />)}
        </div>
      ) : (
        <div className="ad-grid ad-grid-4">
          <StatCard
            featured
            label="Pending Approvals"
            value={stats.pending}
            chip={stats.pending > 0 && oldestDays > 0 ? `${oldestDays}d` : undefined}
            foot={
              stats.pending === 0
                ? 'You are all caught up'
                : oldestDays > 0
                  ? 'longest wait so far'
                  : 'all arrived today'
            }
            onClick={() => navigate(ROUTES.PENDING_APPROVALS)}
            goesTo="Pending Approvals"
          />
          <StatCard
            label="Team Members"
            value={stats.teamMembers}
            foot={
              managesProjects
                ? `across ${projectList.length} project${projectList.length !== 1 ? 's' : ''} you run`
                : 'on the projects in your scope'
            }
            onClick={managesProjects ? () => navigate(ROUTES.MANAGED_PROJECTS) : undefined}
            goesTo="My Projects"
          />
          <StatCard
            label="Team Recognitions"
            value={stats.teamRecognitions}
            chip={thisMonth > 0 ? `+${thisMonth}` : undefined}
            foot={thisMonth > 0 ? 'approved this month' : 'approved, all time'}
            onClick={() => navigate(ROUTES.TEAM_RECOGNITION)}
            goesTo="Team Recognition"
          />
          <StatCard
            label="Badge Holders"
            value={badgeHolders}
            foot={
              badgeHolders === 0
                ? 'no Core Value badge earned yet'
                : `of ${badgeScopeSize}${badgeScopeWord} hold a Core Value badge`
            }
            onClick={() => navigate(ROUTES.TEAM_BADGES)}
            goesTo="Team Badges"
          />
        </div>
      )}

      {/* ── Activity · Reminder · Projects ───────────────────── */}
      <div className="ad-grid ad-grid-3">
        <Panel
          title="Recognition Activity"
          sub="Approved recognitions received by your team, last 7 days"
          action={
            <button
              type="button"
              className="ad-btn ad-btn-quiet ad-btn-sm"
              onClick={() => navigate(ROUTES.TEAM_RECOGNITION)}
            >
              View all
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          }
        >
          {team.isLoading ? (
            <BlockSkeleton height={190} />
          ) : (
            <>
              <BarBand data={band} />
              <p style={{ fontSize: 12.5, color: 'var(--ad-text-3)', marginTop: 14 }}>
                {weekTotal === 0
                  ? 'Nothing approved for your team in the last seven days.'
                  : `${weekTotal} recognition${weekTotal !== 1 ? 's' : ''} approved this week.`}
              </p>
            </>
          )}
        </Panel>

        {/*
          One reminder, not a list. The queue itself is a screen away and
          holds every item with the controls to decide it; what belongs on a
          dashboard is the ONE that has been waiting longest, because that is
          the only item whose age is itself the news.
        */}
        <Panel title="Waiting Longest" label="The recognition waiting longest for your review">
          {queue.isPending ? (
            <BlockSkeleton height={150} />
          ) : !oldest ? (
            <Empty
              title="Nothing waiting"
              text="Recognitions routed to you will appear here the moment they are submitted."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 14 }}>
              <div>
                <ValuePill name={oldest.core_value.name} slug={oldest.core_value.slug} />
                <p style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 12, lineHeight: 1.3 }}>
                  {oldest.nominee.full_name}
                </p>
                <p style={{ fontSize: 13, color: 'var(--ad-text-2)', marginTop: 4, lineHeight: 1.5 }}>
                  Recognised by {oldest.nominator.full_name}
                  {oldest.project?.name ? ` in ${oldest.project.name}` : ''}
                </p>
                <p style={{ fontSize: 12.5, color: 'var(--ad-text-3)', marginTop: 8 }}>
                  Submitted {timeAgo(oldest.submitted_at ?? oldest.created_at)}
                  {waiting.length > 1 && ` · ${waiting.length - 1} more in the queue`}
                </p>
              </div>

              <button
                type="button"
                className="ad-btn ad-btn-primary"
                style={{ width: '100%', marginTop: 'auto' }}
                onClick={() => navigate(ROUTES.PENDING_APPROVALS)}
              >
                <CheckSquare size={16} aria-hidden="true" strokeWidth={2} />
                Review Now
              </button>
            </div>
          )}
        </Panel>

        <Panel
          title={managesProjects ? 'My Projects' : 'Projects'}
          sub={managesProjects ? 'The projects you run' : undefined}
          action={managesProjects ? (
            <button
              type="button"
              className="ad-btn ad-btn-quiet ad-btn-sm"
              onClick={() => navigate(ROUTES.MANAGED_PROJECTS)}
            >
              All
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          ) : undefined}
        >
          {!managesProjects ? (
            /*
              An HR Admin or Super Admin can open this dashboard, and
              managed_projects() is empty for them by construction — a Project
              Manager must hold the Manager role (029). Saying so is better
              than an empty list that looks like a failure.
            */
            <Empty
              title="No projects of your own"
              text="Project Managers are Managers. Every project in the organisation is under Manage → Projects."
            />
          ) : projects.isPending ? (
            <RowsSkeleton rows={3} />
          ) : projectList.length === 0 ? (
            <Empty title="No projects yet" text="Projects you are made Project Manager of will appear here." />
          ) : (
            <div className="ad-list">
              {projectList.slice(0, 4).map(p => (
                <Row
                  key={p.id}
                  lead={
                    <span className="ad-mark" aria-hidden="true">
                      <FolderKanban size={16} strokeWidth={1.9} />
                    </span>
                  }
                  title={p.name}
                  sub={`${p.member_count} member${p.member_count !== 1 ? 's' : ''}`}
                  trail={
                    <Status tone={p.is_active ? 'ok' : 'idle'}>
                      {p.is_active ? 'Active' : 'Closed'}
                    </Status>
                  }
                  onClick={() => navigate(ROUTES.MANAGED_PROJECTS)}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ── Team · Reach · Headline ──────────────────────────── */}
      <div className="ad-grid ad-grid-3">
        <Panel
          title="Team Recognition"
          sub="Most recently approved for the people you manage"
          action={
            <button
              type="button"
              className="ad-btn ad-btn-quiet ad-btn-sm"
              onClick={() => navigate(ROUTES.TEAM_RECOGNITION)}
            >
              View all
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          }
        >
          {team.isLoading ? (
            <RowsSkeleton rows={4} />
          ) : teamItems.length === 0 ? (
            <Empty
              title="No recognitions yet"
              text="When a recognition for one of your team members is approved, it appears here."
            />
          ) : (
            <div className="ad-list">
              {teamItems.slice(0, 5).map(item => (
                <Row
                  key={item.id}
                  lead={<AdminAvatar name={item.nominee_name} avatarUrl={item.nominee_avatar} />}
                  title={item.nominee_name}
                  sub={`Recognised by ${item.nominator_name}${item.project_name ? ` · ${item.project_name}` : ''}`}
                  trail={<ValuePill name={item.core_value_name} />}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Recognition Reach" label="How much of your team has been recognised">
          {team.isLoading ? (
            <BlockSkeleton height={190} />
          ) : (
            <>
              <Gauge
                value={reach}
                caption="of the team"
                legend={[
                  { label: `${recognisedMembers} recognised`, color: 'var(--ad-a-600)' },
                  {
                    label: `${Math.max(stats.teamMembers - recognisedMembers, 0)} not yet`,
                    color: 'var(--ad-inset)',
                  },
                ]}
              />
              <p style={{ fontSize: 12, color: 'var(--ad-text-3)', marginTop: 14, lineHeight: 1.5, textAlign: 'center' }}>
                {stats.teamMembers === 0
                  ? 'No team members on your projects yet.'
                  : `${recognisedMembers} of ${stats.teamMembers} team members appear in an approved recognition.`}
              </p>
            </>
          )}
        </Panel>

        {/*
          The headline reading. One card, one figure, and it is a fact about
          the team rather than a score: which value this team is most often
          recognised for.
        */}
        <div className="ad-deep">
          <div style={{ position: 'relative', zIndex: 1 }}>
            <p className="ad-deep-label">Most recognised value</p>
            <p className="ad-deep-value" style={{ marginTop: 10 }}>
              {topValue ? topValue.name : '—'}
            </p>
          </div>
          <div style={{ position: 'relative', zIndex: 1 }}>
            {topValue && (
              <p
                className="ad-chip"
                style={{ background: 'rgba(255,255,255,0.18)', color: '#FFFFFF', marginBottom: 10 }}
              >
                {topValue.count} recognition{topValue.count !== 1 ? 's' : ''}
              </p>
            )}
            <p className="ad-deep-foot">
              {topValue
                ? 'The Core Value your team is recognised for most often.'
                : 'No approved recognitions for your team yet — this names the value they are recognised for most.'}
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
              onClick={() => navigate(ROUTES.TEAM_BADGES)}
            >
              Team Badges
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
