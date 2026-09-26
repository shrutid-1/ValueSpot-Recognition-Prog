import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import {
  useCoreValues,
  useRecognitionFeed,
} from '@/hooks/queries'
import type { FeedSort } from '@/lib/api'
import { errorMessage } from '@/lib/query'
import { ROUTES } from '@/lib/constants'
import { FeedComposer } from '@/components/experience/FeedComposer'
import { RecognitionPost } from '@/components/experience/RecognitionPost'
import { SelectPill } from '@/components/experience/SelectPill'
import type { SelectOption } from '@/components/experience/SelectPill'
import { valueTone } from '@/lib/value-tone'

/** A post-shaped placeholder, so the feed does not jump when it arrives. */
function PostSkeleton() {
  return (
    <div className="vsx-panel vsx-post" aria-hidden="true">
      <div className="flex items-center" style={{ gap: 13 }}>
        <div className="vsx-skeleton" style={{ width: 42, height: 42, borderRadius: 999 }} />
        <div style={{ flex: 1 }}>
          <div className="vsx-skeleton" style={{ height: 13, width: '45%' }} />
          <div className="vsx-skeleton" style={{ height: 11, width: '30%', marginTop: 7 }} />
        </div>
      </div>
      <div className="vsx-skeleton" style={{ height: 15, marginTop: 20 }} />
      <div className="vsx-skeleton" style={{ height: 15, width: '82%', marginTop: 8 }} />
      <div className="vsx-skeleton" style={{ height: 34, width: 130, marginTop: 22 }} />
    </div>
  )
}

export default function RecognitionFeedPage() {
  const { employee } = useAuth()
  const navigate = useNavigate()

  /*
    Both controls are page state, and both are ARGUMENTS TO THE QUERY rather
    than filters applied afterwards. That is the whole reason they can be
    trusted: sorting or filtering the pages already loaded would mean "most
    appreciated" silently meant "most appreciated of the twenty rows you have
    scrolled", and a value filter would hide matches that had simply not been
    fetched yet.
  */
  const [sort, setSort] = useState<FeedSort>('recent')
  const [valueId, setValueId] = useState<string | null>(null)

  const coreValuesQuery = useCoreValues()
  const coreValues = useMemo(() => coreValuesQuery.data ?? [], [coreValuesQuery.data])

  const feed = useRecognitionFeed(employee?.id, { sort, coreValueId: valueId })

  const pages = useMemo(() => feed.data?.pages ?? [], [feed.data])
  const items = useMemo(() => pages.flatMap(p => p.items), [pages])

  /*
    Each page carries the viewer's own appreciations for its rows, so the set
    is the union across the pages loaded so far.
  */
  const appreciatedIds = useMemo(
    () => new Set(pages.flatMap(p => p.appreciatedIds)),
    [pages],
  )

  const loading = feed.isPending
  const loadError = feed.isError
    ? errorMessage(feed.error, 'We could not load the recognition feed. Please try again.')
    : null

  const activeValue = valueId ? coreValues.find(v => v.id === valueId) ?? null : null

  const sortOptions: SelectOption[] = [
    { value: 'recent', label: 'Newest first' },
    { value: 'appreciated', label: 'Most appreciated' },
  ]

  const valueOptions: SelectOption[] = [
    { value: null, label: 'All values' },
    ...coreValues.map(v => ({
      value: v.id,
      label: v.name,
      tone: valueTone(v.slug || v.name),
    })),
  ]

  const goGive = () => navigate(ROUTES.GIVE_RECOGNITION)

  return (
    <div data-vs-theme="dark" className="vsx-feed-page">
      {/*
        The page head. No kicker above the title: "Company feed / Recognition
        feed" said the same thing twice, and a tracked-out label above every
        heading is chrome rather than information.
      */}
      <div
        className="vsx-page-head vsx-settle flex flex-wrap items-end"
        style={{ gap: '18px 24px', marginBottom: 'clamp(18px, 2.4vw, 26px)' }}
      >
        <div style={{ flex: '1 1 300px', minWidth: 0 }}>
          <h1 className="vsx-title" style={{ fontSize: 'clamp(32px, 3.6vw, 48px)' }}>
            Recognition feed
          </h1>
          <p className="vsx-meta" style={{ fontSize: 14.5, marginTop: 8 }}>
            What colleagues noticed each other doing.
          </p>
        </div>

        <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
          <SelectPill
            label="Sort"
            options={sortOptions}
            value={sort}
            onChange={v => setSort((v as FeedSort) ?? 'recent')}
          />
          {coreValues.length > 0 && (
            <SelectPill
              label="Value"
              options={valueOptions}
              value={valueId}
              onChange={setValueId}
            />
          )}
        </div>
      </div>

      {/*
        The feed, as one column. `vsx-feed-grid` IS that column now — the
        wrapper that used to hold it beside a rail is gone, and with it the
        redundant nesting.
      */}
      <div className="vsx-feed-grid">
          <FeedComposer
            name={employee?.full_name ?? ''}
            avatarUrl={employee?.avatar_url}
            onStart={goGive}
          />

          {/*
            What the controls are currently doing, in words, and the way
            back. A filtered feed that does not say it is filtered reads as
            an empty company.
          */}
          {activeValue && (
            <div
              className="flex flex-wrap items-center"
              style={{ gap: 10 }}
              aria-live="polite"
            >
              <p className="vsx-meta" style={{ fontSize: 13 }}>
                Showing recognitions for{' '}
                <span
                  style={{ color: valueTone(activeValue.slug || activeValue.name), fontWeight: 600 }}
                >
                  {activeValue.name}
                </span>
              </p>
              <button
                type="button"
                className="vsx-btn vsx-btn-sm"
                onClick={() => setValueId(null)}
              >
                Show all values
              </button>
            </div>
          )}

          {loading ? (
            <>
              <PostSkeleton />
              <PostSkeleton />
              <PostSkeleton />
            </>
          ) : loadError ? (
            <section className="vsx-panel vsx-post" role="alert">
              <h2 className="vsx-panel-title">The feed didn&rsquo;t load</h2>
              <p
                className="vsx-meta"
                style={{ fontSize: 14, marginTop: 10, lineHeight: 1.6, maxWidth: '48ch' }}
              >
                {loadError}
              </p>
              <button
                type="button"
                className="vsx-btn vsx-btn-primary"
                style={{ marginTop: 18, alignSelf: 'flex-start' }}
                onClick={() => { void feed.refetch() }}
                disabled={feed.isFetching}
              >
                {feed.isFetching ? 'Trying…' : 'Try again'}
              </button>
            </section>
          ) : items.length === 0 ? (
            /*
              Two genuinely different empty states. "No recognitions match
              this filter" and "nobody has recognised anybody yet" are not
              the same fact, and offering to write the first recognition to
              somebody who has simply filtered to a quiet value is wrong.
            */
            <section className="vsx-panel vsx-post">
              <h2 className="vsx-panel-title">
                {activeValue ? 'Nothing for this value yet' : 'The feed is empty'}
              </h2>
              <p
                className="vsx-meta"
                style={{ fontSize: 14, marginTop: 10, lineHeight: 1.6, maxWidth: '46ch' }}
              >
                {activeValue
                  ? `No recognition has been recorded against ${activeValue.name} yet. Other values may have some.`
                  : 'Great work happens every day. Be the first to write some of it down.'}
              </p>
              <button
                type="button"
                className={activeValue ? 'vsx-btn' : 'vsx-btn vsx-btn-primary'}
                style={{ marginTop: 18, alignSelf: 'flex-start' }}
                onClick={activeValue ? () => setValueId(null) : goGive}
              >
                {activeValue ? 'Show all values' : 'Recognize someone'}
              </button>
            </section>
          ) : (
            <>
              {items.map(item => (
                <RecognitionPost
                  key={item.id}
                  item={item}
                  viewerId={employee?.id}
                  alreadyAppreciated={appreciatedIds.has(item.id)}
                />
              ))}

              {feed.hasNextPage && (
                <div className="flex justify-center" style={{ padding: '4px 0 8px' }}>
                  <button
                    type="button"
                    className="vsx-btn"
                    onClick={() => { void feed.fetchNextPage() }}
                    disabled={feed.isFetchingNextPage}
                    aria-busy={feed.isFetchingNextPage}
                  >
                    {feed.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
      </div>
    </div>
  )
}
