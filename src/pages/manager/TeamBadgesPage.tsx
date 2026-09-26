import { useMemo, useState } from 'react'
import { Download, Search, Zap } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useTeamBadges } from '@/hooks/queries'
import { errorMessage } from '@/lib/query'
import type { TeamBadges, TeamBadgeMember, TeamBadgeStanding } from '@/lib/api'
import { PageHeader } from '@/components/shared/PageHeader'
import { TableSkeleton } from '@/components/shared/SkeletonLoader'
import { EmptyState } from '@/components/shared/EmptyState'
import { EmployeeAvatar } from '@/components/shared/EmployeeAvatar'
import { CORE_VALUE_COLORS, type CoreValueSlug } from '@/lib/constants'
import { formatDateRange } from '@/lib/date-utils'
import { exportXLSX } from '@/lib/export-utils'

/** Minimal additive badge glyph for table cells. */
function BadgeGlyph({ level, color }: { level: number; color: string }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x={3} y={3} width={18} height={18} />
      {level >= 2 && <rect x={7} y={7} width={10} height={10} />}
      {level >= 3 && <><line x1={12} y1={3} x2={12} y2={21} /><line x1={3} y1={12} x2={21} y2={12} /></>}
      {level >= 4 && <><line x1={3} y1={3} x2={21} y2={21} /><line x1={21} y1={3} x2={3} y2={21} /></>}
      {level >= 5 && <rect x={9} y={9} width={6} height={6} fill={color} />}
    </svg>
  )
}

function toneFor(cv: TeamBadges['core_values'][number]): string {
  return CORE_VALUE_COLORS[cv.slug as CoreValueSlug] ?? cv.accent_color ?? '#c42a20'
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="vs-card" style={{ padding: 14 }}>
      <p className="font-condensed" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </p>
      <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 5 }}>{label}</p>
    </div>
  )
}

/** One person's standing in one value, or a dash when they have none yet. */
function StandingCell({ standing, tone }: { standing: TeamBadgeStanding | undefined; tone: string }) {
  if (!standing || standing.recognition_count === 0) {
    return <span style={{ color: 'var(--color-neutral-500)' }} aria-label="No recognitions yet">—</span>
  }
  const count = standing.recognition_count
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {standing.badge_level !== null ? (
        <div className="flex items-center gap-1.5">
          <BadgeGlyph level={standing.badge_level} color={tone} />
          <span
            className="vs-tag"
            style={{
              fontSize: 11,
              padding: '2px 8px',
              whiteSpace: 'nowrap',
              background: `color-mix(in srgb, ${tone} 12%, var(--color-bg))`,
              color: tone,
              border: `1px solid color-mix(in srgb, ${tone} 30%, transparent)`,
            }}
          >
            {standing.badge_name ?? `Level ${standing.badge_level}`}
          </span>
        </div>
      ) : null}
      <span style={{ fontSize: 11.5, color: 'var(--color-neutral-600)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {count} recognition{count !== 1 ? 's' : ''}
        {standing.next_level_at ? ` · next at ${standing.next_level_at}` : ' · top level'}
      </span>
    </div>
  )
}

/**
 * Manager → Team Badges.
 *
 * Everyone on the projects you manage, with their badge standing in each core
 * value for the current annual period — including the people who have not been
 * recognised yet, so an empty column is a fact about a person rather than a
 * page that might be broken.
 *
 * HR and Super Admin, who manage no projects (029), see the organisation.
 * Either way the database decides the scope from the session (team_badges,
 * 061); nothing on this page names a team.
 */
export default function TeamBadgesPage() {
  const { employee } = useAuth()
  const teamBadges = useTeamBadges(employee?.id)
  const data = teamBadges.data

  const [query, setQuery] = useState('')
  const [projectId, setProjectId] = useState('')
  const [valueId, setValueId] = useState('')
  const [onlyHolders, setOnlyHolders] = useState(false)

  const org = data?.scope === 'organization'

  const projects = useMemo(() => {
    const seen = new Map<string, string>()
    for (const m of data?.members ?? []) for (const p of m.projects) seen.set(p.id, p.name)
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [data])

  const columns = useMemo(
    () => (data?.core_values ?? []).filter(v => !valueId || v.id === valueId),
    [data, valueId],
  )

  const holdsBadge = (m: TeamBadgeMember) =>
    m.badges.some(b => b.badge_level !== null && (!valueId || b.core_value_id === valueId))

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data?.members ?? []).filter(m =>
      (!q || [m.full_name, m.email, m.employee_id, m.designation ?? '', m.department ?? '']
        .some(v => v.toLowerCase().includes(q)))
      && (!projectId || m.projects.some(p => p.id === projectId))
      && (!onlyHolders || m.badges.some(b => b.badge_level !== null && (!valueId || b.core_value_id === valueId))),
    )
  }, [data, query, projectId, onlyHolders, valueId])

  const members = data?.members ?? []
  const holders = members.filter(holdsBadge).length
  const badgesHeld = members.reduce((n, m) => n + m.badges.filter(b => b.badge_level !== null).length, 0)
  const recognitions = members.reduce((n, m) => n + m.badges.reduce((s, b) => s + b.recognition_count, 0), 0)

  /*
    A failed request is not an empty team. Kept distinct so that "your people
    have earned nothing yet" and "we could not ask" never render as the same
    sentence — which is how this page's earlier failures stayed invisible.
  */
  const loadError = teamBadges.isError
    ? errorMessage(teamBadges.error, 'Team badges could not be loaded. Please try again.')
    : null

  const exportRows = () => {
    if (!data) return
    const standing = (m: TeamBadgeMember, id: string) => m.badges.find(b => b.core_value_id === id)
    const matrix = rows.map(m => {
      const row: Record<string, unknown> = {
        'Employee': m.full_name,
        'Employee ID': m.employee_id,
        'Email': m.email,
        'Designation': m.designation ?? '',
        'Department': m.department ?? '',
        'Project': m.projects.map(p => p.name).join(', '),
      }
      for (const cv of data.core_values) {
        const s = standing(m, cv.id)
        row[`${cv.name} — badge`] = s?.badge_name ?? ''
        row[`${cv.name} — recognitions`] = s?.recognition_count ?? 0
      }
      row['Badges held'] = m.badges.filter(b => b.badge_level !== null).length
      return row
    })
    void exportXLSX([
      { name: 'Team Badges', data: matrix },
      { name: 'Badge Levels', data: data.levels.map(l => ({
        'Level': l.level, 'Badge': l.name,
        'Recognitions from': l.minimum_count, 'Recognitions to': l.maximum_count ?? 'and above',
      })) },
    ], `valuespot-team-badges-${data.period.start}`)
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        kicker={data ? `Annual period · ${formatDateRange(data.period.start, data.period.end)}` : 'Annual period'}
        title="Team Badges"
        subtitle={org
          ? 'Current badge standing for every active employee, by core value.'
          : 'Current badge standing for everyone on the projects you manage, by core value.'}
      />

      {teamBadges.isLoading ? (
        <TableSkeleton />
      ) : loadError ? (
        <EmptyState
          icon={<Zap size={36} />}
          title="Couldn't load team badges"
          description={loadError}
          action={{ label: 'Try again', onClick: () => { void teamBadges.refetch() } }}
        />
      ) : members.length === 0 ? (
        <EmptyState
          icon={<Zap size={36} />}
          title={org ? 'No active employees' : 'No one is on your projects yet'}
          description={org
            ? 'Badges appear here once employees are recognised.'
            : 'HR assigns people to projects. Once someone is on a project you manage, they and their badges appear here.'}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Metric label={org ? 'Active employees' : 'Team members'} value={members.length} />
            <Metric label={valueId ? 'Hold a badge in this value' : 'Hold at least one badge'} value={holders} />
            <Metric label="Badges held" value={badgesHeld} />
            <Metric label="Approved recognitions this period" value={recognitions} />
          </div>

          <div className="vs-card" style={{ padding: '12px 14px' }}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="relative" style={{ flex: '1 1 220px', minWidth: 0 }}>
                <Search size={15} aria-hidden="true"
                  style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-neutral-500)' }} />
                <input
                  type="search"
                  className="vs-input w-full"
                  style={{ height: 32, fontSize: 13, paddingLeft: 32 }}
                  placeholder="Search name, email, ID…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  aria-label="Search people"
                />
              </div>
              {projects.length > 1 && (
                <select className="vs-input" style={{ height: 32, fontSize: 13, width: 'auto', flex: '0 1 200px', minWidth: 150 }} aria-label="Project"
                  value={projectId} onChange={e => setProjectId(e.target.value)}>
                  <option value="">{org ? 'All projects' : 'All my projects'}</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              <select className="vs-input" style={{ height: 32, fontSize: 13, width: 'auto', flex: '0 1 200px', minWidth: 150 }} aria-label="Core value"
                value={valueId} onChange={e => setValueId(e.target.value)}>
                <option value="">All core values</option>
                {(data?.core_values ?? []).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <label className="flex items-center gap-2" style={{ fontSize: 13, color: 'var(--color-neutral-700)', height: 32, cursor: 'pointer' }}>
                <input type="checkbox" checked={onlyHolders} onChange={e => setOnlyHolders(e.target.checked)} />
                Only badge holders
              </label>
              <button className="vs-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, height: 32 }}
                onClick={exportRows} disabled={rows.length === 0}>
                <Download size={13} aria-hidden="true" /> Export XLSX
              </button>
            </div>
          </div>

          {holders === 0 && !valueId && (
            <p style={{ fontSize: 13, color: 'var(--color-neutral-600)', lineHeight: 1.55 }}>
              Nobody here holds a badge yet this period. Badges are earned from approved recognitions —
              the first arrives with a person's first approved recognition in a core value.
            </p>
          )}

          {rows.length === 0 ? (
            <EmptyState
              icon={<Zap size={36} />}
              title="No one matches"
              description="Try a different search, project or core value."
            />
          ) : (
            <div className="vs-card" style={{ overflow: 'hidden' }}>
              <div className="overflow-x-auto">
                <table className="vs-table w-full" style={{ minWidth: 360 + columns.length * 150 }}>
                  <thead>
                    <tr style={{ background: 'color-mix(in srgb, var(--color-neutral-300) 30%, transparent)' }}>
                      <th>Employee</th>
                      <th>Project</th>
                      {columns.map(cv => (
                        <th key={cv.id} style={{ whiteSpace: 'nowrap' }}>
                          <span className="flex items-center gap-1.5">
                            <span aria-hidden="true" style={{ width: 8, height: 8, background: toneFor(cv), display: 'inline-block' }} />
                            {cv.name}
                          </span>
                        </th>
                      ))}
                      <th style={{ textAlign: 'right' }}>Badges</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(m => (
                      <tr key={m.id}>
                        <td>
                          <EmployeeAvatar
                            name={m.full_name}
                            avatarUrl={m.avatar_url}
                            size="sm"
                            showName
                            subtitle={m.designation ? `${m.designation} · ${m.employee_id}` : m.employee_id}
                          />
                        </td>
                        <td style={{ color: 'var(--color-neutral-700)', fontSize: 12.5 }}>
                          {m.projects.map(p => p.name).join(', ') || '—'}
                        </td>
                        {columns.map(cv => (
                          <td key={cv.id}>
                            <StandingCell standing={m.badges.find(b => b.core_value_id === cv.id)} tone={toneFor(cv)} />
                          </td>
                        ))}
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-700)' }}>
                          {m.badges.filter(b => b.badge_level !== null).length}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data && data.levels.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', lineHeight: 1.6 }}>
              Levels this period:{' '}
              {data.levels.map(l =>
                `${l.name} ${l.minimum_count}${l.maximum_count ? `–${l.maximum_count}` : '+'}`,
              ).join(' · ')}{' '}
              approved recognitions in a core value.
            </p>
          )}
        </>
      )}
    </div>
  )
}
