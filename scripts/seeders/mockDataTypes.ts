/**
 * Shapes of src/data/valuespot-mock-data.json.
 *
 * Each seeder previously declared its own partial `MockData` interface with
 * `any` in the gaps. These are the real shapes, derived from the JSON, so the
 * seeders can be strongly typed without casts.
 *
 * Fields the seeders do not read are still declared where they exist, so this
 * stays an honest description of the file rather than a convenient subset.
 */

export interface MockPerson {
  id: string
  name: string
  role: string
  dept: string
  project: string
}

export interface MockCoreValue {
  key: string
  name: string
  tone: string
  hex: string
  description: string
  scenario: string
  behaviours: string[]
}

export interface MockBadge {
  code: string
  name: string
  min: number
  range: string
}

export interface MockDepartment {
  name: string
  pct: number
}

export interface MockFeedItem {
  id: string
  from: string
  to: string
  value: string
  behaviour: string
  story: string
  impact: string
  project: string
  date: string
  appreciations: number
}

export interface MockGiven {
  to: string
  value: string
  behaviour: string
  date: string
  status: string
}

export interface MockReceived {
  from: string
  value: string
  behaviour: string
  project: string
  date: string
  story: string
}

export interface MockApproval {
  id: string
  from: string
  to: string
  person: string
  value: string
  behaviour: string
  story: string
  impact: string
  /** Free-text meta line, e.g. "Nova Reporting · 2 days ago". */
  meta: string
  age: string
}

/**
 * The mock data file as a whole.
 *
 * The index signature covers the presentation-only sections (metrics, charts,
 * dialog copy) that no seeder reads. `unknown` rather than `any` keeps those
 * sections inert — reading one requires an explicit narrowing.
 */
export interface MockData {
  people: MockPerson[]
  coreValues: MockCoreValue[]
  badges: MockBadge[]
  departments?: MockDepartment[]
  feed?: MockFeedItem[]
  given?: MockGiven[]
  received?: MockReceived[]
  approvals?: MockApproval[]
  [section: string]: unknown
}

/** A nomination row prepared by the nomination seeder for the appreciation step. */
export interface SeededNomination {
  nominator_name: string
  nominee_name: string
  core_value_name: string
  behaviour_name: string
  what_happened: string
  what_impact: string
  project_name: string
  date: string
  status: string
  appreciations: number
  /** Set once the row is inserted, so appreciations can reference it. */
  _nomination_id?: string
}
