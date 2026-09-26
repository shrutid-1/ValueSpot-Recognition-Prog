import { useAuth } from '@/context/AuthContext'
import { useTeamRecognitions } from '@/hooks/queries'
import { errorMessage } from '@/lib/query'
import { RecognitionPost } from '@/components/experience/RecognitionPost'
import { Panel, Empty, StatCard } from '@/components/admin/AdminUI'

/** getTeamFeedForManager's page size: a full page may not be everything. */
const TEAM_FEED_LIMIT = 50

/** A post-shaped placeholder, so the column does not jump when rows arrive. */
function PostSkeleton() {
  return (
    <div className="vsx-panel vsx-post" aria-hidden="true">
      <div className="flex items-center" style={{ gap: 13 }}>
        <div className="ad-skeleton" style={{ width: 42, height: 42, borderRadius: 999 }} />
        <div style={{ flex: 1 }}>
          <div className="ad-skeleton" style={{ height: 13, width: '45%' }} />
          <div className="ad-skeleton" style={{ height: 11, width: '30%', marginTop: 7 }} />
        </div>
      </div>
      <div className="ad-skeleton" style={{ height: 15, marginTop: 20 }} />
      <div className="ad-skeleton" style={{ height: 15, width: '82%', marginTop: 8 }} />
    </div>
  )
}

/**
 * The recognitions a manager's team has received.
 *
 * Built like the Recognition Feed — the same page head, the same posts, one
 * column — because it IS a feed, narrowed to one team. It used to render its
 * cards inside another card with dividers between them, which drew every
 * border twice and read as a broken list.
 *
 * Only ever opened in the administrative shell (Managers, HR, Super Admin).
 */
export default function TeamRecognitionPage() {
  const { employee } = useAuth()
  const teamFeed = useTeamRecognitions(employee?.id)

  // isLoading, not isPending: the query is disabled until the manager is
  // known, and a disabled query is isPending forever.
  const loading = teamFeed.isLoading

  const loadError = teamFeed.isError
    ? errorMessage(teamFeed.error, "We couldn't load team recognitions. Please try again.")
    : null

  const data = teamFeed.data
  const items = data?.items ?? []
  const appreciated = new Set(data?.appreciatedIds ?? [])
  const managesProjects = (data?.projectCount ?? 0) > 0
  const peopleRecognized = new Set(items.map(i => i.nominee_id)).size
  const capped = items.length >= TEAM_FEED_LIMIT

  return (
    <div className="ad-page">
      <div className="ad-page-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="ad-title">Team Recognition</h1>
          <p className="ad-sub">
            Approved recognitions for the people on the projects you manage, and any recognition
            filed against those projects.
          </p>
        </div>
      </div>

      <div
        style={{
          width: '100%',
          maxWidth: 880,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--ad-gap)',
        }}
      >
      {/* The team at a glance — only once there is a team to describe. Inside
          the column, so its edges line up with the posts below it. */}
      {!loading && !loadError && managesProjects && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 'var(--ad-gap)',
          }}
        >
          <StatCard
            label="Approved recognitions"
            // A number renders at figure size; only the capped "50+" is text.
            value={capped ? `${items.length}+` : items.length}
            foot={capped ? 'the latest shown below' : 'for your team, all time'}
          />
          <StatCard
            label="People recognized"
            value={peopleRecognized}
            foot={peopleRecognized === 1 ? 'person received them' : 'different people received them'}
          />
          <StatCard
            label="Projects you manage"
            value={data?.projectCount ?? 0}
            chip={`${data?.memberCount ?? 0}`}
            foot={(data?.memberCount ?? 0) === 1 ? 'member assigned' : 'members assigned'}
          />
        </div>
      )}

        {loading ? (
          [...Array(3)].map((_, i) => <PostSkeleton key={i} />)
        ) : loadError ? (
          /*
            A failed request is NOT an empty team. Showing the empty state on
            an error made a database or policy failure indistinguishable from
            a manager with nothing to show.
          */
          <Panel title="Team recognitions didn&rsquo;t load">
            <div role="alert">
              <p style={{ fontSize: 14, color: 'var(--ad-text-2)', lineHeight: 1.6, maxWidth: '48ch' }}>
                {loadError}
              </p>
              <button
                type="button"
                className="ad-btn ad-btn-primary"
                style={{ marginTop: 16 }}
                onClick={() => { void teamFeed.refetch() }}
                disabled={teamFeed.isFetching}
              >
                {teamFeed.isFetching ? 'Trying…' : 'Try again'}
              </button>
            </div>
          </Panel>
        ) : items.length === 0 ? (
          <Panel style={{ padding: 28 }} label="No team recognitions yet">
            <Empty
              title="No team recognitions yet"
              text={managesProjects
                ? 'Approved recognitions for your projects and the people on them will appear here.'
                : "You aren't the Project Manager of any active project. When HR makes you one, recognitions for that project and its members appear here."}
            />
          </Panel>
        ) : (
          items.map(item => (
            <RecognitionPost
              key={item.id}
              item={item}
              viewerId={employee?.id}
              alreadyAppreciated={appreciated.has(item.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}
