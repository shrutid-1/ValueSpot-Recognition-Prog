import { useState, useEffect, useCallback } from 'react'
import { Search, UserX } from 'lucide-react'
import { employeesApi } from '@/lib/api'
import { errorMessage } from '@/lib/query'
import type { Employee, UserRole } from '@/types'

import { EmployeeAvatar } from '@/components/shared/EmployeeAvatar'
import { SkeletonLoader } from '@/components/shared/SkeletonLoader'
import { SEARCH_DEBOUNCE_MS } from '@/lib/constants'
import { cn } from '@/lib/utils'

interface Step1EmployeeProps {
  selected: Employee | null
  onSelect: (employee: Employee) => void
  currentUserId?: string
  /**
   * The signed-in person's role, for WORDING ONLY.
   *
   * An Employee may only recognise other Employees, so the step should say so
   * rather than implying anyone in the organisation can be nominated. It does
   * not decide which candidates come back — recognition_candidates() (041)
   * does that from the caller's role as the database reads it, so passing a
   * different role here changes the copy and nothing else.
   */
  nominatorRole?: UserRole
}

export function Step1Employee({
  selected, onSelect, currentUserId, nominatorRole,
}: Step1EmployeeProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Employee[]>([])
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const employeesOnly = nominatorRole === 'employee'

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([])
      return
    }
    setLoading(true)
    setSearchError(null)

    try {
      /*
        One argument: the term. Who is eligible is settled in the database —
        this box cannot ask for a Manager, an HR admin or a Super Admin, and
        cannot ask for the caller themselves, because there is no parameter
        that would say so.
      */
      setResults(await employeesApi.search(q))
    } catch (err) {
      /*
        The API layer's message, not a fixed string. It matters here because
        the search now calls a database function: if migration 041 has not been
        applied, the useful answer is "ask IT to apply the latest database
        migrations", and "Search failed. Please try again." would send someone
        retyping a name forever.
      */
      setSearchError(errorMessage(err, 'Search failed. Please try again.'))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => { search(query) }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, search])

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">
          {employeesOnly ? 'Select an employee to recognize' : 'Who do you want to recognize?'}
        </h2>
        <p className="text-sm text-text-muted mt-1">
          {employeesOnly
            ? 'Search your colleagues by name, employee ID, or email. You can recognize other employees.'
            : 'Search by name, employee ID, or email.'}
        </p>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
        <input
          type="search"
          className="w-full pl-9 pr-4 h-10 rounded-lg border border-border bg-surface text-sm placeholder:text-text-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:border-blue-500"
          placeholder="Search employees..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
          aria-label="Search for an employee to recognize"
          aria-expanded={results.length > 0}
          aria-autocomplete="list"
          aria-controls="employee-search-results"
        />
      </div>

      {/*
        Empty result. For an Employee this is also what a Manager, an HR admin
        or a Super Admin looks like — they are not eligible, so they are not
        returned — and saying so is better than leaving someone retyping a name
        that is spelled correctly.
      */}
      {query.length >= 2 && results.length === 0 && !loading && !searchError && (
        <div className="text-sm text-text-muted text-center py-4">
          No employees found matching "{query}"
          {employeesOnly && (
            <span className="block mt-1 text-xs">
              You can recognize employees — not managers, HR or administrators.
            </span>
          )}
        </div>
      )}

      {loading && <SkeletonLoader rows={3} />}

      {searchError && (
        <p className="text-sm text-danger" role="alert">{searchError}</p>
      )}

      {/* Results */}
      {results.length > 0 && (
        <ul
          id="employee-search-results"
          className="space-y-1"
          role="listbox"
          aria-label="Employee search results"
        >
          {results.map(emp => {
            const isSelf = emp.id === currentUserId
            return (
              <li key={emp.id} role="option" aria-selected={selected?.id === emp.id} aria-disabled={isSelf}>
                <button
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                    isSelf
                      ? 'opacity-40 cursor-not-allowed bg-surface-secondary'
                      : selected?.id === emp.id
                        ? 'bg-blue-50 border border-blue-200'
                        : 'hover:bg-surface-secondary'
                  )}
                  onClick={() => { if (!isSelf) onSelect(emp) }}
                  disabled={isSelf}
                  aria-label={isSelf ? `${emp.full_name} — you cannot recognize yourself` : `Recognize ${emp.full_name}`}
                >
                  <EmployeeAvatar name={emp.full_name} avatarUrl={emp.avatar_url} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{emp.full_name}</p>
                    <p className="text-xs text-text-muted truncate">{emp.email}</p>
                  </div>
                  {isSelf && (
                    <span className="flex items-center gap-1 text-xs text-text-disabled">
                      <UserX size={12} aria-hidden="true" />
                      That's you
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {query.length < 2 && (
        <p className="text-xs text-text-muted text-center">Type at least 2 characters to search</p>
      )}
    </div>
  )
}
