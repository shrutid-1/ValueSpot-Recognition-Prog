import { useMemo, useState } from 'react'
import { ShieldCheck, Plus, X, Search, AlertTriangle } from 'lucide-react'
import { ApiError, type RoleHolder, type PromotionCandidate } from '@/lib/api'
import { useRoleHolders, usePromotionCandidates, useSetPrivilegedRole } from '@/hooks/queries'
import { errorMessage } from '@/lib/query'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/shared/SkeletonLoader'
import { ConfirmModal } from '@/components/shared/ConfirmModal'
import { EmployeeAvatar } from '@/components/shared/EmployeeAvatar'

/**
 * Who holds a privileged role, and the workflow to grant or revoke it.
 *
 * One component serves both Super Admins and HR Admins: the two screens differ
 * only in which role they list, what revoking demotes someone to, and whether
 * the last holder is protected. Splitting them into two components would mean
 * two copies of the same confirmation and error handling to keep in step.
 *
 * Nothing here is the security boundary. Every button calls set_employee_role(),
 * which re-reads the caller's own role from the database and refuses anyone who
 * is not a Super Admin. This component only decides what to offer.
 */

type PrivilegedRole = 'super_admin' | 'hr_admin'

// Both of these were local restatements of shapes the API already names.
// Aliasing rather than redeclaring removes the casts and keeps them in step.
type Holder = RoleHolder
type Candidate = PromotionCandidate

const ROLE_NAMES: Record<string, string> = {
  employee: 'Employee',
  manager: 'Manager',
  hr_admin: 'HR Admin',
  super_admin: 'Super Admin',
}

interface RoleHoldersCardProps {
  /** The role being granted and revoked on this card. */
  role: PrivilegedRole
  title: string
  intro: string
  addLabel: string
  /** What revoking leaves the person as. */
  demoteTo: 'hr_admin' | 'employee'
  /** Refuse to remove the last holder who can actually sign in. */
  protectLast?: boolean
}

export function RoleHoldersCard({
  role: targetRole,
  title,
  intro,
  addLabel,
  demoteTo,
  protectLast = false,
}: RoleHoldersCardProps) {
  const { employee, refreshEmployee } = useAuth()
  const roleName = ROLE_NAMES[targetRole]
  const demotedName = ROLE_NAMES[demoteTo]

  // Server state lives in the cache; only the error from a MUTATION is local,
  // because a failed role change is about this card's action, not the data.
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState('')

  // Fetched only once the picker is open — two candidate lists loading on every
  // visit to Administration would be two requests nobody asked for.
  const candidatesQuery = usePromotionCandidates(targetRole, picking)
  // Memoised so the `?? []` fallback does not produce a new array identity on
  // every render, which would defeat the filtering useMemo below.
  const candidates = useMemo<Candidate[]>(
    () => candidatesQuery.data ?? [],
    [candidatesQuery.data],
  )
  const candidatesLoading = candidatesQuery.isFetching

  const [toPromote, setToPromote] = useState<Candidate | null>(null)
  const [toRemove, setToRemove] = useState<Holder | null>(null)

  const setRoleMutation = useSetPrivilegedRole()
  const working = setRoleMutation.isPending

  /*
    Shared cache, so the two instances of this card on the Administration page
    each fetch their own list once and a role change refreshes BOTH — the
    previous implementation reloaded only the card that acted, leaving the
    other showing a person it should no longer offer.
  */
  const holdersQuery = useRoleHolders(targetRole)
  const holders = (holdersQuery.data ?? []) as Holder[]
  const loading = holdersQuery.isPending

  const loadError = holdersQuery.error
    ? errorMessage(holdersQuery.error, `Could not load the ${roleName} list.`)
    : null

  const openPicker = () => {
    setPicking(true)
    setNotice(null)
    setError(null)
    setSearch('')

  }

  // Filtered in memory: the list is small, and it avoids interpolating user
  // input into a PostgREST filter expression.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter(
      c => c.full_name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
    )
  }, [candidates, search])

  const applyRole = async (
    employeeId: string,
    newRole: PrivilegedRole | 'employee',
    successMessage: string,
  ) => {
    setError(null)

    try {
      await setRoleMutation.mutateAsync({ employeeId, role: newRole })
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'last_admin'
          ? `This is the only ${roleName}. Add another one first — the system will not ` +
            'let itself be left with nobody in charge.'
          : errorMessage(err, 'Something went wrong. Please try again.'),
      )
      return false
    }

    setNotice(successMessage)
    // The mutation invalidated both cards' listings and their candidate
    // pickers; no manual reload needed.

    // If you changed your OWN access, the sidebar and menus must follow. This
    // is AuthContext's business, not the cache's — the JWT claim only moves on
    // token reissue, so the profile has to be re-read explicitly.
    await refreshEmployee()
    return true
  }

  // Only a holder who is active AND has registered can actually do anything.
  // A row nobody signed up against looks like cover but is not.
  const usable = holders.filter(h => h.is_active && h.can_sign_in)
  const onlyOne = usable.length <= 1
  const stale = holders.length - usable.length
  const isLastUsable = (h: Holder) => protectLast && onlyOne && h.is_active && h.can_sign_in

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p style={{ fontSize: 13, color: 'var(--color-neutral-600)', lineHeight: 1.6, marginTop: 6 }}>
          {intro}
        </p>
      </CardHeader>

      <CardContent>
        {loading ? (
          <>
            <Skeleton className="h-12 w-full mb-2" />
            <Skeleton className="h-12 w-full" />
          </>
        ) : (
          <>
            {protectLast && onlyOne && (
              <div
                style={{
                  display: 'flex', gap: 8, alignItems: 'flex-start',
                  padding: 12, marginBottom: 16,
                  border: '1px solid var(--color-accent-400)',
                  background: 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg))',
                  fontSize: 13, lineHeight: 1.55, color: 'var(--color-accent-800)',
                }}
              >
                <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  {stale > 0 ? (
                    <>
                      Only one {roleName} can actually sign in.{' '}
                      {stale === 1 ? 'The other has' : `The other ${stale} have`} never
                      registered, so {stale === 1 ? 'it offers' : 'they offer'} no cover —
                      remove {stale === 1 ? 'it' : 'them'} and add a real second one.
                    </>
                  ) : (
                    <>
                      There is only one {roleName}. If this person leaves or loses access,
                      nobody can appoint a replacement. Add a second one.
                    </>
                  )}
                </span>
              </div>
            )}

            <div style={{ border: '1px solid var(--color-divider)' }}>
              {holders.length === 0 ? (
                <p style={{ padding: 14, fontSize: 13, color: 'var(--color-neutral-600)' }}>
                  Nobody currently has {roleName} access.
                </p>
              ) : (
                holders.map((h, i) => (
                  <div
                    key={h.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                      borderTop: i === 0 ? 'none' : '1px solid var(--color-divider)',
                    }}
                  >
                    <EmployeeAvatar name={h.full_name} size="sm" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)' }}>
                        {h.full_name}
                        {employee?.id === h.id && (
                          <span style={{ fontSize: 12, color: 'var(--color-neutral-600)', fontWeight: 400 }}>
                            {' '}— you
                          </span>
                        )}
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', wordBreak: 'break-all' }}>
                        {h.email}
                      </p>
                    </div>

                    <span
                      style={{
                        fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                        color: h.is_active && h.can_sign_in
                          ? 'var(--color-accent-700)'
                          : 'var(--color-neutral-600)',
                      }}
                    >
                      {!h.can_sign_in ? 'Never signed in' : h.is_active ? 'Active' : 'Deactivated'}
                    </span>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isLastUsable(h)}
                      title={isLastUsable(h)
                        ? `The last ${roleName} who can sign in cannot be removed`
                        : undefined}
                      onClick={() => { setNotice(null); setToRemove(h) }}
                    >
                      Remove
                    </Button>
                  </div>
                ))
              )}
            </div>

            {!picking && (
              <Button style={{ marginTop: 14 }} onClick={openPicker}>
                <Plus size={14} aria-hidden="true" /> {addLabel}
              </Button>
            )}

            {picking && (
              <div style={{ marginTop: 14, border: '1px solid var(--color-divider)', padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                    Choose an employee
                  </p>
                  <button
                    type="button"
                    onClick={() => setPicking(false)}
                    aria-label="Cancel"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-neutral-600)', display: 'inline-flex', padding: 2 }}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>

                <div style={{ position: 'relative', marginBottom: 10 }}>
                  <Search
                    size={14}
                    aria-hidden="true"
                    style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-neutral-600)' }}
                  />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by name or email"
                    aria-label="Search employees"
                    style={{ paddingLeft: 30 }}
                  />
                </div>

                <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--color-divider)' }}>
                  {candidatesLoading ? (
                    <div style={{ padding: 12 }}><Skeleton className="h-8 w-full" /></div>
                  ) : filtered.length === 0 ? (
                    <p style={{ padding: 12, fontSize: 13, color: 'var(--color-neutral-600)' }}>
                      {candidates.length === 0
                        ? 'Nobody is eligible yet. Only employees who have created an account can be given this access.'
                        : 'No one matches that search.'}
                    </p>
                  ) : (
                    filtered.map((c, i) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setNotice(null); setToPromote(c) }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                          padding: '9px 12px', textAlign: 'left', cursor: 'pointer',
                          background: 'none', border: 'none',
                          borderTop: i === 0 ? 'none' : '1px solid var(--color-divider)',
                        }}
                      >
                        <EmployeeAvatar name={c.full_name} size="sm" />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>
                            {c.full_name}
                          </span>
                          <span style={{ display: 'block', fontSize: 12, color: 'var(--color-neutral-600)', wordBreak: 'break-all' }}>
                            {c.email}
                          </span>
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--color-neutral-600)', whiteSpace: 'nowrap' }}>
                          {ROLE_NAMES[c.role] ?? c.role}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {(error ?? loadError) && (
              <p role="alert" style={{ fontSize: 13, color: 'var(--color-accent-800)', marginTop: 12 }}>
                {error ?? loadError}
              </p>
            )}
            {notice && (
              <p role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--color-accent-700)', marginTop: 12 }}>
                <ShieldCheck size={14} aria-hidden="true" />
                {notice}
              </p>
            )}
          </>
        )}
      </CardContent>

      <ConfirmModal
        open={toPromote !== null}
        onOpenChange={open => { if (!open) setToPromote(null) }}
        title={`Give ${toPromote?.full_name ?? ''} ${roleName} access?`}
        description={
          targetRole === 'super_admin'
            ? `${toPromote?.full_name ?? 'This person'} will get full control of ValueSpot: ` +
              'all employee data, settings and reports, and the ability to add or remove ' +
              'other administrators — including you. They sign in the same way as now. ' +
              'You can undo this later, as long as one administrator always remains.'
            : `${toPromote?.full_name ?? 'This person'} will be able to run HR: employees, ` +
              'departments, recognitions, reports and HR settings, and can promote people ' +
              'to Manager. They will not be able to manage administrators or change who ' +
              'may sign up. You can undo this at any time.'
        }
        confirmLabel={`Give ${roleName} access`}
        loading={working}
        onConfirm={async () => {
          if (!toPromote) return
          const name = toPromote.full_name
          const done = await applyRole(toPromote.id, targetRole, `${name} now has ${roleName} access.`)
          setToPromote(null)
          if (done) setPicking(false)
        }}
      />

      <ConfirmModal
        open={toRemove !== null}
        onOpenChange={open => { if (!open) setToRemove(null) }}
        title={
          employee?.id === toRemove?.id
            ? `Give up your ${roleName} access?`
            : `Remove ${roleName} access from ${toRemove?.full_name ?? ''}?`
        }
        description={
          employee?.id === toRemove?.id
            ? `You will become ${demotedName === 'HR Admin' ? 'an' : 'an'} ${demotedName}. ` +
              'You cannot undo this yourself afterwards — another Super Admin would have ' +
              'to restore it.'
            : `${toRemove?.full_name ?? 'This person'} will become ${demotedName === 'HR Admin' ? 'an' : 'an'} ` +
              `${demotedName}. You can restore this access at any time.`
        }
        confirmLabel={employee?.id === toRemove?.id ? 'Give up access' : 'Remove access'}
        variant="destructive"
        loading={working}
        onConfirm={async () => {
          if (!toRemove) return
          const name = toRemove.full_name
          const self = employee?.id === toRemove.id
          await applyRole(
            toRemove.id,
            demoteTo,
            self ? `You are now ${demotedName === 'HR Admin' ? 'an' : 'an'} ${demotedName}.`
                 : `${name} no longer has ${roleName} access.`,
          )
          setToRemove(null)
        }}
      />
    </Card>
  )
}
