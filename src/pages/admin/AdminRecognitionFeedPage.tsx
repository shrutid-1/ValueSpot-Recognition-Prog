import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Filter } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useCoreValues, useRecognitionFeed } from '@/hooks/queries'
import type { FeedSort } from '@/lib/api'
import { errorMessage } from '@/lib/query'
import { ROUTES } from '@/lib/constants'
import { RecognitionPost } from '@/components/experience/RecognitionPost'
import { SelectPill, type SelectOption } from '@/components/experience/SelectPill'
import { AdminAvatar, Panel, Empty } from '@/components/admin/AdminUI'
import { adminValueTone } from '@/lib/admin-value-tone'

/**
 * The recognition feed, for Manager, HR Admin and Super Admin.
 *
 * SAME FEED. Same query, same page size, same sorting and filtering, same
 * post — appreciate, comment, send Value Coins, moderate — and the same
 * paging. The Employee portal's feed is untouched and remains the dark,
 * poster-set experience it was built as.
 *
 * What differs is only the system it is dressed in. RecognitionPost and its
 * controls are written against the --vsx-* tokens; admin-theme.css re-points
 * those inside this portal, so a post here is a white card with accent-red
 * emphasis without a second copy of the component existing. One behaviour,
 * two appearances — which is the only arrangement where a fix to the feed
 * cannot land in one portal and miss the other.
 *
 * Nothing on this page is privileged. Whether the moderation menu appears,
 * whether coins may be sent, what the feed contains at all — each is decided
 * by the database from the caller's own session, exactly as it is for an
 * employee.
 */

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
      <div className="ad-skeleton" style={{ height: 34, width: 130, marginTop: 22, borderRadius: 999 }} />
    </div>
  )
}

export default function AdminRecognitionFeedPage() {
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
      tone: adminValueTone(v.slug || v.name),
    })),
  ]

  const goGive = () => navigate(ROUTES.GIVE_RECOGNITION)

  return (
    <div className="ad-page">

      {/* ── Head ─────────────────────────────────────────────── */}
      <div className="ad-page-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="ad-title">Recognition Feed</h1>
          <p className="ad-sub">What colleagues noticed each other doing, across the organisation.</p>
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

      {/* ── The column ───────────────────────────────────────── */}
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
        {/*
          The way in.

          A field-shaped button, not a text input: a recognition needs a
          colleague, a Core Value, a behaviour, a scenario, an account of what
          happened and its impact, and it goes to an approver. A caret and a
          Post button would promise something the product does not do, and
          would throw away whatever was typed into it.
        */}
        <section className="ad-card" style={{ padding: 14 }} aria-label="Recognize a colleague">
          <div className="flex items-center" style={{ gap: 12 }}>
            <AdminAvatar name={employee?.full_name ?? '?'} avatarUrl={employee?.avatar_url} />
            <button
              type="button"
              onClick={goGive}
              style={{
                flex: 1,
                minWidth: 0,
                height: 44,
                padding: '0 18px',
                border: 0,
                borderRadius: 'var(--ad-r-pill)',
                background: 'var(--ad-inset)',
                color: 'var(--ad-text-3)',
                fontFamily: 'var(--ad-sans)',
                fontSize: 14,
                textAlign: 'left',
                cursor: 'pointer',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              Share what a colleague did well&hellip;
            </button>
            <button
              type="button"
              className="ad-btn ad-btn-primary"
              onClick={goGive}
              aria-label="Recognize someone"
              style={{ flexShrink: 0 }}
            >
              <Plus size={16} aria-hidden="true" strokeWidth={2.4} />
              <span className="ad-hide-xs">Recognize someone</span>
            </button>
          </div>
        </section>

        {/*
          What the controls are currently doing, in words, and the way back.
          A filtered feed that does not say it is filtered reads as an empty
          organisation.
        */}
        {activeValue && (
          <div
            className="ad-card flex flex-wrap items-center"
            style={{ flexDirection: 'row', gap: 10, padding: '12px 16px' }}
            aria-live="polite"
          >
            <Filter size={15} aria-hidden="true" style={{ color: 'var(--ad-text-3)', flexShrink: 0 }} />
            <p style={{ fontSize: 13, color: 'var(--ad-text-2)', flex: 1, minWidth: 0 }}>
              Showing recognitions for{' '}
              <span style={{ color: adminValueTone(activeValue.slug || activeValue.name), fontWeight: 600 }}>
                {activeValue.name}
              </span>
            </p>
            <button type="button" className="ad-btn ad-btn-sm" onClick={() => setValueId(null)}>
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
          <Panel title="The feed didn&rsquo;t load">
            <div role="alert">
              <p style={{ fontSize: 14, color: 'var(--ad-text-2)', lineHeight: 1.6, maxWidth: '48ch' }}>
                {loadError}
              </p>
              <button
                type="button"
                className="ad-btn ad-btn-primary"
                style={{ marginTop: 16 }}
                onClick={() => { void feed.refetch() }}
                disabled={feed.isFetching}
              >
                {feed.isFetching ? 'Trying…' : 'Try again'}
              </button>
            </div>
          </Panel>
        ) : items.length === 0 ? (
          /*
            Two genuinely different empty states. "No recognitions match this
            filter" and "nobody has recognised anybody yet" are not the same
            fact, and offering to write the first recognition to somebody who
            has simply filtered to a quiet value is wrong.
          */
          <Panel style={{ padding: 28 }} label="The feed is empty">
            <Empty
              title={activeValue ? 'Nothing for this value yet' : 'The feed is empty'}
              text={activeValue
                ? `No recognition has been recorded against ${activeValue.name} yet. Other values may have some.`
                : 'Great work happens every day. Be the first to write some of it down.'}
            />
            <div className="flex justify-center" style={{ marginTop: 6 }}>
              <button
                type="button"
                className={activeValue ? 'ad-btn' : 'ad-btn ad-btn-primary'}
                onClick={activeValue ? () => setValueId(null) : goGive}
              >
                {activeValue ? 'Show all values' : 'Recognize someone'}
              </button>
            </div>
          </Panel>
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
              <div className="flex justify-center" style={{ padding: '2px 0 8px' }}>
                <button
                  type="button"
                  className="ad-btn"
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
