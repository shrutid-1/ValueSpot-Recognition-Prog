import { useSecurityActivity } from '@/hooks/queries'
import { errorMessage } from '@/lib/query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/shared/SkeletonLoader'

/**
 * The narrow slice of the audit trail that concerns who can administer the
 * system: role grants and revocations, access codes, and signup policy.
 *
 * Reads the same audit_logs table as HR's Audit Logs page — there is no second
 * audit system. The difference is the filter and the plain-English rendering:
 * "Amit Sharma was made a Super Admin by Pushkar Kaslikar", not a row of JSON.
 */

interface SecurityEvent {
  id: string
  action: string
  actor_name: string | null
  actor_email: string | null
  entity_type: string
  entity_id: string | null
  previous_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  created_at: string
}

const ROLE_NAMES: Record<string, string> = {
  employee: 'Employee',
  manager: 'Manager',
  hr_admin: 'HR Admin',
  super_admin: 'Super Admin',
}

function roleName(value: unknown): string {
  return typeof value === 'string' ? (ROLE_NAMES[value] ?? value) : 'unknown'
}

function personName(value: Record<string, unknown> | null): string {
  const name = value?.full_name
  return typeof name === 'string' ? name : 'someone'
}

/** A sentence a non-technical reader can act on, not a diff of two JSON blobs. */
function describe(event: SecurityEvent): string {
  const before = event.previous_value
  const after = event.new_value

  switch (event.action) {
    case 'super_admin.granted':
      return `${personName(after)} was given Super Admin access`
    case 'super_admin.revoked':
      return `${personName(before)} lost Super Admin access and became ${roleName(after?.role)}`
    case 'employee.role_changed':
      return `${personName(after)} changed from ${roleName(before?.role)} to ${roleName(after?.role)}`
    case 'access_code.issued':
      return `A ${roleName(after?.role)} access code was issued${
        typeof after?.label === 'string' && after.label ? ` (${after.label})` : ''
      }`
    case 'access_code.revoked':
      return `A ${roleName(before?.role)} access code was revoked`
    case 'signup_domains.changed': {
      const list = Array.isArray(after?.domains) ? (after.domains as string[]) : []
      return list.length === 0
        ? 'Sign-up was opened to any email domain'
        : `Sign-up was restricted to ${list.join(', ')}`
    }
    default:
      return event.action
  }
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function SecurityActivityCard() {
  /*
    Cached, and invalidated by the role mutations — so granting or revoking
    access now refreshes this trail immediately. It previously fetched once on
    mount and never again, so the audit list went stale the moment you used the
    cards above it.
  */
  const query = useSecurityActivity(100)

  const events = (query.data ?? []) as SecurityEvent[]
  const loading = query.isPending
  const error = query.error
    ? errorMessage(query.error, 'Could not load security activity.')
    : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security activity</CardTitle>
        <p style={{ fontSize: 13, color: 'var(--color-neutral-600)', lineHeight: 1.6, marginTop: 6 }}>
          Every change to who can administer ValueSpot — access granted or removed,
          codes issued or revoked, and changes to who may sign up. Records cannot be
          edited or deleted from the application.
        </p>
      </CardHeader>

      <CardContent>
        {loading ? (
          <>
            <Skeleton className="h-10 w-full mb-2" />
            <Skeleton className="h-10 w-full mb-2" />
            <Skeleton className="h-10 w-full" />
          </>
        ) : error ? (
          <p role="alert" style={{ fontSize: 13, color: 'var(--color-accent-800)' }}>{error}</p>
        ) : events.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>
            Nothing yet. Administrator and access changes will appear here.
          </p>
        ) : (
          <div style={{ border: '1px solid var(--color-divider)' }}>
            {events.map((event, i) => (
              <div
                key={event.id}
                style={{
                  padding: '10px 12px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--color-divider)',
                }}
              >
                <p style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.5 }}>
                  {describe(event)}
                </p>
                <p style={{ fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 2 }}>
                  {event.actor_name ?? event.actor_email ?? 'Unknown'}
                  {' · '}
                  {formatWhen(event.created_at)}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
