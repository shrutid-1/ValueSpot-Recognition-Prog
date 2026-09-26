import type { RecognitionFeedItem } from '@/types'
import { Panel } from './Panel'
import { Avatar } from './Avatar'

interface PeoplePanelProps {
  items: RecognitionFeedItem[]
  employeeId: string | undefined
  delay?: number
}

interface Person {
  id: string
  name: string
  avatar: string | null
  fromThem: number
  fromYou: number
}

/**
 * The people in this person's recognition, as pills.
 *
 * A contributors list, not a metric. "Recognition circle: 4" is a number
 * about people; this is the people, each with what actually passed between
 * the two of you written underneath.
 *
 * Derived entirely from the feed rows the dashboard already loaded: no
 * request of its own, and no read of anybody's directory record. Everyone
 * shown is already a party to a recognition visible elsewhere on this page,
 * so nothing new is exposed.
 */
export function PeoplePanel({ items, employeeId, delay }: PeoplePanelProps) {
  const byId = new Map<string, Person>()

  for (const item of items) {
    const received = item.nominee_id === employeeId
    const given = item.nominator_id === employeeId
    if (!received && !given) continue

    const other = received
      ? { id: item.nominator_id, name: item.nominator_name, avatar: item.nominator_avatar }
      : { id: item.nominee_id, name: item.nominee_name, avatar: item.nominee_avatar }

    if (!other.id || other.id === employeeId) continue

    const existing = byId.get(other.id) ?? {
      id: other.id, name: other.name, avatar: other.avatar, fromThem: 0, fromYou: 0,
    }
    if (received) existing.fromThem += 1
    else existing.fromYou += 1
    byId.set(other.id, existing)
  }

  const people = [...byId.values()].sort(
    (a, b) => (b.fromThem + b.fromYou) - (a.fromThem + a.fromYou),
  )

  /** Plain words for what passed between two people. */
  const describe = (p: Person): string => {
    if (p.fromThem && p.fromYou) return 'You have recognised each other'
    if (p.fromThem) return p.fromThem === 1 ? 'Recognised you' : `Recognised you ${p.fromThem} times`
    return p.fromYou === 1 ? 'You recognised them' : `You recognised them ${p.fromYou} times`
  }

  return (
    <Panel title="People" delay={delay}>
      {people.length === 0 ? (
        <p className="vsx-meta" style={{ fontSize: 13.5, maxWidth: '38ch' }}>
          The colleagues you recognise, and those who recognise you, will be
          listed here.
        </p>
      ) : (
        <ul
          className="flex flex-wrap"
          style={{ listStyle: 'none', margin: 0, padding: 0, gap: 10 }}
        >
          {people.map(person => (
            <li key={person.id} style={{ maxWidth: '100%' }}>
              <span
                className="vsx-data-pill vsx-data-pill-quiet"
                style={{ padding: '7px 16px 7px 7px' }}
              >
                <Avatar name={person.name} avatarUrl={person.avatar} size="sm" />
                <span style={{ minWidth: 0 }}>
                  <span
                    className="truncate"
                    style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}
                  >
                    {person.name}
                  </span>
                  <span
                    className="truncate"
                    style={{ display: 'block', fontSize: 12, color: 'var(--vsx-text-3)' }}
                  >
                    {describe(person)}
                  </span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {people.length > 0 && (
        <p className="vsx-meta" style={{ fontSize: 12.5, marginTop: 'auto', paddingTop: 18 }}>
          <span className="vsx-fig" style={{ fontSize: 14 }}>{people.length}</span>
          {people.length === 1
            ? ' colleague in your recognition so far.'
            : ' colleagues in your recognition so far.'}
        </p>
      )}
    </Panel>
  )
}
