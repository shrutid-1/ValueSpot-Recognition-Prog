import { RefreshCw } from 'lucide-react'
import type { BadgeSummary, RecognitionFeedItem } from '@/types'
import { SelectPill } from './SelectPill'
import type { SelectOption } from './SelectPill'
import { valueTone } from '@/lib/value-tone'
import { currentAnnualPeriod, formatIST, timeAgo } from '@/lib/date-utils'

export type RecordView = 'all' | 'received' | 'given'

interface DashboardHeaderProps {
  fullName: string
  /** The most recent recognition this person RECEIVED, if there is one. */
  latestReceived: RecognitionFeedItem | null
  badges: BadgeSummary[]
  view: RecordView
  onViewChange: (view: RecordView) => void
  activeValueId: string | null
  onValueChange: (coreValueId: string | null) => void
  onRefresh: () => void
  refreshing: boolean
}

/**
 * The page head: the name at poster size, and the filters.
 *
 * The reference this design follows opens with a large condensed title and a
 * row of filter pills. The title here is the employee's own name, because
 * the page is about them — and the band beneath it carries the most recent
 * thing a colleague actually wrote, which is the one piece of content in
 * this product that nothing else can substitute for.
 *
 * On the pills: all three DO something, and the third is not a control at
 * all. View and Value are real filters over rows already on the page. The
 * period is a statement of fact — which annual window the counts and badges
 * on this screen are scoped to, stated nowhere else in the portal — so it is
 * drawn without a chevron and without a hover state, because it must not
 * look pressable.
 */
export function DashboardHeader({
  fullName,
  latestReceived,
  badges,
  view,
  onViewChange,
  activeValueId,
  onValueChange,
  onRefresh,
  refreshing,
}: DashboardHeaderProps) {
  const { start, end } = currentAnnualPeriod()

  const viewOptions: SelectOption[] = [
    { value: 'all', label: 'Everything' },
    { value: 'received', label: 'Received' },
    { value: 'given', label: 'Given' },
  ]

  /*
    Only values with something recorded against them are offered. A filter
    that can only ever return nothing is not a filter.
  */
  const valueOptions: SelectOption[] = [
    { value: null, label: 'All values' },
    ...badges
      .filter(b => b.recognition_count > 0)
      .sort((a, b) => b.recognition_count - a.recognition_count)
      .map(b => ({
        value: b.core_value_id,
        label: b.core_value_name,
        tone: valueTone(b.core_value_slug || b.core_value_name),
      })),
  ]

  return (
    <div
      className="vsx-page-head vsx-settle flex flex-wrap items-start"
      style={{ gap: '22px 28px', marginBottom: 'clamp(20px, 2.6vw, 30px)' }}
    >
      <div style={{ flex: '1 1 340px', minWidth: 0 }}>
        <h1 className="vsx-title" style={{ fontSize: 'clamp(42px, 6.4vw, 78px)' }}>
          {fullName || 'Your record'}
        </h1>

        {latestReceived ? (
          <figure style={{ margin: '18px 0 0', maxWidth: '62ch' }}>
            <blockquote
              style={{
                fontSize: 'clamp(16px, 1.5vw, 18px)',
                lineHeight: 1.55,
                color: 'var(--vsx-text)',
                margin: 0,
              }}
            >
              {latestReceived.what_happened}
            </blockquote>
            <figcaption className="vsx-meta" style={{ marginTop: 9, fontSize: 13 }}>
              {latestReceived.nominator_name} recognised you for{' '}
              <span
                style={{
                  color: valueTone(latestReceived.core_value_name),
                  fontWeight: 600,
                }}
              >
                {latestReceived.core_value_name}
              </span>
              {latestReceived.approved_at ? `, ${timeAgo(latestReceived.approved_at)}` : ''}
            </figcaption>
          </figure>
        ) : (
          <p
            className="vsx-meta"
            style={{ fontSize: 15, lineHeight: 1.6, maxWidth: '52ch', marginTop: 16 }}
          >
            Recognition here starts with noticing. When a colleague writes
            something about your work, it opens this page.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
        <SelectPill
          label="View"
          options={viewOptions}
          value={view}
          onChange={v => onViewChange((v as RecordView) ?? 'all')}
        />

        {valueOptions.length > 1 && (
          <SelectPill
            label="Value"
            options={valueOptions}
            value={activeValueId}
            onChange={onValueChange}
          />
        )}

        <span className="vsx-stat-pill" title="The period these counts and badges cover">
          {formatIST(start, 'MMM yyyy')} &ndash; {formatIST(end, 'MMM yyyy')}
        </span>

        <button
          type="button"
          className="vsx-round"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label={refreshing ? 'Refreshing your dashboard' : 'Refresh your dashboard'}
        >
          <RefreshCw
            size={18}
            aria-hidden="true"
            strokeWidth={2}
            className={refreshing ? 'vsx-spin' : undefined}
          />
        </button>
      </div>
    </div>
  )
}
