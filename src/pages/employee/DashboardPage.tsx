import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useBadgeDefinitions, useCoreValues, useEmployeeDashboard } from '@/hooks/queries'
import { ROUTES } from '@/lib/constants'
import { DashboardHeader } from '@/components/experience/DashboardHeader'
import type { RecordView } from '@/components/experience/DashboardHeader'
import { SummaryPanel } from '@/components/experience/SummaryPanel'
import { ValueMatrixPanel } from '@/components/experience/ValueMatrixPanel'
import { RecordPanel } from '@/components/experience/RecordPanel'
import { YearPanel } from '@/components/experience/YearPanel'
import { MilestonePanel } from '@/components/experience/MilestonePanel'
import { PeoplePanel } from '@/components/experience/PeoplePanel'
import { ValueRail } from '@/components/experience/ValueRail'

function Block({ h, w = '100%' }: { h: number; w?: string | number }) {
  return <div className="vsx-skeleton" style={{ height: h, width: w }} />
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Block h={72} w={420} />
      <div style={{ marginTop: 20 }}><Block h={44} w="min(56ch, 100%)" /></div>
      <div
        className="lg:grid"
        style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 18, marginTop: 34 }}
      >
        <Block h={240} />
        <Block h={240} />
      </div>
      <div style={{ marginTop: 18 }}><Block h={260} /></div>
    </div>
  )
}

/**
 * The dashboard could not be read.
 *
 * Kept distinct from "you have nothing yet", which is the whole reason it
 * exists: a failed request used to fall through to the same zeros a new
 * employee sees, so a broken page was indistinguishable from an untouched
 * one. Retry re-runs the queries rather than reloading the page.
 */
function DashboardError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div role="alert" className="vsx-panel" style={{ maxWidth: '52ch', padding: 30 }}>
      <h1 className="vsx-title" style={{ fontSize: 'clamp(28px, 4vw, 40px)' }}>
        This page didn&rsquo;t load
      </h1>
      <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--vsx-text-2)', marginTop: 14 }}>
        Your recognitions are safe. The problem is reading them, not the record
        itself.
      </p>
      <button
        type="button"
        className="vsx-btn vsx-btn-primary"
        onClick={onRetry}
        disabled={retrying}
        style={{ marginTop: 22, alignSelf: 'flex-start' }}
      >
        {retrying ? 'Trying…' : 'Try again'}
      </button>
    </div>
  )
}

export default function DashboardPage() {
  const { employee } = useAuth()
  const navigate = useNavigate()

  /*
    Both reference lists are shared caches the wizard and the HR screens
    already keep warm, and they are ARGUMENTS to the dashboard query rather
    than decoration: the catalogue decides which rows come back at all, so
    the dashboard stays disabled until it arrives.
  */
  const coreValuesQuery = useCoreValues()
  const badgeQuery = useBadgeDefinitions()
  const coreValues = coreValuesQuery.data ?? []
  const badgeDefinitions = badgeQuery.data ?? []

  const dashboard = useEmployeeDashboard(employee?.id, coreValues, badgeDefinitions)

  const stats = dashboard.data
  const badges = stats?.badges ?? []

  /*
    Memoised because the record below derives from it: `?? []` allocates a
    fresh array on every render, which would make the useMemo that filters it
    re-run every time regardless of whether the data changed.
  */
  const feed = useMemo(() => stats?.recentFeed ?? [], [stats?.recentFeed])

  /*
    isLoading, not isPending: the dashboard query is disabled until both
    reference lists arrive, and a disabled query stays `isPending` forever.
  */
  const loading = coreValuesQuery.isLoading || badgeQuery.isLoading || dashboard.isLoading
  const failed = coreValuesQuery.isError || badgeQuery.isError || dashboard.isError
  const retrying =
    coreValuesQuery.isFetching || badgeQuery.isFetching || dashboard.isFetching

  const retry = () => {
    void coreValuesQuery.refetch()
    void badgeQuery.refetch()
    void dashboard.refetch()
  }

  /*
    The two filters the header, the matrix and the rail all share.

    Page-level state rather than inside any one component, because both are
    relationships BETWEEN components: the rail and the matrix set the value,
    the record answers to it. Nothing is fetched or refetched — these are
    reading aids over rows that are already on the page, which is what keeps
    them instant and keeps them from being able to promise data the page
    does not hold.
  */
  const [activeValueId, setActiveValueId] = useState<string | null>(null)
  const [view, setView] = useState<RecordView>('all')

  const goGive = () => navigate(ROUTES.GIVE_RECOGNITION)
  const goJourney = () => navigate(ROUTES.CORE_VALUE_JOURNEY)
  const goFeed = () => navigate(ROUTES.RECOGNITION_FEED)

  /*
    The header quotes the most recent recognition this person RECEIVED, and
    that entry is then held back from the record below — the lead quote and
    the first row being the same recognition would read as a mistake.
  */
  const latestReceived = feed.find(i => i.nominee_id === employee?.id) ?? null

  const record = useMemo(() => {
    const withoutLead = latestReceived ? feed.filter(i => i.id !== latestReceived.id) : feed
    if (view === 'received') return withoutLead.filter(i => i.nominee_id === employee?.id)
    if (view === 'given') return withoutLead.filter(i => i.nominator_id === employee?.id)
    return withoutLead
  }, [feed, latestReceived, view, employee?.id])

  /*
    The page carries the theme itself as well as inheriting it from the shell.
    Redundant for an employee and deliberate: /dashboard is not role-gated, so
    a Manager or HR Admin who types it renders inside the light administrative
    shell, and without this the markup would be styled by rules not in scope.
  */
  if (failed) {
    return (
      <div data-vs-theme="dark">
        <DashboardError onRetry={retry} retrying={retrying} />
      </div>
    )
  }

  if (loading) {
    return (
      <div data-vs-theme="dark">
        <DashboardSkeleton />
      </div>
    )
  }

  return (
    <div data-vs-theme="dark">
      <ValueRail
        badges={badges}
        activeValueId={activeValueId}
        onToggleValue={setActiveValueId}
      />

      <DashboardHeader
        fullName={employee?.full_name ?? ''}
        latestReceived={latestReceived}
        badges={badges}
        view={view}
        onViewChange={setView}
        activeValueId={activeValueId}
        onValueChange={setActiveValueId}
        onRefresh={retry}
        refreshing={retrying}
      />

      {/*
        The grid.

        Two columns at xl: the panels that summarise on the left, the record
        on the right. The record is the tallest thing on the page and the
        only one that grows without bound, so it gets its own column and the
        left column stacks beside it — which is what stops one long feed from
        stretching every other panel to match it.
      */}
      <div className="vsx-dash-grid">
        <div className="vsx-dash-left">
          <SummaryPanel
            received={stats?.received ?? 0}
            given={stats?.given ?? 0}
            thisMonth={stats?.thisMonth ?? 0}
            monthlyReceived={stats?.monthlyReceived ?? []}
            monthlyGiven={stats?.monthlyGiven ?? []}
            delay={0}
          />

          <ValueMatrixPanel
            badges={badges}
            activeValueId={activeValueId}
            onToggleValue={setActiveValueId}
            delay={60}
          />

          <YearPanel
            monthlyReceived={stats?.monthlyReceived ?? []}
            monthlyGiven={stats?.monthlyGiven ?? []}
            delay={120}
          />

          <MilestonePanel badges={badges} onViewJourney={goJourney} delay={180} />

          <PeoplePanel items={feed} employeeId={employee?.id} delay={240} />
        </div>

        <RecordPanel
          items={record}
          employeeId={employee?.id}
          activeValueId={activeValueId}
          onClearValue={() => setActiveValueId(null)}
          onViewFeed={goFeed}
          onGiveRecognition={goGive}
          delay={90}
        />
      </div>
    </div>
  )
}
