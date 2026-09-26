import type React from 'react'
import { Star } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useCoreValues, useBadgeDefinitions, useCoreValueJourney } from '@/hooks/queries'
import { PageHeader } from '@/components/shared/PageHeader'
import { Skeleton } from '@/components/shared/SkeletonLoader'
import { EmptyState } from '@/components/shared/EmptyState'
import { valueToneVars as toneVars } from '@/lib/value-tone'
import { currentAnnualPeriod, nowIST } from '@/lib/date-utils'
import {
  activeTiers, buildTrack, daysLeftInSeason, summariseSeason,
  type TrackModel, type TrackStop,
} from '@/lib/journey'
import type { BadgeSummary } from '@/types'
import { cn } from '@/lib/utils'

/*
  Motion, in milliseconds. Each trail fills in turn, and its fill takes
  longer the further it has to travel, so a long trail reads as a long way
  come rather than as the same flick as a short one.
*/
const ENTER_STAGGER = 90
const FILL_START = 260
const FILL_BASE = 420
const FILL_PER_TRAIL = 1000

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Additive badge glyph — each tier adds a stroke to the one below it. */
function TierGlyph({ level, size = 16 }: { level: number; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
    >
      <rect x={3} y={3} width={18} height={18} />
      {level >= 2 && <rect x={7} y={7} width={10} height={10} />}
      {level >= 3 && <><line x1={12} y1={3} x2={12} y2={21} /><line x1={3} y1={12} x2={21} y2={12} /></>}
      {level >= 4 && <><line x1={3} y1={3} x2={21} y2={21} /><line x1={21} y1={3} x2={3} y2={21} /></>}
      {level >= 5 && <rect x={9} y={9} width={6} height={6} fill="currentColor" />}
    </svg>
  )
}

function TrackSkeleton() {
  return (
    <div className="vj-panel vj-track" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Skeleton style={{ height: 10, width: 90 }} />
      <Skeleton style={{ height: 22, width: 140 }} />
      <Skeleton style={{ height: 6, width: '100%', marginTop: 30 }} />
      <Skeleton style={{ height: 10, width: '100%', marginTop: 20 }} />
    </div>
  )
}

/* ── The season at a glance ─────────────────────────────────── */

function SeasonPanel({
  badges, tracks, daysLeft, year,
}: {
  badges: BadgeSummary[]
  tracks: TrackModel[]
  daysLeft: number
  year: string
}) {
  const season = summariseSeason(tracks)
  const lead = season.closest[0]
  // The first of the closest leads the panel and lends it its colour.
  const focus = lead === undefined ? null : { badge: badges[lead], track: tracks[lead] }
  const fresh = season.totalRecognitions === 0
  const tied = season.closest.length > 1

  let body: React.ReactNode
  if (!focus?.track.next) {
    body = (
      <>
        <p className="vj-season-kicker">Map complete</p>
        <p className="vj-season-title font-condensed">Every trail cleared this season</p>
        <p className="vj-season-sub">You hold the top badge on every Core Value.</p>
      </>
    )
  } else if (fresh) {
    body = (
      <>
        <p className="vj-season-title font-condensed">
          Your first badge is <span className="vj-tone-text">1 recognition</span> away
        </p>
        <p className="vj-season-sub">
          Be recognized for any Core Value to unlock {focus.track.next.name}.
          Every value has {focus.track.stops.length} badges to collect this season.
        </p>
      </>
    )
  } else {
    const remaining = focus.track.remaining ?? 0
    body = (
      <>
        <p className="vj-season-kicker">{tied ? 'Closest unlocks' : 'Closest unlock'}</p>
        <div className="vj-season-goal">
          <span className="vj-season-num font-condensed">{remaining}</span>
          <div>
            {tied ? (
              <>
                <p className="vj-season-title font-condensed">more unlocks a badge</p>
                <p className="vj-season-sub">
                  {season.closest.length} badges are {plural(remaining, 'recognition')} away.
                </p>
              </>
            ) : (
              <>
                <p className="vj-season-title font-condensed">
                  more to <span className="vj-tone-text">{focus.track.next.name}</span>
                </p>
                <p className="vj-season-sub">
                  {remaining === 1 ? 'One more recognition' : `${remaining} more recognitions`}{' '}
                  for <strong className="vj-tone-text">{focus.badge.core_value_name}</strong>
                  {focus.track.current ? `, where you hold ${focus.track.current.name}.` : '.'}
                </p>
              </>
            )}
          </div>
        </div>
        {tied && (
          <ul className="vj-chips" aria-label="Badges within reach">
            {season.closest.map(i => (
              <li key={badges[i].core_value_id} className="vj-chip vj-toned" style={toneVars(badges[i].core_value_slug)}>
                <span className="vj-chip-dot" aria-hidden="true" />
                {badges[i].core_value_name}
                <span className="vj-chip-to">→ {tracks[i].next?.name}</span>
              </li>
            ))}
          </ul>
        )}
      </>
    )
  }

  return (
    <section
      className={cn('vj-panel vj-season vj-toned', focus && 'has-focus')}
      style={focus ? toneVars(focus.badge.core_value_slug) : undefined}
      aria-label="Season overview"
    >
      <div className="vj-season-lead">
        <p className="vj-eyebrow">
          Season {year}
          <span className="vj-dot-sep" aria-hidden="true" />
          {daysLeft === 1 ? 'Last day' : `${daysLeft} days left`}
        </p>
        <div className="vj-season-body">{body}</div>
      </div>

      <div className="vj-collection">
        <div className="vj-collection-head">
          <p className="vj-collection-label">Badges collected</p>
          <p className="vj-collection-count font-condensed">
            {season.stopsEarned}<span>/{season.stopsTotal}</span>
          </p>
        </div>
        <ul className="vj-collection-rows">
          {tracks.map((t, row) => {
            const b = badges[row]
            return (
              <li
                key={b.core_value_id}
                className="vj-collection-row vj-toned"
                style={toneVars(b.core_value_slug)}
                aria-label={`${b.core_value_name}: ${t.earned} of ${t.stops.length} badges`}
              >
                <span className="vj-collection-name">{b.core_value_name}</span>
                <span className="vj-cells" aria-hidden="true">
                  {t.stops.map((s, col) => (
                    <span
                      key={s.level}
                      className={cn('vj-cell', s.state === 'earned' && 'is-on', s.state === 'next' && 'is-next')}
                      style={{ '--vj-cd': `${400 + row * 70 + col * 55}ms` } as React.CSSProperties}
                    />
                  ))}
                </span>
              </li>
            )
          })}
        </ul>
        <p className="vj-collection-foot">
          {plural(season.totalRecognitions, 'recognition')} received this season
        </p>
      </div>
    </section>
  )
}

/* ── One value's trail ───────────────────────────────────────── */

function stopCaption(s: TrackStop) {
  if (s.state === 'earned') return 'Unlocked'
  return `at ${s.threshold}`
}

function ValueTrack({
  badge, track, index, isClosest,
}: {
  badge: BadgeSummary
  track: TrackModel
  index: number
  isClosest: boolean
}) {
  const { next, current, remaining, count } = track
  const complete = next === null && track.stops.length > 0

  const delay = FILL_START + index * (ENTER_STAGGER + 60)
  const dur = FILL_BASE + track.at * FILL_PER_TRAIL
  const style = {
    ...toneVars(badge.core_value_slug),
    '--vj-at': track.at,
    '--vj-enter': `${index * ENTER_STAGGER}ms`,
    '--vj-delay': `${delay}ms`,
    '--vj-dur': `${dur}ms`,
  } as React.CSSProperties

  return (
    <article
      className={cn('vj-panel vj-track vj-toned', complete && 'is-complete', isClosest && 'is-closest')}
      style={style}
      aria-label={`${badge.core_value_name} journey`}
    >
      <header className="vj-track-head">
        <div className="min-w-0">
          <p className="vj-value-name">
            {badge.core_value_name}
            {isClosest && <span className="vj-tag">Closest unlock</span>}
          </p>
          <p className={cn('vj-held font-condensed', !current && 'is-none')}>
            {current ? current.name : 'Not started'}
          </p>
          <p className="vj-meta">
            {plural(count, 'recognition')}
            <span className="vj-dot-sep" aria-hidden="true" />
            {plural(badge.unique_recognizer_count, 'recognizer')}
          </p>
        </div>

        {next && remaining !== null ? (
          <div className="vj-goal">
            <span className="vj-goal-num font-condensed">{remaining}</span>
            <span className="vj-goal-text">
              more to
              <strong className="font-condensed">{next.name}</strong>
            </span>
          </div>
        ) : complete ? (
          <div className="vj-goal is-done">
            <span className="vj-goal-glyph"><TierGlyph level={5} size={18} /></span>
            <span className="vj-goal-text">
              Trail complete
              <strong className="font-condensed">Top badge held</strong>
            </span>
          </div>
        ) : null}
      </header>

      <div className="vj-trail">
        <div
          className="vj-rail"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={next ? next.threshold : count}
          aria-valuenow={count}
          aria-label={
            next
              ? `${badge.core_value_name}: ${count} of ${next.threshold} recognitions toward ${next.name}`
              : `${badge.core_value_name}: every badge unlocked`
          }
        >
          <span className="vj-rail-fill" />
        </div>

        <span className="vj-start" aria-hidden="true" />

        <div className="vj-you" aria-hidden="true">
          <span className="vj-you-pill">You · {count}</span>
          <span className="vj-you-stem" />
          <span className="vj-you-dot" />
        </div>

        <ol className="vj-stops" aria-label={`${badge.core_value_name} badges`}>
          {track.stops.map((s, i) => {
            const isFinal = i === track.stops.length - 1
            const isCurrent = current?.level === s.level
            // An earned stop lights as the fill reaches it.
            const ignite = delay + dur * (track.at > 0 ? s.pos / track.at : 0)
            return (
              <li
                key={s.level}
                className={cn('vj-stop', `is-${s.state}`, isFinal && 'is-final', isCurrent && 'is-current')}
                style={{ '--vj-pos': s.pos, '--vj-ignite': `${Math.round(ignite)}ms` } as React.CSSProperties}
                title={`${s.name} — ${s.description}`}
              >
                <span className="vj-node">
                  <TierGlyph level={s.level} size={isFinal ? 18 : 15} />
                </span>
                <span className="vj-stop-name font-condensed">{s.name}</span>
                <span className="vj-stop-at">{stopCaption(s)}</span>
                <span className="sr-only">
                  {s.state === 'earned'
                    ? ', unlocked'
                    : `, needs ${plural(s.threshold, 'recognition')}${s.state === 'next' ? ', next' : ''}`}
                </span>
              </li>
            )
          })}
        </ol>
      </div>
    </article>
  )
}

export default function CoreValueJourneyPage() {
  const { employee } = useAuth()
  /*
    Both lists are shared reference data. This screen used to fetch the core
    values and the badge thresholds itself, alongside the badge rows — two of
    those three requests are now served from cache.
  */
  const coreValuesQuery = useCoreValues()
  const badgeQuery = useBadgeDefinitions()
  const coreValues = coreValuesQuery.data ?? []
  const badgeDefinitions = badgeQuery.data ?? []

  const journey = useCoreValueJourney(employee?.id, coreValues, badgeDefinitions)

  const badges = journey.data ?? []

  /*
    isLoading, not isPending: the journey query is disabled until both
    reference lists arrive, and a disabled query is `isPending` forever. With
    no active core values that left a skeleton on screen permanently instead
    of the "nothing yet" empty state. The two reference queries are included so
    the empty state does not flash while they are still in flight.
  */
  const loading =
    coreValuesQuery.isLoading || badgeQuery.isLoading || journey.isLoading

  const tiers = activeTiers(badgeDefinitions)
  const tracks = badges.map(b => buildTrack(b.recognition_count, b.badge_level, tiers))
  const season = summariseSeason(tracks)
  // A trail is tagged only when it alone is nearest; a tie is listed in the panel.
  const closestIndex =
    season.totalRecognitions > 0 && season.closest.length === 1 ? season.closest[0] : null

  const { end } = currentAnnualPeriod()

  return (
    <div className="vj-scope animate-fade-in" style={{ maxWidth: 960, margin: '0 auto' }}>
      <PageHeader
        kicker="Annual Period"
        title="My Core Value Journey"
        subtitle="Every Core Value has its own trail of badges. Each recognition you receive moves you along it — here is where you stand, and what's next."
      />

      {loading ? (
        <div className="vj-list">
          {[...Array(3)].map((_, i) => <TrackSkeleton key={i} />)}
        </div>
      ) : badges.length === 0 ? (
        <EmptyState
          icon={<Star size={36} />}
          title="Your journey starts here"
          description="When colleagues recognize you for a Core Value behaviour, your progress will appear here."
          className="py-12"
        />
      ) : (
        <div className="vj-list">
          <SeasonPanel
            badges={badges}
            tracks={tracks}
            daysLeft={daysLeftInSeason(end, nowIST())}
            year={end.slice(0, 4)}
          />
          {badges.map((b, i) => (
            <ValueTrack
              key={b.core_value_id}
              badge={b}
              track={tracks[i]}
              index={i}
              isClosest={i === closestIndex}
            />
          ))}
        </div>
      )}
    </div>
  )
}
