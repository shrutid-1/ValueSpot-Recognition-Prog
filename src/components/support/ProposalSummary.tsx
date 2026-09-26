import type { SupportRequest } from '@/lib/api'

/**
 * The Core Value > Behaviour > Scenario a correction request asks for
 * (migration 060).
 *
 * The three proposal ids are one choice, read together: a request with no
 * proposed Core Value asked for no change to the chain, and a proposal with no
 * Scenario means the requester chose "A different situation". Both views below
 * read it that way, so the queue, the dialog and the employee's own list
 * cannot describe the same request differently.
 */

type Proposal = { coreValue: string; behaviour: string; scenario: string }

function proposalOf(request: SupportRequest): Proposal | null {
  if (!request.proposed_core_value_id) return null
  return {
    coreValue: request.proposed_core_value?.name ?? 'Unavailable Core Value',
    behaviour: request.proposed_behaviour?.name ?? 'No behaviour',
    scenario: request.proposed_scenario?.name ?? 'A different situation',
  }
}

/** One line: "Collaborative › Gives credit to others › Shared the credit…". */
export function ProposalSummary({ request }: { request: SupportRequest }) {
  const p = proposalOf(request)
  if (!p) return null
  return (
    <span>
      {p.coreValue}
      <span aria-hidden="true" style={{ color: 'var(--color-neutral-500)' }}> › </span>
      {p.behaviour}
      <span aria-hidden="true" style={{ color: 'var(--color-neutral-500)' }}> › </span>
      {p.scenario}
    </span>
  )
}

/** Current against requested, row by row, with the rows that change marked. */
export function ProposalComparison({ request }: { request: SupportRequest }) {
  const p = proposalOf(request)
  const nom = request.nomination
  if (!p || !nom) return null

  const rows: Array<[string, string, string, boolean]> = [
    ['Core Value', nom.snapshot_core_value_name ?? '—', p.coreValue,
      request.proposed_core_value_id !== nom.core_value_id],
    ['Behaviour', nom.snapshot_behaviour_name ?? 'No behaviour', p.behaviour,
      request.proposed_behaviour_id !== nom.behaviour_id],
    ['Scenario', nom.snapshot_scenario_name ?? 'No scenario', p.scenario,
      request.proposed_scenario_id !== nom.scenario_id],
  ]

  return (
    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginTop: 8 }}>
      <thead>
        <tr style={{ textAlign: 'left', fontSize: 11, color: 'var(--color-neutral-600)' }}>
          <th style={{ fontWeight: 500, padding: '0 8px 4px 0' }} scope="col"><span className="sr-only">Field</span></th>
          <th style={{ fontWeight: 500, padding: '0 8px 4px 0' }} scope="col">Now</th>
          <th style={{ fontWeight: 500, padding: '0 0 4px 0' }} scope="col">Requested</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, now, wanted, changed]) => (
          <tr key={label} style={{ borderTop: '1px solid var(--color-divider)', verticalAlign: 'top' }}>
            <th scope="row" style={{ fontWeight: 500, padding: '5px 8px 5px 0', whiteSpace: 'nowrap', textAlign: 'left' }}>
              {label}
            </th>
            <td style={{ padding: '5px 8px 5px 0', color: 'var(--color-neutral-600)' }}>{now}</td>
            <td style={{
              padding: '5px 0',
              color: changed ? 'var(--color-accent-700)' : 'var(--color-neutral-600)',
              fontWeight: changed ? 500 : 400,
            }}>
              {changed ? wanted : 'No change'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
