import { useMemo, useState } from 'react'
import { Download, FolderKanban, Search, Users } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useManagedProjects } from '@/hooks/queries'
import { errorMessage } from '@/lib/query'
import type { ManagedProject, ManagedProjectMember } from '@/lib/api'
import { PageHeader } from '@/components/shared/PageHeader'
import { CardSkeleton } from '@/components/shared/SkeletonLoader'
import { EmptyState } from '@/components/shared/EmptyState'
import { EmployeeAvatar } from '@/components/shared/EmployeeAvatar'
import { roleLabel } from '@/lib/portals'
import { formatIST } from '@/lib/date-utils'
import { exportXLSX } from '@/lib/export-utils'

type View = 'projects' | 'people'

/** One person on one project — the unit both views and the export are built from. */
interface RosterRow {
  project: ManagedProject
  member: ManagedProjectMember
}

function matches(row: RosterRow, q: string): boolean {
  if (!q) return true
  const m = row.member
  return [
    m.full_name, m.email, m.employee_code ?? '', m.designation ?? '',
    m.department ?? '', m.location ?? '', row.project.name, row.project.project_code ?? '',
  ].some(v => v.toLowerCase().includes(q))
}

function sinceLabel(date: string | null | undefined): string {
  return date ? formatIST(date) : '—'
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

/**
 * The roster table. `showProject` adds the Project column for the combined
 * view; inside a project card it would repeat the card's own title.
 */
function RosterTable({ rows, showProject }: { rows: RosterRow[]; showProject: boolean }) {
  /* Fixed column widths, so every project card's columns line up with the next. */
  const widths = showProject
    ? ['18%', '11%', '9%', '18%', '13%', '11%', '9%', '11%']
    : ['21%', '10%', '20%', '15%', '12%', '10%', '12%']
  return (
    <div className="overflow-x-auto">
      <table className="vs-table w-full" style={{ minWidth: showProject ? 980 : 860, tableLayout: 'fixed' }}>
        <colgroup>{widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <thead>
          <tr style={{ background: 'color-mix(in srgb, var(--color-neutral-300) 30%, transparent)' }}>
            <th>Name</th>
            {showProject && <th>Project</th>}
            <th style={{ whiteSpace: 'nowrap' }}>Employee ID</th>
            <th>Email</th>
            <th>Designation</th>
            <th>Department</th>
            <th>Access</th>
            <th style={{ whiteSpace: 'nowrap' }}>On project since</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ project, member: m }) => (
            <tr key={`${project.id}-${m.id}`}>
              <td>
                <EmployeeAvatar
                  name={m.full_name}
                  avatarUrl={m.avatar_url}
                  size="sm"
                  showName
                  subtitle={m.location ?? undefined}
                />
              </td>
              {showProject && (
                <td style={{ color: 'var(--color-text)', fontWeight: 500, whiteSpace: 'nowrap' }}>{project.name}</td>
              )}
              <td style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, color: 'var(--color-neutral-700)', whiteSpace: 'nowrap' }}>
                {m.employee_code ?? '—'}
              </td>
              <td style={{ fontSize: 12.5 }}>
                {/* The address distinguishes two people with the same name, and is how a manager reaches them. */}
                <a href={`mailto:${m.email}`} style={{ color: 'var(--color-text)', textDecoration: 'underline', textUnderlineOffset: 2, wordBreak: 'break-all' }}>
                  {m.email}
                </a>
              </td>
              <td style={{ color: 'var(--color-neutral-700)', fontSize: 12.5 }}>{m.designation || '—'}</td>
              <td style={{ color: 'var(--color-neutral-700)', fontSize: 12.5 }}>{m.department || '—'}</td>
              <td>
                <span className="vs-tag vs-tag-neutral" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{roleLabel(m.role)}</span>
              </td>
              <td style={{ color: 'var(--color-neutral-700)', fontSize: 12.5, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {sinceLabel(m.project_joined_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * One project and its people.
 *
 * The manager's own name is taken from the session rather than returned by the
 * query: every project on this page is by definition theirs, so asking the
 * database to repeat it once per card would be a column of the same value.
 */
function ProjectCard({ project, managerName, rows, filtered }: {
  project: ManagedProject
  managerName: string
  rows: RosterRow[]
  filtered: boolean
}) {
  return (
    <section
      className="vs-card"
      style={{ overflow: 'hidden' }}
      aria-labelledby={`project-${project.id}-name`}
    >
      <header style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-divider)' }}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div style={{ minWidth: 0 }}>
            <h2
              id={`project-${project.id}-name`}
              className="font-condensed"
              style={{ fontSize: 17, fontWeight: 600, color: 'var(--color-text)' }}
            >
              {project.name}
            </h2>
            {project.description && (
              <p style={{ fontSize: 12.5, color: 'var(--color-neutral-600)', marginTop: 3, lineHeight: 1.5 }}>
                {project.description}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
            {project.project_code && (
              <code
                style={{
                  fontSize: 11, fontFamily: 'IBM Plex Mono, monospace',
                  color: 'var(--color-neutral-600)',
                  background: 'color-mix(in srgb, var(--color-neutral-300) 30%, transparent)',
                  padding: '2px 6px',
                }}
              >
                {project.project_code}
              </code>
            )}
            <span className="vs-tag vs-tag-accent">Active</span>
          </div>
        </div>

        <dl
          className="flex items-center gap-4 flex-wrap"
          style={{ marginTop: 10, fontSize: 12, color: 'var(--color-neutral-700)' }}
        >
          <div className="flex items-center gap-1.5">
            <dt style={{ color: 'var(--color-neutral-600)' }}>Project Manager:</dt>
            <dd style={{ fontWeight: 500 }}>{managerName}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt style={{ color: 'var(--color-neutral-600)' }}>Team Members:</dt>
            <dd style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
              {filtered ? `${rows.length} of ${project.member_count}` : project.member_count}
            </dd>
          </div>
        </dl>
      </header>

      {project.members.length === 0 ? (
        <p style={{ padding: '18px 16px', fontSize: 13, color: 'var(--color-neutral-600)' }}>
          No team members are currently assigned to this project. HR can add
          people to it from the Employees screen.
        </p>
      ) : rows.length === 0 ? (
        <p style={{ padding: '18px 16px', fontSize: 13, color: 'var(--color-neutral-600)' }}>
          No one on this project matches your search.
        </p>
      ) : (
        <RosterTable rows={rows} showProject={false} />
      )}
    </section>
  )
}

/**
 * Manager → My Projects.
 *
 * Every project this manager runs and a full roster for each — name, employee
 * ID, email, designation, department, access level and the date each person
 * joined the project — viewable per project or as one list with the project
 * alongside each person, and exportable.
 *
 * READ-ONLY on purpose. A manager may see who is on their projects; adding,
 * removing and reassigning stay with HR and Super Admin, where they already
 * are. Nothing on this page writes.
 */
export default function ManagedProjectsPage() {
  const { employee } = useAuth()
  const managedProjects = useManagedProjects()

  const [view, setView] = useState<View>('projects')
  const [query, setQuery] = useState('')
  const [projectId, setProjectId] = useState('')

  const projects = useMemo(() => managedProjects.data ?? [], [managedProjects.data])

  const allRows = useMemo<RosterRow[]>(
    () => projects.flatMap(project => project.members.map(member => ({ project, member }))),
    [projects],
  )

  const q = query.trim().toLowerCase()
  const visibleRows = useMemo(
    () => allRows.filter(r => (!projectId || r.project.id === projectId) && matches(r, q)),
    [allRows, projectId, q],
  )

  const people = new Set(allRows.map(r => r.member.id)).size
  const departments = new Set(allRows.map(r => r.member.department).filter(Boolean)).size

  // isLoading, not isPending — consistent with the other manager screens.
  const loading = managedProjects.isLoading

  /*
    A failed request is not an empty portfolio. Kept distinct so that "you
    manage nothing" and "we could not ask" never render as the same sentence —
    the confusion that hid the Team Badges bug until migration 039.
  */
  const loadError = managedProjects.isError
    ? errorMessage(managedProjects.error, 'Unable to load your projects. Please try again.')
    : null

  const exportRoster = () => {
    const toRow = ({ project, member: m }: RosterRow) => ({
      'Project': project.name,
      'Project code': project.project_code ?? '',
      'Name': m.full_name,
      'Employee ID': m.employee_code ?? '',
      'Email': m.email,
      'Designation': m.designation ?? '',
      'Department': m.department ?? '',
      'Location': m.location ?? '',
      'Access': roleLabel(m.role),
      'On project since': m.project_joined_at ?? '',
    })
    void exportXLSX([
      { name: 'All members', data: allRows.map(toRow) },
      // One sheet per project, named after it; Excel caps names at 31 characters.
      ...projects.map(p => ({
        name: p.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Project',
        data: allRows.filter(r => r.project.id === p.id).map(toRow),
      })),
    ], 'valuespot-my-projects')
  }

  const filtered = Boolean(q || projectId)

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        kicker="Your Team"
        title="My Projects"
        subtitle="The projects you manage, and everyone working on each one."
      />

      {loading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => <CardSkeleton key={i} />)}
        </div>
      ) : loadError ? (
        <EmptyState
          icon={<FolderKanban size={36} />}
          title="Couldn't load your projects"
          description={loadError}
          action={{ label: 'Try again', onClick: () => { void managedProjects.refetch() } }}
        />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<Users size={36} />}
          title="No projects are currently assigned to you"
          description="HR assigns Project Managers. Once a project names you, it and its team will appear here."
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Metric label={projects.length === 1 ? 'Project' : 'Projects'} value={projects.length} />
            <Metric label="Team members" value={people} />
            <Metric label={departments === 1 ? 'Department' : 'Departments'} value={departments} />
          </div>

          <div className="vs-card" style={{ padding: '12px 14px' }}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="vs-seg" style={{ width: 'fit-content' }} role="tablist" aria-label="View">
                {([['projects', 'By project'], ['people', 'All members']] as Array<[View, string]>).map(([v, label]) => (
                  <button
                    key={v}
                    role="tab"
                    aria-selected={view === v}
                    onClick={() => setView(v)}
                    style={{
                      padding: '6px 14px', fontSize: 13, height: 32,
                      fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap',
                      border: 'none', borderRight: '1px solid var(--color-divider)',
                      background: view === v ? 'var(--color-accent)' : 'transparent',
                      color: view === v ? 'var(--color-bg)' : 'var(--color-neutral-600)',
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="relative" style={{ flex: '1 1 220px', minWidth: 0 }}>
                <Search size={15} aria-hidden="true"
                  style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-neutral-500)' }} />
                <input
                  type="search"
                  className="vs-input w-full"
                  style={{ height: 32, fontSize: 13, paddingLeft: 32 }}
                  placeholder="Search name, email, ID, designation, department…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  aria-label="Search team members"
                />
              </div>

              {projects.length > 1 && (
                <select className="vs-input" style={{ height: 32, fontSize: 13, width: 'auto', flex: '0 1 220px', minWidth: 160 }} aria-label="Project"
                  value={projectId} onChange={e => setProjectId(e.target.value)}>
                  <option value="">All my projects</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}

              <button className="vs-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, height: 32 }}
                onClick={exportRoster} disabled={allRows.length === 0}>
                <Download size={13} aria-hidden="true" /> Export XLSX
              </button>
            </div>
          </div>

          {view === 'projects' ? (
            <div className="space-y-4">
              {projects
                .filter(p => !projectId || p.id === projectId)
                .map(p => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    managerName={employee?.full_name ?? 'You'}
                    rows={visibleRows.filter(r => r.project.id === p.id)}
                    filtered={filtered}
                  />
                ))}
            </div>
          ) : visibleRows.length === 0 ? (
            <EmptyState
              icon={<Users size={36} />}
              title={allRows.length === 0 ? 'No one is on your projects yet' : 'No one matches'}
              description={allRows.length === 0
                ? 'HR can add people to your projects from the Employees screen.'
                : 'Try a different search or project.'}
            />
          ) : (
            <section className="vs-card" style={{ overflow: 'hidden' }} aria-label="All team members">
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-divider)' }}>
                <p style={{ fontSize: 12.5, color: 'var(--color-neutral-600)' }}>
                  {visibleRows.length} {visibleRows.length === 1 ? 'person' : 'people'}
                  {filtered ? ` of ${allRows.length}` : ''} across {projectId ? 'this project' : `${projects.length} project${projects.length === 1 ? '' : 's'}`}.
                  Each person is active on one project at a time.
                </p>
              </div>
              <RosterTable
                rows={[...visibleRows].sort((a, b) =>
                  a.project.name.localeCompare(b.project.name) || a.member.full_name.localeCompare(b.member.full_name))}
                showProject
              />
            </section>
          )}
        </>
      )}
    </div>
  )
}
