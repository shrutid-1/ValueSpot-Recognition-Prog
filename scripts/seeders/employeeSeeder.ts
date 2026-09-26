import { SupabaseClient } from '@supabase/supabase-js'
import {
  logStep,
  logSuccess,
  logError,
  formatCounts,
  generateEmail,
  inferSystemRole,
} from './utils.js'

interface MockPerson {
  id: string
  name: string
  role: string
  dept: string
  project: string
  self?: boolean
}

interface MockData {
  people: MockPerson[]
}

export interface EmployeeMap {
  [mockId: string]: {
    id: string // UUID
    name: string
    email: string
  }
}

/**
 * Seed employees into the database
 * Returns a map of mock IDs to database UUIDs for use in other seeders
 */
export async function seedEmployees(
  supabase: SupabaseClient,
  mockData: MockData
): Promise<EmployeeMap> {
  logStep('EMPLOYEES', 'Starting employees seeding...')

  const people = mockData.people || []

  if (people.length === 0) {
    logStep('EMPLOYEES', 'No employees found in mock data')
    return {}
  }

  logStep('EMPLOYEES', `Found ${people.length} employees to seed`)

  let inserted = 0
  const updated = 0
  let skipped = 0

  // Fetch department map
  const { data: departments, error: deptError } = await supabase
    .from('departments')
    .select('id, name')

  if (deptError) {
    logError('EMPLOYEES', 'Failed to fetch departments', deptError)
    throw deptError
  }

  const deptMap = new Map(departments.map((d) => [d.name, d.id]))

  // Build employee map for return value and FK resolution
  const employeeMap: EmployeeMap = {}

  for (const person of people) {
    try {
      const mockId = person.id
      const deptId = deptMap.get(person.dept)

      if (!deptId) {
        logError(
          'EMPLOYEES',
          `Department ${person.dept} not found for ${person.name}. Skipping.`
        )
        skipped++
        continue
      }

      const email = generateEmail(person.name)
      const systemRole = inferSystemRole(person.role)
      const employeeId = mockId // Store original mock ID as employee_id

      // Check if employee already exists
      const { data: existing, error: selectError } = await supabase
        .from('employees')
        .select('id, employee_id')
        .eq('employee_id', employeeId)
        .single()

      if (selectError && selectError.code !== 'PGRST116') {
        throw selectError
      }

      if (existing) {
        logStep('EMPLOYEES', `Skipped ${person.name} (already exists)`)
        employeeMap[mockId] = {
          id: existing.id,
          name: person.name,
          email,
        }
        skipped++
        continue
      }

      // Insert new employee
      const { data: insertedData, error: insertError } = await supabase
        .from('employees')
        .insert({
          employee_id: employeeId,
          full_name: person.name,
          email,
          department_id: deptId,
          role: systemRole,
          joined_at: '2026-01-01', // Default date
          is_active: true,
          // manager_id: null, // Backfill later
        })
        .select('id')
        .single()

      if (insertError) {
        if (insertError.code === '23505') {
          // Unique constraint on employee_id
          logStep('EMPLOYEES', `Skipped ${person.name} (constraint violation)`)
          // Try to fetch the existing record
          const { data: retryData } = await supabase
            .from('employees')
            .select('id')
            .eq('employee_id', employeeId)
            .single()
          if (retryData) {
            employeeMap[mockId] = {
              id: retryData.id,
              name: person.name,
              email,
            }
          }
          skipped++
        } else {
          throw insertError
        }
      } else if (insertedData) {
        employeeMap[mockId] = {
          id: insertedData.id,
          name: person.name,
          email,
        }
        logStep('EMPLOYEES', `Inserted ${person.name}`)
        inserted++
      }
    } catch (error) {
      logError('EMPLOYEES', `Failed to seed ${person.name}`, error)
      throw error
    }
  }

  const counts = formatCounts(inserted, updated, skipped)
  logSuccess('EMPLOYEES', 'Employees seeding complete', counts)

  return employeeMap
}

/**
 * Backfill manager relationships
 * Infer from organizational hierarchy in mock data
 */
export async function backfillManagerRelationships(
  supabase: SupabaseClient,
  mockData: MockData,
  employeeMap: EmployeeMap
): Promise<Record<string, number>> {
  logStep('MANAGER_BACKFILL', 'Starting manager relationship backfill...')

  let updated = 0
  let skipped = 0

  // Identify manager (job title contains "Manager")
  const managerPerson = mockData.people.find((p) => p.role.includes('Manager'))

  if (!managerPerson) {
    logStep('MANAGER_BACKFILL', 'No manager found in mock data')
    return formatCounts(0, 0, 0)
  }

  const managerMockId = managerPerson.id
  const managerDbId = employeeMap[managerMockId]?.id

  if (!managerDbId) {
    logError('MANAGER_BACKFILL', `Manager ${managerPerson.name} not found in employee map`)
    return formatCounts(0, 0, 0)
  }

  logStep('MANAGER_BACKFILL', `Found manager: ${managerPerson.name}`)

  // Find all employees in the same department as manager
  const managerDept = managerPerson.dept
  const managedEmployees = mockData.people.filter(
    (p) => p.dept === managerDept && p.id !== managerMockId
  )

  logStep(
    'MANAGER_BACKFILL',
    `Found ${managedEmployees.length} employees in ${managerDept} department`
  )

  for (const emp of managedEmployees) {
    try {
      const empDbId = employeeMap[emp.id]?.id

      if (!empDbId) {
        logStep('MANAGER_BACKFILL', `Skipped ${emp.name} (not in employee map)`)
        skipped++
        continue
      }

      // Update employee's manager_id
      const { error: updateError } = await supabase
        .from('employees')
        .update({
          manager_id: managerDbId,
        })
        .eq('id', empDbId)

      if (updateError) {
        logError('MANAGER_BACKFILL', `Failed to set manager for ${emp.name}`, updateError)
      } else {
        logStep('MANAGER_BACKFILL', `Updated ${emp.name} manager to ${managerPerson.name}`)
        updated++
      }
    } catch (error) {
      logError('MANAGER_BACKFILL', `Failed to backfill manager for ${emp.name}`, error)
      throw error
    }
  }

  const counts = formatCounts(0, updated, skipped)
  logSuccess('MANAGER_BACKFILL', 'Manager relationship backfill complete', counts)

  return counts
}
