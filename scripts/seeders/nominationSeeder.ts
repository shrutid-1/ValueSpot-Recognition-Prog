import { SupabaseClient } from '@supabase/supabase-js'
import {
  logStep,
  logSuccess,
  logError,
  formatCounts,
  parseRelativeDate,
  generateNominationIdempotencyKey,
} from './utils.js'

import type { MockData, SeededNomination } from './mockDataTypes.js'
import type { EmployeeMap } from './employeeSeeder.js'

/**
 * Map nomination status from mock format to database format
 */
function mapStatus(mockStatus: string): string {
  const statusMap: Record<string, string> = {
    Pending: 'pending',
    Clarification: 'clarification_requested',
    Approved: 'approved',
    'Not approved': 'rejected',
  }
  return statusMap[mockStatus] || 'draft'
}

/**
 * Find employee by full name from employee map
 */
function findEmployeeByName(name: string, employeeMap: EmployeeMap): string | null {
  for (const [, emp] of Object.entries(employeeMap)) {
    if (emp.name === name) {
      return emp.id
    }
  }
  return null
}

/**
 * Seed nominations from mock feed, given, received, and approvals sections
 */
/**
 * Counts returned by the nominations step, plus the nomination rows the
 * appreciation step needs to reference. `_nominations` is stripped by the
 * caller before the counts are reported.
 */
export interface NominationSeedResult {
  inserted: number
  updated: number
  skipped: number
  _nominations?: SeededNomination[]
}

export async function seedNominations(
  supabase: SupabaseClient,
  mockData: MockData,
  employeeMap: EmployeeMap
): Promise<NominationSeedResult> {
  logStep('NOMINATIONS', 'Starting nominations seeding...')

  let inserted = 0
  const updated = 0
  let skipped = 0

  // Fetch necessary lookups
  const { data: coreValues, error: cvError } = await supabase
    .from('core_values')
    .select('id, name, slug')

  if (cvError) {
    logError('NOMINATIONS', 'Failed to fetch core values', cvError)
    throw cvError
  }

  const { data: behaviours, error: bhError } = await supabase
    .from('behaviours')
    .select('id, name, core_value_id')

  if (bhError) {
    logError('NOMINATIONS', 'Failed to fetch behaviours', bhError)
    throw bhError
  }

  const { data: projects, error: pjError } = await supabase
    .from('projects')
    .select('id, name')

  if (pjError) {
    logError('NOMINATIONS', 'Failed to fetch projects', pjError)
    throw pjError
  }

  // Departments are not referenced directly, but a failure here means the
  // seed ran against an unmigrated database — surface it early.
  const { error: deptError } = await supabase
    .from('departments')
    .select('id, name')

  if (deptError) {
    logError('NOMINATIONS', 'Failed to fetch departments', deptError)
    throw deptError
  }

  // Build lookup maps
  const cvMap = new Map(coreValues.map((cv) => [cv.name, { id: cv.id, slug: cv.slug }]))
  const bhMap = new Map(behaviours.map((bh) => [bh.name, { id: bh.id, coreValueId: bh.core_value_id }]))
  const prjMap = new Map(projects.map((p) => [p.name, p.id]))

  // Collect nominations from feed
  const nominations: SeededNomination[] = []

  // From feed section (all approved)
  if (mockData.feed) {
    for (const item of mockData.feed) {
      nominations.push({
        nominator_name: item.from,
        nominee_name: item.to,
        core_value_name: item.value,
        behaviour_name: item.behaviour,
        what_happened: item.story,
        what_impact: item.impact,
        project_name: item.project,
        date: item.date,
        status: 'approved',
        appreciations: item.appreciations,
      })
    }
  }

  // From given section (various statuses)
  if (mockData.given) {
    // Assume shruti is the current user for given recognitions
    for (const item of mockData.given) {
      nominations.push({
        nominator_name: 'Shruti Kulkarni',
        nominee_name: item.to,
        core_value_name: item.value,
        behaviour_name: item.behaviour,
        what_happened: '',
        what_impact: '',
        project_name: '',
        date: item.date,
        status: mapStatus(item.status),
        appreciations: 0,
      })
    }
  }

  // From received section (all approved)
  if (mockData.received) {
    // Assume shruti is the current user for received recognitions
    for (const item of mockData.received) {
      nominations.push({
        nominator_name: item.from,
        nominee_name: 'Shruti Kulkarni',
        core_value_name: item.value,
        behaviour_name: item.behaviour,
        what_happened: item.story,
        what_impact: '',
        project_name: item.project,
        date: item.date,
        status: 'approved',
        appreciations: 0,
      })
    }
  }

  // From approvals section (all pending)
  if (mockData.approvals) {
    for (const item of mockData.approvals) {
      nominations.push({
        nominator_name: item.from,
        nominee_name: item.to,
        core_value_name: item.value,
        behaviour_name: item.behaviour,
        what_happened: item.story,
        what_impact: item.impact,
        project_name: item.meta.split('·')[0].trim(),
        date: item.meta,
        status: 'pending',
        appreciations: 0,
      })
    }
  }

  logStep('NOMINATIONS', `Found ${nominations.length} nominations to seed`)

  // Fetch existing nominations to avoid duplicates
  const { data: existingNoms, error: existingError } = await supabase
    .from('nominations')
    .select('idempotency_key')

  if (existingError) {
    logError('NOMINATIONS', 'Failed to fetch existing nominations', existingError)
    throw existingError
  }

  const existingKeys = new Set(existingNoms.map((n) => n.idempotency_key))

  // Seed each nomination
  for (const nom of nominations) {
    try {
      const nominatorId = findEmployeeByName(nom.nominator_name, employeeMap)
      const nomineeId = findEmployeeByName(nom.nominee_name, employeeMap)
      const coreValue = cvMap.get(nom.core_value_name)
      const behaviour = bhMap.get(nom.behaviour_name)
      const projectId = nom.project_name ? prjMap.get(nom.project_name) : null

      if (!nominatorId) {
        logStep('NOMINATIONS', `Skipped: nominator ${nom.nominator_name} not found`)
        skipped++
        continue
      }

      if (!nomineeId) {
        logStep('NOMINATIONS', `Skipped: nominee ${nom.nominee_name} not found`)
        skipped++
        continue
      }

      if (!coreValue) {
        logStep('NOMINATIONS', `Skipped: core value ${nom.core_value_name} not found`)
        skipped++
        continue
      }

      if (!behaviour) {
        logStep('NOMINATIONS', `Skipped: behaviour ${nom.behaviour_name} not found`)
        skipped++
        continue
      }

      // Generate deterministic idempotency key
      const timestamp = parseRelativeDate(nom.date).getTime()
      const idempotencyKey = generateNominationIdempotencyKey(
        nominatorId,
        nomineeId,
        coreValue.id,
        timestamp
      )

      if (existingKeys.has(idempotencyKey)) {
        logStep('NOMINATIONS', `Skipped: ${nom.nominator_name} → ${nom.nominee_name} (duplicate)`)
        skipped++
        continue
      }

      // Fetch nominator's department for snapshot
      const { data: nominatorData } = await supabase
        .from('employees')
        .select('id, department_id')
        .eq('id', nominatorId)
        .single()

      const { data: nomineeData } = await supabase
        .from('employees')
        .select('id, department_id, manager_id')
        .eq('id', nomineeId)
        .single()

      let nominatorDeptName = ''
      let nomineeDeptName = ''
      const nomineeManagerId = nomineeData?.manager_id || null

      if (nominatorData?.department_id) {
        const { data: deptData } = await supabase
          .from('departments')
          .select('name')
          .eq('id', nominatorData.department_id)
          .single()
        nominatorDeptName = deptData?.name || ''
      }

      if (nomineeData?.department_id) {
        const { data: deptData } = await supabase
          .from('departments')
          .select('name')
          .eq('id', nomineeData.department_id)
          .single()
        nomineeDeptName = deptData?.name || ''
      }

      const approvedAt = nom.status === 'approved' ? parseRelativeDate(nom.date) : null
      const submittedAt = parseRelativeDate(nom.date)

      // Insert nomination
      const { data: nomData, error: nomError } = await supabase
        .from('nominations')
        .insert({
          nominator_id: nominatorId,
          nominee_id: nomineeId,
          core_value_id: coreValue.id,
          behaviour_id: behaviour.id,
          what_happened: nom.what_happened || 'Recognition detail not provided',
          what_impact: nom.what_impact || 'Impact not specified',
          project_id: projectId || null,
          status: nom.status,
          idempotency_key: idempotencyKey,
          snapshot_nominator_dept: nominatorDeptName,
          snapshot_nominee_dept: nomineeDeptName,
          snapshot_nominee_manager_id: nomineeManagerId,
          snapshot_core_value_name: nom.core_value_name,
          snapshot_behaviour_name: nom.behaviour_name,
          snapshot_project_name: nom.project_name || null,
          approved_at: approvedAt,
          submitted_at: submittedAt,
          published_at: nom.status === 'approved' ? approvedAt : null,
        })
        .select('id')
        .single()

      if (nomError) {
        if (nomError.code === '23505') {
          logStep('NOMINATIONS', `Skipped: ${nom.nominator_name} → ${nom.nominee_name} (constraint)`)
          skipped++
        } else {
          throw nomError
        }
      } else if (nomData) {
        // Record the inserted row id so the appreciation step can reference it.
        // `appreciations` is already on the object, so it needs no copy.
        nom._nomination_id = nomData.id

        logStep('NOMINATIONS', `Inserted: ${nom.nominator_name} → ${nom.nominee_name}`)
        inserted++
      }
    } catch (error) {
      logError(
        'NOMINATIONS',
        `Failed to seed ${nom.nominator_name} → ${nom.nominee_name}`,
        error
      )
      throw error
    }
  }

  const counts = formatCounts(inserted, updated, skipped)
  logSuccess('NOMINATIONS', 'Nominations seeding complete', counts)

  // Return nominations for appreciation seeding
  return {
    inserted: counts.inserted,
    updated: counts.updated,
    skipped: counts.skipped,
    _nominations: nominations,
  }
}

/**
 * Seed nomination appreciations
 */
export async function seedAppreciations(
  supabase: SupabaseClient,
  nominations: SeededNomination[],
  employeeMap: EmployeeMap
): Promise<Record<string, number>> {
  logStep('APPRECIATIONS', 'Starting appreciations seeding...')

  let inserted = 0
  const updated = 0
  let skipped = 0

  // Get all employees
  const employees = Object.values(employeeMap)

  for (const nom of nominations) {
    if (!nom._nomination_id || !nom.appreciations || nom.appreciations === 0) {
      continue
    }

    // Generate synthetic appreciation records from random employees
    const appreciationCount = Math.min(nom.appreciations, employees.length)

    // Shuffle employees and take first N
    const shuffled = [...employees].sort(() => Math.random() - 0.5)
    const appreciators = shuffled.slice(0, appreciationCount)

    for (const appreciator of appreciators) {
      try {
        // Check if appreciation already exists
        const { data: existing, error: selectError } = await supabase
          .from('nomination_appreciations')
          .select('id')
          .eq('nomination_id', nom._nomination_id)
          .eq('employee_id', appreciator.id)
          .single()

        if (selectError && selectError.code !== 'PGRST116') {
          throw selectError
        }

        if (existing) {
          skipped++
          continue
        }

        // Insert appreciation
        const { error: insertError } = await supabase
          .from('nomination_appreciations')
          .insert({
            nomination_id: nom._nomination_id,
            employee_id: appreciator.id,
          })

        if (insertError) {
          if (insertError.code !== '23505') {
            throw insertError
          }
          skipped++
        } else {
          inserted++
        }
      } catch (error) {
        logError('APPRECIATIONS', `Failed to seed appreciation for nomination`, error)
        throw error
      }
    }
  }

  const counts = formatCounts(inserted, updated, skipped)
  logSuccess('APPRECIATIONS', 'Appreciations seeding complete', counts)

  return counts
}
